import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedAgentSkillFallback } from '../../../../shared/skills'
import {
  getManagedSkillFallbackDisplayMessage,
  getManagedSkillContextCopy
} from './managed-agent-skill-dialog-copy'
import {
  advanceManagedAgentSkillFallbackQueue,
  enqueueManagedAgentSkillFallback,
  getInstalledStateSourceKinds,
  prepareManagedAgentSkillSetupTerminal,
  replaceActiveAfterManagedAgentSkillRecheck
} from './managed-agent-skill-dialog-state'

const cliPrerequisiteMocks = vi.hoisted(() => ({
  ensureOrcaCliAvailableForAgentSkillTerminal: vi.fn()
}))

vi.mock('@/lib/agent-skill-cli-prerequisite', () => ({
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE: 'CLI registration notice',
  ensureOrcaCliAvailableForAgentSkillTerminal:
    cliPrerequisiteMocks.ensureOrcaCliAvailableForAgentSkillTerminal,
  isOrcaCliAvailableOnPath: vi.fn()
}))

function fallback(
  patch: Partial<ManagedAgentSkillFallback> & Pick<ManagedAgentSkillFallback, 'context'>
): ManagedAgentSkillFallback {
  const skillName = patch.skillName ?? 'orchestration'
  const runtime = patch.runtime ?? 'host'
  const scope = patch.scope ?? 'global'
  return {
    status: 'fallback',
    skillName,
    context: patch.context,
    runtime,
    scope,
    reason: patch.reason ?? 'background-update-disabled',
    uiKey: patch.uiKey ?? [runtime, '', skillName, patch.context].join(':'),
    message: patch.message ?? 'Fallback message.',
    manualCommand: patch.manualCommand,
    request: patch.request ?? {
      skillName,
      context: patch.context,
      ...(runtime === 'remote' ? { remoteRuntime: true } : { discoveryTarget: { runtime: 'host' } })
    }
  }
}

beforeEach(() => {
  cliPrerequisiteMocks.ensureOrcaCliAvailableForAgentSkillTerminal.mockReset()
})

describe('ManagedAgentSkillSetupDialogHost copy', () => {
  it('names the agent-triggered orchestration context', () => {
    expect(getManagedSkillContextCopy('agent-orchestration')).toBe(
      'An agent just tried to use Orca orchestration. Orca needs the orchestration skill before agents can coordinate reliably.'
    )
  })

  it('names the Linear worktree context', () => {
    expect(getManagedSkillContextCopy('linear-worktree')).toBe(
      'This Linear task workflow needs the Linear agent skill. Orca could not update it automatically.'
    )
  })

  it('localizes fallback reason copy in the renderer', () => {
    expect(getManagedSkillFallbackDisplayMessage('remote-runtime')).toBe(
      'Remote runtimes are not updated in the background.'
    )
  })
})

describe('ManagedAgentSkillSetupDialogHost queue state', () => {
  it('prepares the Orca CLI before opening the setup terminal', async () => {
    cliPrerequisiteMocks.ensureOrcaCliAvailableForAgentSkillTerminal.mockResolvedValue(null)

    await prepareManagedAgentSkillSetupTerminal()

    expect(cliPrerequisiteMocks.ensureOrcaCliAvailableForAgentSkillTerminal).toHaveBeenCalledOnce()
  })

  it('returns stable source-kind filters for installed-state refreshes', () => {
    expect(getInstalledStateSourceKinds('global')).toBe(getInstalledStateSourceKinds('global'))
    expect(getInstalledStateSourceKinds('project')).toBe(getInstalledStateSourceKinds('project'))
    expect(getInstalledStateSourceKinds('bundled')).toBe(getInstalledStateSourceKinds('bundled'))
    expect(getInstalledStateSourceKinds('plugin')).toBe(getInstalledStateSourceKinds('plugin'))
  })

  it('shows the first fallback immediately and queues later fallbacks FIFO', () => {
    const first = fallback({
      context: 'agent-orchestration',
      uiKey: 'host::orchestration:agent-orchestration'
    })
    const second = fallback({
      skillName: 'computer-use',
      context: 'agent-computer-use',
      uiKey: 'host::computer-use:agent-computer-use'
    })

    const withFirst = enqueueManagedAgentSkillFallback({ active: null, queue: [] }, first)
    const withSecond = enqueueManagedAgentSkillFallback(withFirst, second)

    expect(withSecond).toEqual({ active: first, queue: [second] })
    expect(advanceManagedAgentSkillFallbackQueue(withSecond)).toEqual({
      active: second,
      queue: []
    })
  })

  it('clears the active fallback when the queue is empty', () => {
    const event = fallback({
      context: 'agent-orchestration',
      uiKey: 'host::orchestration:agent-orchestration'
    })

    expect(advanceManagedAgentSkillFallbackQueue({ active: event, queue: [] })).toEqual({
      active: null,
      queue: []
    })
  })

  it('does not replace the active modal with a non-actionable re-check fallback', () => {
    const active = fallback({
      context: 'agent-orchestration',
      uiKey: 'host::orchestration:agent-orchestration',
      manualCommand: {
        kind: 'install',
        command: 'npx skills install orchestration',
        runtime: 'host',
        scope: 'global'
      }
    })
    const deadEndFallback = fallback({
      context: 'agent-orchestration',
      reason: 'lockfile-malformed',
      uiKey: 'host::orchestration:agent-orchestration'
    })

    expect(
      replaceActiveAfterManagedAgentSkillRecheck({ active, queue: [] }, deadEndFallback)
    ).toEqual({
      active: null,
      queue: []
    })
  })
})
