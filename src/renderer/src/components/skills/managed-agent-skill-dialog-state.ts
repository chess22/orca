import type {
  ManagedAgentSkillFallback,
  ManagedAgentSkillScope,
  SkillSourceKind
} from '../../../../shared/skills'
import { shouldEmitManagedAgentSkillFallback } from '../../../../shared/skills'
import { ensureOrcaCliAvailableForAgentSkillTerminal } from '@/lib/agent-skill-cli-prerequisite'

export type ManagedAgentSkillDialogState = {
  active: ManagedAgentSkillFallback | null
  queue: ManagedAgentSkillFallback[]
}

const GLOBAL_SKILL_SOURCE_KINDS = ['home'] as const satisfies readonly SkillSourceKind[]
const PROJECT_SKILL_SOURCE_KINDS = ['repo'] as const satisfies readonly SkillSourceKind[]
const BUNDLED_SKILL_SOURCE_KINDS = ['bundled'] as const satisfies readonly SkillSourceKind[]
const PLUGIN_SKILL_SOURCE_KINDS = ['plugin'] as const satisfies readonly SkillSourceKind[]

export function enqueueManagedAgentSkillFallback(
  current: ManagedAgentSkillDialogState,
  event: ManagedAgentSkillFallback
): ManagedAgentSkillDialogState {
  return current.active
    ? { active: current.active, queue: [...current.queue, event] }
    : { active: event, queue: current.queue }
}

export function advanceManagedAgentSkillFallbackQueue(
  current: ManagedAgentSkillDialogState
): ManagedAgentSkillDialogState {
  const [next, ...rest] = current.queue
  return { active: next ?? null, queue: rest }
}

export function replaceActiveAfterManagedAgentSkillRecheck(
  current: ManagedAgentSkillDialogState,
  event: ManagedAgentSkillFallback
): ManagedAgentSkillDialogState {
  return shouldEmitManagedAgentSkillFallback(event)
    ? { ...current, active: event }
    : advanceManagedAgentSkillFallbackQueue(current)
}

export function getInstalledStateSourceKinds(
  scope: ManagedAgentSkillScope
): readonly SkillSourceKind[] | undefined {
  switch (scope) {
    case 'global':
    case 'missing':
      return GLOBAL_SKILL_SOURCE_KINDS
    case 'project':
      return PROJECT_SKILL_SOURCE_KINDS
    case 'bundled':
      return BUNDLED_SKILL_SOURCE_KINDS
    case 'plugin':
      return PLUGIN_SKILL_SOURCE_KINDS
  }
}

export async function prepareManagedAgentSkillSetupTerminal(): Promise<void> {
  await ensureOrcaCliAvailableForAgentSkillTerminal()
}
