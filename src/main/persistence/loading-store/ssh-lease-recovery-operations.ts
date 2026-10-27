import type { SshPendingPtyKill } from '../../../shared/ssh-pending-pty-kill'
import type { SshRemotePtyLease } from '../../../shared/ssh-types'
import type { PtyRetirementEvidence } from '../../pty-exit-proof'
import { PtyExitProof } from '../../pty-exit-proof'
import {
  getSshRemotePtyLeases as getSshRemotePtyLeasesOperation,
  markSshRemotePtyLease as markSshRemotePtyLeaseOperation,
  removeSshRemotePtyLeases as removeSshRemotePtyLeasesOperation,
  setSshRemotePtyLeasePendingKill as setSshRemotePtyLeasePendingKillOperation,
  type SshPtyLeaseOperations
} from '../leasing-ssh-ptys/ssh-pty-lease-operations'
import {
  clearSshRemotePtyBindingsForLeases as clearSshRemotePtyBindingsForLeasesOperation,
  clearSshRemotePtyBindingsForTarget as clearSshRemotePtyBindingsForTargetOperation,
  type SshPtyBindingCleanupOperations
} from '../leasing-ssh-ptys/ssh-pty-binding-cleanup'

import type { StoreRuntimeState } from './store-runtime-state'
import type { WriteFlushBarrierOperations } from './write-flush-barriers'
import type { TerminalBindingRecoveryOperations } from './terminal-binding-recovery'
import type { WriteSchedulingOperations } from './write-scheduling'
import { scheduleSave } from './write-scheduling'
import {
  sameLogicalLeafKeys,
  sshPtyBindingRetirementState,
  sshPtyCleanupMutationKeys
} from './ssh-lease-recovery-mutation-keys'
import type { TerminalLeafMutationKey } from '../../terminal-leaf-mutation-lane'

type SshLeaseRecoveryOperationsRuntime = Pick<
  StoreRuntimeState,
  'dirtyProfileStateDomains' | 'state' | 'terminalLeafMutationLane'
>

const sshLeaseRecoveryOperationsContext = Symbol('SshLeaseRecoveryOperations')
type SshLeaseRecoveryOperationsContext = {
  runtime: SshLeaseRecoveryOperationsRuntime
  flushBarriers: WriteFlushBarrierOperations
  bindingRecovery: TerminalBindingRecoveryOperations
  scheduling: WriteSchedulingOperations
}

export class SshLeaseRecoveryOperations {
  readonly [sshLeaseRecoveryOperationsContext]: SshLeaseRecoveryOperationsContext

  constructor(
    runtime: SshLeaseRecoveryOperationsRuntime,
    flushBarriers: WriteFlushBarrierOperations,
    bindingRecovery: TerminalBindingRecoveryOperations,
    scheduling: WriteSchedulingOperations
  ) {
    this[sshLeaseRecoveryOperationsContext] = {
      runtime,
      flushBarriers,
      bindingRecovery,
      scheduling
    }
  }

  getSshRemotePtyLeases(targetId?: string): SshRemotePtyLease[] {
    return getSshRemotePtyLeasesOperation(
      this[sshLeaseRecoveryOperationsContext].runtime.state,
      targetId
    )
  }

  /** Keys a stop/kill caller must hold before retiring this legacy SSH lease. */
  getSshPtyRetirementMutationKeys(targetId: string, ptyId: string): TerminalLeafMutationKey[] {
    return sshPtyBindingRetirementState(this[sshLeaseRecoveryOperationsContext], targetId, ptyId)
      .keys
  }

  async markSshRemotePtyLease(
    targetId: string,
    ptyId: string,
    evidence: PtyRetirementEvidence
  ): Promise<void> {
    const context = this[sshLeaseRecoveryOperationsContext]
    const before = sshPtyBindingRetirementState(
      this[sshLeaseRecoveryOperationsContext],
      targetId,
      ptyId
    )
    await context.runtime.terminalLeafMutationLane.run(before.keys, () => {
      const current = sshPtyBindingRetirementState(
        this[sshLeaseRecoveryOperationsContext],
        targetId,
        ptyId
      )
      const expectedIncarnationId =
        evidence instanceof PtyExitProof ? evidence.incarnationId : undefined
      const identityMatches =
        !current.hasUnfencedBinding &&
        current.matchingIncarnationIds.every(
          (incarnationId) => incarnationId === expectedIncarnationId
        )
      const operations = getSshPtyLeaseOperations(this)
      if (current.fingerprint !== before.fingerprint || !identityMatches) {
        operations.clearBindingsForLeases = () => false
      }
      markSshRemotePtyLeaseOperation(operations, targetId, ptyId, evidence)
    })
  }

  setSshRemotePtyLeasePendingKill(
    targetId: string,
    ptyId: string,
    pendingKill: SshPendingPtyKill | null
  ): void {
    setSshRemotePtyLeasePendingKillOperation(
      getSshPtyLeaseOperations(this),
      targetId,
      ptyId,
      pendingKill
    )
  }

  async removeSshRemotePtyLeases(targetId: string): Promise<void> {
    const context = this[sshLeaseRecoveryOperationsContext]
    for (;;) {
      const keys = sshPtyCleanupMutationKeys(this[sshLeaseRecoveryOperationsContext], targetId)
      let keysChanged = false
      await context.runtime.terminalLeafMutationLane.run(keys, () => {
        // A matching leaf may have appeared while this cleanup waited for an earlier leaf. Do not
        // clear it outside its lane: release and retry with the expanded, deterministically sorted
        // key set. The final scan and synchronous scrub cannot interleave on the main JS thread.
        const currentKeys = sshPtyCleanupMutationKeys(
          this[sshLeaseRecoveryOperationsContext],
          targetId
        )
        if (!sameLogicalLeafKeys(keys, currentKeys)) {
          keysChanged = true
          return
        }
        removeSshRemotePtyLeasesOperation(getSshPtyLeaseOperations(this), targetId)
      })
      if (!keysChanged) {
        return
      }
    }
  }
}

function getSshPtyBindingCleanupOperations(
  owner: SshLeaseRecoveryOperations
): SshPtyBindingCleanupOperations {
  return {
    state: owner[sshLeaseRecoveryOperationsContext].runtime.state,
    toComparablePtyId: (targetId, ptyId) =>
      owner[sshLeaseRecoveryOperationsContext].bindingRecovery.getRelayPtyIdForSshLeaseComparison(
        targetId,
        ptyId
      ),
    scheduleSave: () => scheduleSave(owner[sshLeaseRecoveryOperationsContext].scheduling)
  }
}

function getSshPtyLeaseOperations(owner: SshLeaseRecoveryOperations): SshPtyLeaseOperations {
  return {
    state: owner[sshLeaseRecoveryOperationsContext].runtime.state,
    toStoredPtyId: (targetId, ptyId) =>
      owner[sshLeaseRecoveryOperationsContext].bindingRecovery.getRelayPtyIdForSshLeaseStorage(
        targetId,
        ptyId
      ),
    toComparablePtyId: (targetId, ptyId) =>
      owner[sshLeaseRecoveryOperationsContext].bindingRecovery.getRelayPtyIdForSshLeaseComparison(
        targetId,
        ptyId
      ),
    clearBindingsForTarget: (targetId) =>
      clearSshRemotePtyBindingsForTargetOperation(
        getSshPtyBindingCleanupOperations(owner),
        targetId
      ),
    clearBindingsForLeases: (targetId, leases) =>
      clearSshRemotePtyBindingsForLeasesOperation(
        getSshPtyBindingCleanupOperations(owner),
        targetId,
        leases
      ),
    flush: () => {
      owner[sshLeaseRecoveryOperationsContext].runtime.dirtyProfileStateDomains?.add(
        'sshRemotePtyLeases'
      )
      owner[sshLeaseRecoveryOperationsContext].flushBarriers.flush()
    }
  }
}
