import type * as RuntimeTypes from '../../shared/runtime-types'
import type { TerminalConditionalRespawnResult } from '../../shared/terminal-conditional-respawn'
import type { TerminalEmptyLeafRecoveryResult } from '../../shared/terminal-empty-leaf-recovery'
import type { CommandHandler } from '../dispatch'
import { shouldUseRendererBackedInteractiveTerminal } from '../codex-command-classification'
import * as output from '../format'
import * as cliFlags from '../flags'
import { RuntimeClientError } from '../runtime-client'
import * as hostScope from '../omitted-host-scope-selectors'
import * as windowsShell from '../../shared/windows-terminal-shell'
import * as capabilities from '../../shared/protocol-version'
import * as selectors from '../selectors'
import { revealPairedTerminalOnLocalDesktop } from '../paired-terminal-desktop-reveal'
import { terminalCloseHandler } from './terminal-close'
import { terminalSendHandler } from './terminal-send'

import * as handlerValues from './terminal-handler-values'

type TerminalFocusResult = { focus: RuntimeTypes.RuntimeTerminalFocus }

async function requireRuntimeCapability(
  client: Parameters<CommandHandler>[0]['client'],
  capability: string,
  incompatibleMessage: string,
  unavailableMessage?: string
): Promise<void> {
  const status = await client.getCliStatus()
  if (unavailableMessage && !status.result.runtime.reachable) {
    throw new RuntimeClientError('runtime_unavailable', unavailableMessage)
  }
  if (status.result.runtime.capabilities?.includes(capability) !== true) {
    throw new RuntimeClientError('incompatible_runtime', incompatibleMessage)
  }
}

const terminalFocusHandler: CommandHandler = async ({ flags, client, cwd, json }) => {
  const terminal = await selectors.getTerminalHandle(flags, cwd, client)
  const params = { terminal, navigation: 'host' as const }
  const result = await client.call<TerminalFocusResult>('terminal.focus', params)
  if (client.isRemote && result.result.focus.navigated === false) {
    result.result.focus.navigated = await revealPairedTerminalOnLocalDesktop(client, terminal)
  }
  output.printResult(result, json, output.formatTerminalFocus)
}

export const TERMINAL_HANDLERS: Record<string, CommandHandler> = {
  'terminal list': async ({ flags, client, cwd, json }) => {
    const result = await client.call<
      hostScope.WithAnnotatedHostScope<RuntimeTypes.RuntimeTerminalListResult>
    >('terminal.list', {
      worktree: await selectors.getOptionalWorktreeSelector(flags, 'worktree', cwd, client),
      limit: cliFlags.getOptionalPositiveIntegerFlag(flags, 'limit'),
      includeVisualLayouts: !json || flags.has('include-visual-layouts')
    })
    await hostScope.annotateOmittedHostScope(result.result)
    output.printResult(result, json, output.formatTerminalList)
  },
  'terminal show': async ({ flags, client, cwd, json }) => {
    const terminal = await selectors.getTerminalHandle(flags, cwd, client)
    const result = await client.call<{ terminal: RuntimeTypes.RuntimeTerminalShow }>(
      'terminal.show',
      { terminal }
    )
    output.printResult(result, json, output.formatTerminalShow)
  },
  'terminal read': async ({ flags, client, cwd, json }) => {
    const cursorFlag = cliFlags.getOptionalStringFlag(flags, 'cursor')
    const cursor =
      cursorFlag !== undefined && /^\d+$/.test(cursorFlag)
        ? Number.parseInt(cursorFlag, 10)
        : undefined
    if (cursorFlag !== undefined && cursor === undefined) {
      throw new RuntimeClientError('invalid_argument', '--cursor must be a non-negative integer')
    }
    const screen = flags.get('screen') === true
    if (screen && cursorFlag !== undefined) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--screen reads the current rendered screen, which has no cursor to page from. Use --cursor without --screen to page through accumulated output.'
      )
    }
    const result = await client.call<{ terminal: RuntimeTypes.RuntimeTerminalRead }>(
      'terminal.read',
      {
        terminal: await selectors.getTerminalHandle(flags, cwd, client),
        ...(cursor !== undefined ? { cursor } : {}),
        ...(screen ? { screen: true } : {}),
        limit: cliFlags.getOptionalPositiveIntegerFlag(flags, 'limit')
      }
    )
    if (screen && result.result.terminal.source === undefined) {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'This Orca host does not support --screen reads, so it answered with accumulated output instead of the rendered screen. Update Orca on the host, or drop --screen to read accumulated output deliberately.'
      )
    }
    output.printResult(result, json, output.formatTerminalRead)
  },
  'terminal send': terminalSendHandler,
  'terminal wait': async ({ flags, client, cwd, json }) => {
    const timeoutMs = cliFlags.getOptionalPositiveIntegerFlag(flags, 'timeout-ms')
    const result = await client.call<{ wait: RuntimeTypes.RuntimeTerminalWait }>(
      'terminal.wait',
      {
        terminal: await selectors.getTerminalHandle(flags, cwd, client),
        for: cliFlags.getRequiredStringFlag(flags, 'for'),
        timeoutMs
      },
      {
        timeoutMs: timeoutMs ? timeoutMs + 5000 : handlerValues.DEFAULT_TERMINAL_WAIT_RPC_TIMEOUT_MS
      }
    )
    output.printResult(result, json, output.formatTerminalWait)
    if (result.result.wait.satisfied === false) {
      process.exitCode = 1
    }
  },
  'terminal stop': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ stopped: number }>('terminal.stop', {
      worktree: await selectors.getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
    })
    output.printResult(result, json, (value) => `Stopped ${value.stopped} terminals.`)
  },
  'terminal rename': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ rename: RuntimeTypes.RuntimeTerminalRename }>(
      'terminal.rename',
      {
        terminal: await selectors.getTerminalHandle(flags, cwd, client),
        title: cliFlags.getOptionalStringFlag(flags, 'title') ?? null
      }
    )
    output.printResult(result, json, output.formatTerminalRename)
  },
  'terminal set-pane-title': async ({ flags, client, cwd, json }) => {
    const title = cliFlags.getRequiredStringFlagAllowingEmpty(flags, 'title')
    const result = await client.call<{ paneTitle: RuntimeTypes.RuntimeTerminalSetPaneTitle }>(
      'terminal.setPaneTitle',
      { terminal: await selectors.getTerminalHandle(flags, cwd, client), title }
    )
    output.printResult(result, json, output.formatTerminalSetPaneTitle)
  },
  'terminal create': async ({ flags, client, cwd, json }) => {
    if (client.isRemote && !flags.has('worktree')) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Remote terminal create requires --worktree because the client cwd cannot identify a server worktree.'
      )
    }
    const command = cliFlags.getOptionalStringFlag(flags, 'command')
    const useRendererBackedInteractiveTerminal =
      !client.isRemote && shouldUseRendererBackedInteractiveTerminal(command)
    const focus = flags.get('focus') === true
    const shell = cliFlags.getOptionalStringFlag(flags, 'shell')
    if (shell !== undefined) {
      if (!windowsShell.isSupportedWindowsShellOverride(shell)) {
        throw new RuntimeClientError(
          'invalid_argument',
          `--shell must be one of: ${windowsShell.listSupportedWindowsShellOverrides().join(', ')}`
        )
      }
      await requireRuntimeCapability(
        client,
        capabilities.TERMINAL_CREATE_SHELL_SELECTION_RUNTIME_CAPABILITY,
        'This Orca host does not support --shell, and would silently create a terminal running its default shell instead. No terminal was created; update Orca on the execution host.',
        'Orca could not verify --shell support on the execution host, so no terminal was created. Wait for the execution host to become reachable and retry.'
      )
    }
    const result = await client.call<{ terminal: RuntimeTypes.RuntimeTerminalCreate }>(
      'terminal.create',
      {
        worktree: await selectors.getBrowserWorktreeSelector(flags, cwd, client),
        command,
        ...(shell !== undefined ? { shell } : {}),
        title: cliFlags.getOptionalStringFlag(flags, 'title'),
        focus,
        ...(focus ? { presentation: 'focused' } : {}),
        ...(useRendererBackedInteractiveTerminal ? { rendererBacked: true, activate: focus } : {})
      }
    )
    output.printResult(result, json, output.formatTerminalCreate)
  },
  'terminal switch': terminalFocusHandler,
  'terminal close': terminalCloseHandler,
  'terminal respawn-if-match': async ({ flags, client, json }) => {
    const mutationId = cliFlags.getRequiredStringFlag(flags, 'mutation-id')
    await requireRuntimeCapability(
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
      if (respawn.outcome === 'respawned') {
        return `Respawned terminal ${respawn.ptyId}.`
      }
      return `Terminal respawn ${respawn.outcome}: ${respawn.reason}`
    })
    if (result.result.respawn.outcome !== 'respawned') {
      process.exitCode =
        result.result.respawn.outcome === 'precondition_failed'
          ? 10
          : result.result.respawn.outcome === 'unsupported'
            ? 125
            : 1
    }
  },
  'terminal recover-empty-leaf-if-match': async ({ flags, client, json }) => {
    const result = await client.call<{ recovery: TerminalEmptyLeafRecoveryResult }>(
      'terminal.recoverEmptyLeafIfMatch',
      {
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
  },
  'terminal split': async ({ flags, client, cwd, json }) => {
    const directionFlag = cliFlags.getOptionalStringFlag(flags, 'direction')
    if (
      directionFlag !== undefined &&
      directionFlag !== 'horizontal' &&
      directionFlag !== 'vertical'
    ) {
      throw new RuntimeClientError('invalid_argument', '--direction must be horizontal or vertical')
    }
    const retrySplit = flags.has('retry-split')
      ? cliFlags.getRequiredStringFlag(flags, 'retry-split')
      : undefined
    if (retrySplit !== undefined) {
      await requireRuntimeCapability(
        client,
        capabilities.TERMINAL_SPLIT_RETRY_RUNTIME_CAPABILITY,
        'This Orca host does not support --retry-split and would split again. Nothing was split; check `orca terminal list --json` for the pane instead.',
        'Orca could not verify --retry-split support on the execution host, so nothing was split. Wait for the execution host to become reachable and retry.'
      )
    }
    const result = await client.call<{ split: RuntimeTypes.RuntimeTerminalSplit }>(
      'terminal.split',
      {
        terminal: await selectors.getTerminalHandle(flags, cwd, client),
        direction: directionFlag,
        command: cliFlags.getOptionalStringFlag(flags, 'command'),
        ...(retrySplit !== undefined ? { retrySplit } : {})
      }
    )
    output.printResult(result, json, output.formatTerminalSplit)
  }
}
