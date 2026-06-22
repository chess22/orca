import type {
  ManagedAgentSkillContext,
  ManagedAgentSkillFallbackReason
} from '../../../../shared/skills'
import { translate } from '@/i18n/i18n'

export function getManagedSkillContextCopy(context: ManagedAgentSkillContext): string {
  switch (context) {
    case 'linear-worktree':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.linearWorktreeContext',
        'This Linear task workflow needs the Linear agent skill. Orca could not update it automatically.'
      )
    case 'agent-orchestration':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.agentOrchestrationContext',
        'An agent just tried to use Orca orchestration. Orca needs the orchestration skill before agents can coordinate reliably.'
      )
    case 'agent-computer-use':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.agentComputerUseContext',
        'An agent just tried to use Computer Use. Orca needs the Computer Use skill before agents can control apps reliably.'
      )
    case 'agent-orca-cli':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.agentOrcaCliContext',
        "An agent just tried to use Orca's CLI skill for this workflow. Orca needs the CLI skill before this workflow can continue reliably."
      )
  }
}

export function getManagedSkillFallbackDisplayMessage(
  reason: ManagedAgentSkillFallbackReason
): string {
  switch (reason) {
    case 'target-required':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.targetRequired',
        'Orca could not resolve the runtime that should read this skill.'
      )
    case 'unsupported-skill':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.unsupportedSkill',
        'This is not an Orca-managed agent skill.'
      )
    case 'repair-required-runtime':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.repairRequiredRuntime',
        'The selected runtime needs repair before Orca can inspect its skills.'
      )
    case 'remote-runtime':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.remoteRuntime',
        'Remote runtimes are not updated in the background.'
      )
    case 'wsl-runtime':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.wslRuntime',
        'WSL skill updates are manual in this version.'
      )
    case 'missing-install':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.missingInstall',
        'The managed skill is not installed in the selected runtime.'
      )
    case 'project-install':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.projectInstall',
        'Project-scoped skills are not updated in the background.'
      )
    case 'ambiguous-install':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.ambiguousInstall',
        'Orca found both global and project-scoped copies of this skill.'
      )
    case 'bundled-or-plugin-install':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.bundledOrPluginInstall',
        'Bundled and plugin-cache skills are not mutated by Orca.'
      )
    case 'symlinked-global-install':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.symlinkedGlobalInstall',
        'Symlinked global skills are not safe for background updates yet.'
      )
    case 'unsupported-cli-contract':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.unsupportedCliContract',
        'This build does not include the verified skills CLI update contract.'
      )
    case 'expected-hash-missing':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.expectedHashMissing',
        'This build does not include an expected hash for this managed skill.'
      )
    case 'lockfile-missing':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.lockfileMissing',
        'Orca could not find the global skills lockfile.'
      )
    case 'lockfile-malformed':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.lockfileMalformed',
        'The global skills lockfile could not be parsed.'
      )
    case 'lockfile-unsupported-schema':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.lockfileUnsupportedSchema',
        'The global skills lockfile uses an unsupported schema version.'
      )
    case 'lock-entry-missing':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.lockEntryMissing',
        'The global skills lockfile does not track this skill.'
      )
    case 'lock-entry-unmanaged-source':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.lockEntryUnmanagedSource',
        'The installed skill is not tracked as Orca-managed source.'
      )
    case 'background-update-disabled':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.backgroundUpdateDisabled',
        'Automatic skill updates are turned off, so this update needs manual review.'
      )
    case 'cooldown':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.cooldown',
        'Orca recently tried this managed-skill check and is cooling down.'
      )
    case 'update-failed':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.updateFailed',
        'The managed-skill update command failed.'
      )
    case 'update-timeout':
      return translate(
        'auto.components.skills.ManagedAgentSkillSetupDialogHost.updateTimeout',
        'The managed-skill update command timed out.'
      )
  }
}
