import type { IPtyProvider } from '../../../providers/pty-provider-contract'
import { SSH_PROVIDER_UNREGISTERED_REASON } from '../../../../shared/pty-liveness-verdict'
import { isCurrentPtyExit, ptyOwnership, ptyIncarnationById } from '../provider/ownership-state'
import {
  getProviderForPty,
  getPtySshConnectionId,
  resolvePtyExecutionHost
} from '../provider/registry'
import { isPtyAlreadyGoneError, delay, verifyPtyStopped } from '../provider/liveness'
import type { PtyRuntimeControllerDeps } from './controller-deps'
import { errorMessage } from '../../../../shared/error-message'
import { PtyExitProof, PtyRetirementWithoutProof } from '../../../pty-exit-proof'
import {
  isLegacyRelayBridgedPty,
  stopLegacyRelayPaneAndWait
} from '../../../ssh/legacy-relay/legacy-relay-bridge-registry'
import { publishSyntheticExit, stopLegacyRelayBridgedPty } from './kill-publication'

export { publishSyntheticExit, stopLegacyRelayBridgedPty } from './kill-publication'

// Bounds the wait for an observed exit to reach the runtime record when the caller set no deadline.
const OBSERVED_EXIT_RECORD_WAIT_MS = 10_000

export function killPtyFromRuntimeController(
  deps: PtyRuntimeControllerDeps,
  ptyId: string
): boolean {
  const {
    runtime,
    store,
    getLocalPtyProviderStartupPromise,
    shutdownProviderAndDetectExit,
    finishPtyShutdown,
    retiredRejectedPtyIds
  } = deps
  runtime?.markPtyStopRequested?.(ptyId)
  const connectionId = getPtySshConnectionId(ptyId)
  if (stopLegacyRelayBridgedPty(ptyId, connectionId)) {
    return true
  }
  // Close runtime tails but retain provider ownership so failed shutdown can be retried.
  const reportStopFailure = (err: unknown, incarnationId: string | undefined): void => {
    const msg = errorMessage(err)
    console.warn(`[pty] Failed to stop PTY ${ptyId}: ${msg}`)
    if (retiredRejectedPtyIds.has(ptyId)) {
      return
    }
    runtime?.onPtyExit(ptyId, -1, incarnationId)
  }
  const killWithCurrentProvider = (): boolean => {
    let provider: IPtyProvider
    try {
      provider = getProviderForPty(ptyId)
    } catch {
      if (connectionId) {
        // Detached SSH close must tombstone the lease so reconnect cannot revive a user-closed pane.
        const unproven = PtyRetirementWithoutProof.because(SSH_PROVIDER_UNREGISTERED_REASON)
        void finishPtyShutdown(ptyId, connectionId, store, unproven)
          .then((incarnationId) => publishSyntheticExit(deps, ptyId, -1, incarnationId, unproven))
          .catch((error) => reportStopFailure(error, ptyIncarnationById.get(ptyId)))
      }
      return false
    }
    const stoppingIncarnationId = ptyIncarnationById.get(ptyId)
    // The synchronous controller retains ownership until asynchronous shutdown settles.
    void shutdownProviderAndDetectExit(provider, ptyId, { immediate: false })
      .then(async (providerExitObserved) => {
        const retired = retiredRejectedPtyIds.has(ptyId)
        const proof = PtyExitProof.from(
          providerExitObserved ? 'exit-observed' : 'shutdown-acknowledged',
          stoppingIncarnationId
        )
        const incarnationId = await finishPtyShutdown(ptyId, connectionId, store, proof)
        if (!providerExitObserved && !retired) {
          publishSyntheticExit(deps, ptyId, -1, incarnationId, proof)
        }
      })
      .catch(async (err) => {
        const retired = retiredRejectedPtyIds.has(ptyId)
        if (isPtyAlreadyGoneError(err)) {
          const proof = PtyExitProof.from('absent', stoppingIncarnationId)
          const incarnationId = await finishPtyShutdown(ptyId, connectionId, store, proof)
          if (!retired) {
            publishSyntheticExit(deps, ptyId, -1, incarnationId, proof)
          }
          return
        }
        reportStopFailure(err, stoppingIncarnationId)
      })
    return true
  }
  const killedIncarnationId = ptyIncarnationById.get(ptyId)
  const startupPromise = getLocalPtyProviderStartupPromise(resolvePtyExecutionHost(ptyId))
  if (startupPromise) {
    // Select after daemon handoff; fallback shutdown can falsely succeed while orphaning a daemon PTY.
    void startupPromise
      .then(killWithCurrentProvider)
      .catch((err) => reportStopFailure(err, killedIncarnationId))
    return true
  }
  return killWithCurrentProvider()
}

export function retireRejectedPtyFromRuntimeController(
  deps: PtyRuntimeControllerDeps,
  ptyId: string,
  stopConfirmed: boolean,
  incarnationId: string | undefined
): void {
  const { runtime, store, rememberRetiredRejectedPty, finishPtyShutdown } = deps
  // A same-id respawn owns the record now; this verdict is about the rejected incarnation only.
  if (!isCurrentPtyExit({ id: ptyId, incarnationId })) {
    return
  }
  rememberRetiredRejectedPty(ptyId)
  if (!stopConfirmed) {
    const unproven = PtyRetirementWithoutProof.because(
      'a follow-up stop was issued but its outcome could not be verified'
    )
    if (!ptyOwnership.has(ptyId)) {
      runtime?.markPtyLivenessUnverifiable?.(ptyId, unproven.unverifiableReason)
      return
    }
    publishSyntheticExit(deps, ptyId, -1, incarnationId, unproven)
    return
  }
  // Avoid duplicate renderer exits, but finalize runtime exit so a permanently closed SSH pane is not preserved.
  if (!ptyOwnership.has(ptyId)) {
    runtime?.onPtyExit(ptyId, 0, incarnationId)
    return
  }
  const proof = PtyExitProof.from('stop-confirmed', incarnationId)
  const connectionId = getPtySshConnectionId(ptyId)
  void finishPtyShutdown(ptyId, connectionId, store, proof)
    .then((incarnationId) => publishSyntheticExit(deps, ptyId, 0, incarnationId, proof))
    .catch((error) => {
      console.warn(`[pty] Failed to finish retiring PTY ${ptyId}: ${errorMessage(error)}`)
      runtime?.markPtyLivenessUnverifiable?.(ptyId, 'the proven stop could not be persisted safely')
    })
}

/** Reversible stops must not leave durable kill orders that could destroy a later-woken pane; return failure for retry. */
export async function stopAndWaitPtyFromRuntimeController(
  deps: PtyRuntimeControllerDeps,
  ptyId: string,
  opts?: { keepHistory?: boolean; deadlineMs?: number }
): Promise<boolean> {
  // A final relay stop is owed until the relay proves it, so an unproven one still reads as closing.
  const relayOwesStop =
    !opts?.keepHistory && Boolean(getPtySshConnectionId(ptyId)) && isLegacyRelayBridgedPty(ptyId)
  let stopped = false
  try {
    stopped = await stopAndWaitPty(deps, ptyId, opts)
    return stopped
  } finally {
    if (!stopped && !relayOwesStop) {
      // Refused, failed or thrown: the process may run on, so it must not read as closing.
      deps.runtime?.clearPtyStopRequest?.(ptyId)
    }
  }
}

/** Cleanup for a replacement that main cannot durably bind. The provider owns the final fence. */
export async function stopPtyIncarnationIfMatchFromRuntimeController(
  ptyId: string,
  expectedIncarnationId: string
): Promise<boolean> {
  let provider: IPtyProvider
  try {
    provider = getProviderForPty(ptyId)
  } catch {
    return false
  }
  if (!provider.killFenced || !provider.supportsFencedTermination?.(ptyId)) {
    return false
  }
  try {
    const result = await provider.killFenced({
      id: ptyId,
      expectedIncarnationId,
      requireNoAgentOwner: false,
      requireUnattached: false
    })
    return result.outcome === 'ended' || result.outcome === 'already_exited'
  } catch {
    return false
  }
}

async function stopAndWaitPty(
  deps: PtyRuntimeControllerDeps,
  ptyId: string,
  opts?: { keepHistory?: boolean; deadlineMs?: number }
): Promise<boolean> {
  const {
    runtime,
    store,
    getLocalPtyProviderStartupPromise,
    shutdownProviderAndDetectExit,
    finishPtyShutdown
  } = deps
  runtime?.markPtyStopRequested?.(ptyId)
  const connectionId = getPtySshConnectionId(ptyId)
  if (connectionId && isLegacyRelayBridgedPty(ptyId)) {
    // A reversible stop must not leave the bridge's durable stop behind, so the pane stays live.
    if (opts?.keepHistory) {
      return false
    }
    const stoppingIncarnationId = ptyIncarnationById.get(ptyId)
    const deadline = opts?.deadlineMs ?? Date.now() + OBSERVED_EXIT_RECORD_WAIT_MS
    const stopped = await Promise.race([
      stopLegacyRelayPaneAndWait(ptyId, deadline),
      delay(Math.max(1, deadline - Date.now())).then(() => null)
    ])
    if (stopped) {
      // The bridge retired the lease and holds no pane. An exit it saw already reached the runtime.
      const proof = PtyExitProof.from('absent', stoppingIncarnationId)
      const publishTo = stopped === 'reported' ? { ...deps, runtime: undefined } : deps
      publishSyntheticExit(
        publishTo,
        ptyId,
        0,
        await finishPtyShutdown(ptyId, null, store, proof),
        proof
      )
    }
    return stopped !== null
  }
  // Share one absolute teardown deadline across sequential awaits and RPC leaves.
  const deadlineMs = opts?.deadlineMs
  const startupPromise = getLocalPtyProviderStartupPromise(resolvePtyExecutionHost(ptyId))
  if (startupPromise) {
    // Resolve the provider only after startup; fallback cannot prove daemon teardown.
    if (deadlineMs !== undefined) {
      // Bound startup by teardown budget rather than the longer fail-open startup cap.
      const won = await Promise.race([
        // Rejected startup fails closed and must not leave an unhandled losing promise.
        startupPromise.then(
          () => true,
          () => false
        ),
        delay(Math.max(1, deadlineMs - Date.now())).then(() => false)
      ])
      if (!won) {
        return false
      }
    } else {
      await startupPromise
    }
  }
  let provider: IPtyProvider
  try {
    provider = getProviderForPty(ptyId)
  } catch {
    if (connectionId) {
      // Missing SSH provider cannot confirm remote exit; retain its tombstoned lease.
      const unproven = PtyRetirementWithoutProof.because(SSH_PROVIDER_UNREGISTERED_REASON)
      const incarnationId = await finishPtyShutdown(ptyId, connectionId, store, unproven)
      publishSyntheticExit(deps, ptyId, -1, incarnationId, unproven)
    }
    return false
  }
  const stoppingIncarnationId = ptyIncarnationById.get(ptyId)
  let providerExitObserved = false
  try {
    providerExitObserved = await shutdownProviderAndDetectExit(provider, ptyId, {
      immediate: true,
      keepHistory: opts?.keepHistory ?? false,
      deadlineMs
    })
  } catch (err) {
    if (!isPtyAlreadyGoneError(err)) {
      console.warn(`[pty] Failed to stop PTY ${ptyId}: ${errorMessage(err)}`)
      return false
    }
  }
  try {
    if (!(await verifyPtyStopped(provider, ptyId, opts, providerExitObserved))) {
      runtime?.markPtyLivenessLive?.(ptyId)
      return false
    }
  } catch (err) {
    console.warn(`[pty] Failed to verify PTY ${ptyId} stopped: ${errorMessage(err)}`)
    return false
  }
  const proof = PtyExitProof.from(
    providerExitObserved ? 'exit-observed' : 'absent',
    stoppingIncarnationId
  )
  const incarnationId = await finishPtyShutdown(ptyId, connectionId, store, proof)
  if (!providerExitObserved) {
    // Fresh owning-provider absence proves exit even if its event was missed.
    publishSyntheticExit(deps, ptyId, 0, incarnationId, proof)
  } else {
    // SSH exit records follow output drain; wait before returning a verdict consumers can read.
    const waitUntil = Math.min(deadlineMs ?? Infinity, Date.now() + OBSERVED_EXIT_RECORD_WAIT_MS)
    await runtime?.waitForPtyExitRecord?.(ptyId, waitUntil - Date.now())
  }
  return true
}
