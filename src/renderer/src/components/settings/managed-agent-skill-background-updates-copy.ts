import { translate } from '@/i18n/i18n'
import { searchKeywords } from './settings-search-keywords'

export function getManagedAgentSkillBackgroundUpdatesTitle(): string {
  return translate(
    'auto.components.settings.managed.agent.skill.background.updates.title',
    'Allow verified Orca skill updates'
  )
}

export function getManagedAgentSkillBackgroundUpdatesDescription(): string {
  return translate(
    'auto.components.settings.managed.agent.skill.background.updates.description',
    'When Orca has verified install metadata and a safe update path, it can try managed agent skill updates in the background. Turn this off to review updates manually.'
  )
}

export function getManagedAgentSkillBackgroundUpdatesSearchKeywords(): string[] {
  return searchKeywords([
    {
      key: 'auto.components.settings.managed.agent.skill.background.updates.search.automatic',
      fallback: 'automatic'
    },
    {
      key: 'auto.components.settings.managed.agent.skill.background.updates.search.update',
      fallback: 'update'
    },
    {
      key: 'auto.components.settings.managed.agent.skill.background.updates.search.skills',
      fallback: 'skills'
    },
    {
      key: 'auto.components.settings.managed.agent.skill.background.updates.search.manual',
      fallback: 'manual'
    }
  ])
}
