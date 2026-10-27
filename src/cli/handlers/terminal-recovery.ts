import type { TerminalConditionalRespawnResult } from '../../shared/terminal-conditional-respawn'
import type { TerminalEmptyLeafRecoveryResult } from '../../shared/terminal-empty-leaf-recovery'
import * as capabilities from '../../shared/protocol-version'
import type { CommandHandler } from '../dispatch'
import * as cliFlags from '../flags'
import * as output from '../format'
import { RuntimeClientError } from '../runtime-client'
import * as handlerValues from './terminal-handler-values'

async function requireRecoveryCapability(
  client: Parameters<CommandHandler>[0]['client'],
  capability: string,
  message: string
): Promise<void> {
  const status = await client.getCliStatus()
  if (status.result.runtime.capabilities?.includes(capability) !== true) {
    throw new RuntimeClientError('incompatible_runtime', message)
  }
}

const terminalRespawnIfMatch: CommandHandler = async ({ flags, client, json }) => {
  const mutationId = cliFlags.getRequiredStringFlag(flags, 'mutation-id')
  await requireRecoveryCapability(
    client,
    capabilities.TERMINAL_CONDITIONAL_RESPAWN_RUNTIME_CAPABILITY,
    'This Orca host does not support conditional terminal respawn. Nothing was changed.'
  )
  const result = await client.call<{ respawn: TerminalConditionalRespawnResult }>(
    'terminal.respawnIfMatch',
    {
      mutationId,
      terminal: cliFlags.getRequiredStringFlag(flags, 'terminal'),
      expected: {
        worktreeId: cliFlags.getRequiredStringFlag(flags, 'expected-worktree-id'),
        tabId: cliFlags.getRequiredStringFlag(flags, 'expected-tab-id'),
        leafId: cliFlags.getRequiredStringFlag(flags, 'expected-leaf-id'),
        ptyId: cliFlags.getRequiredStringFlag(flags, 'expected-pty-id'),
        ptyGeneration: handlerValues.getRequiredNonNegativeIntegerFlag(
          flags,
          'expected-pty-generation'
        ),
        incarnationId: cliFlags.getRequiredStringFlag(flags, 'expected-incarnation-id'),
        rootProcessId: handlerValues.getRequiredPositiveIntegerFlag(flags, 'expected-root-pid')
      },
      replacement: {
        cols: handlerValues.getRequiredPositiveIntegerFlag(flags, 'cols'),
        rows: handlerValues.getRequiredPositiveIntegerFlag(flags, 'rows'),
        cwd: cliFlags.getRequiredStringFlag(flags, 'cwd'),
        command: cliFlags.getRequiredStringFlag(flags, 'command')
      }
    }
  )
  output.printResult(result, json, (value) => {
    const respawn = value.respawn
    return respawn.outcome === 'respawned'
      ? `Respawned terminal ${respawn.ptyId}.`
      : `Terminal respawn ${respawn.outcome}: ${respawn.reason}`
  })
  if (result.result.respawn.outcome !== 'respawned') {
    process.exitCode =
      result.result.respawn.outcome === 'precondition_failed'
        ? 10
        : result.result.respawn.outcome === 'unsupported'
          ? 125
          : 1
  }
}

const terminalRecoverEmptyLeafIfMatch: CommandHandler = async ({ flags, client, json }) => {
  const request = {
    originalMutationId: cliFlags.getRequiredStringFlag(flags, 'original-mutation-id'),
    recoveryId: cliFlags.getRequiredStringFlag(flags, 'recovery-id'),
    terminal: cliFlags.getRequiredStringFlag(flags, 'terminal'),
    expected: {
      worktreeId: cliFlags.getRequiredStringFlag(flags, 'expected-worktree-id'),
      tabId: cliFlags.getRequiredStringFlag(flags, 'expected-tab-id'),
      leafId: cliFlags.getRequiredStringFlag(flags, 'expected-leaf-id'),
      ptyId: cliFlags.getRequiredStringFlag(flags, 'expected-pty-id'),
      ptyGeneration: handlerValues.getRequiredNonNegativeIntegerFlag(
        flags,
        'expected-pty-generation'
      ),
      retiredIncarnationId: cliFlags.getRequiredStringFlag(flags, 'retired-incarnation-id'),
      layoutEpoch: handlerValues.getRequiredNonNegativeIntegerFlag(flags, 'layout-epoch'),
      persistedBindingVersion: handlerValues.getRequiredNonNegativeIntegerFlag(
        flags,
        'persisted-binding-version'
      ),
      tombstoneId: cliFlags.getRequiredStringFlag(flags, 'tombstone-id')
    },
    replacement: {
      command: cliFlags.getRequiredStringFlag(flags, 'command'),
      cwd: cliFlags.getRequiredStringFlag(flags, 'cwd'),
      cols: handlerValues.getRequiredPositiveIntegerFlag(flags, 'cols'),
      rows: handlerValues.getRequiredPositiveIntegerFlag(flags, 'rows')
    }
  }
  await requireRecoveryCapability(
    client,
    capabilities.TERMINAL_EMPTY_LEAF_RECOVERY_RUNTIME_CAPABILITY,
    'This Orca host does not support empty-leaf terminal recovery. Nothing was changed.'
  )
  const result = await client.call<{ recovery: TerminalEmptyLeafRecoveryResult }>(
    'terminal.recoverEmptyLeafIfMatch',
    request
  )
  output.printResult(result, json, (value) => {
    const recovery = value.recovery
    return recovery.outcome === 'recovered'
      ? `Recovered terminal ${recovery.ptyId}.`
      : `Terminal recovery ${recovery.outcome}: ${recovery.reason}`
  })
  if (result.result.recovery.outcome !== 'recovered') {
    process.exitCode = result.result.recovery.outcome === 'precondition_failed' ? 10 : 1
  }
}

export const TERMINAL_RECOVERY_HANDLERS: Record<string, CommandHandler> = {
  'terminal respawn-if-match': terminalRespawnIfMatch,
  'terminal recover-empty-leaf-if-match': terminalRecoverEmptyLeafIfMatch
}
