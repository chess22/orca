import { randomUUID } from 'node:crypto'
import { basename, isAbsolute } from 'node:path'
import type { UpdateStatus } from '../../shared/update-status-types'
import type {
  HeadlessLocalBuildInstallPhase,
  HeadlessLocalBuildInstallRequest,
  HeadlessLocalBuildInstallSnapshot,
  HeadlessLocalBuildInstallTransition
} from '../../shared/headless-local-build-install'

export type {
  HeadlessLocalBuildInstallRequest,
  HeadlessLocalBuildInstallSnapshot
} from '../../shared/headless-local-build-install'

export type HeadlessLocalBuildInstallAction = 'download' | 'install' | null
export type HeadlessLocalBuildQueuedAction = {
  action: Exclude<HeadlessLocalBuildInstallAction, null>
  operationId: string
  expectedVersion: string
  expectedSource: 'local'
  expectedFeedIdentity: string
}

const SHA256 = /^[a-f0-9]{64}$/

export function assertHeadlessLocalBuildInstallRequest(
  request: HeadlessLocalBuildInstallRequest
): void {
  if (!isAbsolute(request.manifestPath) || basename(request.manifestPath) !== 'latest-mac.yml') {
    throw new Error('manifestPath must name an exact latest-mac.yml path.')
  }
  if (!SHA256.test(request.expectedManifestSha256)) {
    throw new Error('expectedManifestSha256 must be a lowercase SHA-256 digest.')
  }
  if (!SHA256.test(request.expectedArtifactSha256)) {
    throw new Error('expectedArtifactSha256 must be a lowercase SHA-256 digest.')
  }
}

export class HeadlessLocalBuildInstallTracker {
  private snapshot: HeadlessLocalBuildInstallSnapshot | null = null
  private actionQueued: HeadlessLocalBuildQueuedAction | null = null

  begin(request: HeadlessLocalBuildInstallRequest): HeadlessLocalBuildInstallSnapshot {
    assertHeadlessLocalBuildInstallRequest(request)
    const initial = this.transition('validating')
    this.snapshot = {
      operationId: randomUUID(),
      ...request,
      current: initial,
      transitions: [initial]
    }
    this.actionQueued = null
    return this.get()!
  }

  get(): HeadlessLocalBuildInstallSnapshot | null {
    return this.snapshot ? structuredClone(this.snapshot) : null
  }

  markChecking(version: string): void {
    this.record({ phase: 'checking', version })
  }

  markInstalling(): void {
    if (this.snapshot) {
      this.record({ phase: 'installing', version: this.snapshot.current.version })
    }
  }

  markRelaunching(env: NodeJS.ProcessEnv = process.env): void {
    if (this.snapshot) {
      env.ORCA_BACKGROUND_LAUNCH = '1'
      this.record({ phase: 'relaunching', version: this.snapshot.current.version })
    }
  }

  fail(error: unknown): void {
    if (this.snapshot) {
      this.record({
        phase: 'failed',
        version: this.snapshot.current.version,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  observeUpdaterStatus(
    status: UpdateStatus,
    feedIdentity: string | null
  ): HeadlessLocalBuildInstallAction {
    if (!this.snapshot || status.source !== 'local') {
      return null
    }
    switch (status.state) {
      case 'checking':
        return null
      case 'available':
        this.record({ phase: 'available', version: status.version })
        return this.queueAction('download', status.version, feedIdentity)
      case 'downloading':
        this.record({ phase: 'downloading', version: status.version, percent: status.percent })
        return null
      case 'downloaded':
        this.record({
          phase: status.installing ? 'installing' : 'staged',
          version: status.version
        })
        return status.installing ? null : this.queueAction('install', status.version, feedIdentity)
      case 'error':
        this.record({ phase: 'failed', version: status.version, message: status.message })
        return null
      case 'not-available':
        this.record({ phase: 'failed', message: 'The verified local build was not available.' })
        return null
      case 'idle':
        return null
    }
  }

  takeAction(
    queued: HeadlessLocalBuildQueuedAction,
    observed: { version: string | null; source: string; feedIdentity: string | null }
  ): 'accepted' | 'missing' | 'drifted' {
    if (
      this.snapshot?.operationId !== queued.operationId ||
      this.actionQueued?.operationId !== queued.operationId ||
      this.actionQueued.action !== queued.action
    ) {
      return 'missing'
    }
    this.actionQueued = null
    if (
      observed.version !== queued.expectedVersion ||
      observed.source !== queued.expectedSource ||
      observed.feedIdentity !== queued.expectedFeedIdentity
    ) {
      return 'drifted'
    }
    return 'accepted'
  }

  getQueuedAction(
    action: Exclude<HeadlessLocalBuildInstallAction, null>
  ): HeadlessLocalBuildQueuedAction | null {
    return this.actionQueued?.action === action ? { ...this.actionQueued } : null
  }

  private queueAction(
    action: Exclude<HeadlessLocalBuildInstallAction, null>,
    expectedVersion: string,
    expectedFeedIdentity: string | null
  ): HeadlessLocalBuildInstallAction {
    if (this.actionQueued) {
      return null
    }
    if (!this.snapshot || !expectedFeedIdentity) {
      this.fail(new Error('The verified local build feed identity is unavailable.'))
      return null
    }
    this.actionQueued = {
      action,
      operationId: this.snapshot.operationId,
      expectedVersion,
      expectedSource: 'local',
      expectedFeedIdentity
    }
    return action
  }

  private record(value: Omit<HeadlessLocalBuildInstallTransition, 'at'>): void {
    if (!this.snapshot) {
      return
    }
    const next = this.transition(value.phase, value)
    if (
      this.snapshot.current.phase === next.phase &&
      this.snapshot.current.version === next.version &&
      this.snapshot.current.percent === next.percent &&
      this.snapshot.current.message === next.message
    ) {
      return
    }
    this.snapshot.current = next
    this.snapshot.transitions.push(next)
  }

  private transition(
    phase: HeadlessLocalBuildInstallPhase,
    fields: Omit<HeadlessLocalBuildInstallTransition, 'phase' | 'at'> = {}
  ): HeadlessLocalBuildInstallTransition {
    return { phase, at: Date.now(), ...fields }
  }
}
