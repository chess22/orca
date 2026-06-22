import type { Store } from '../persistence'
import { shouldEmitManagedAgentSkillFallback } from '../../shared/skills'
import type { RuntimeManagedSkillNudgeHandler } from '../runtime/rpc/managed-skill-nudge'
import { getManagedSkillUpdateCoordinator } from '../skills/managed-skill-updates'
import { sendManagedSkillFallback, sendManagedSkillUpdated } from './skills'

export function createRuntimeManagedSkillNudge(store: Store): RuntimeManagedSkillNudgeHandler {
  return async ({ skillName, context, remoteRuntime, discoveryTarget }) => {
    const result = await getManagedSkillUpdateCoordinator(store).ensureManagedReady({
      skillName,
      context,
      ...(remoteRuntime ? { remoteRuntime } : {}),
      ...(!remoteRuntime && discoveryTarget ? { discoveryTarget } : {})
    })
    if (shouldEmitManagedAgentSkillFallback(result)) {
      sendManagedSkillFallback(result)
    } else if (result.status === 'updated') {
      sendManagedSkillUpdated(result)
    }
  }
}
