import type { ManagedAgentSkillFallbackReason } from '../../shared/skills'

export function getManagedSkillFallbackMessage(reason: ManagedAgentSkillFallbackReason): string {
  switch (reason) {
    case 'target-required':
      return 'Orca could not resolve the runtime that should read this skill.'
    case 'unsupported-skill':
      return 'This is not an Orca-managed agent skill.'
    case 'repair-required-runtime':
      return 'The selected runtime needs repair before Orca can inspect its skills.'
    case 'remote-runtime':
      return 'Remote runtimes are not updated in the background.'
    case 'wsl-runtime':
      return 'WSL skill updates are manual in this version.'
    case 'missing-install':
      return 'The managed skill is not installed in the selected runtime.'
    case 'project-install':
      return 'Project-scoped skills are not updated in the background.'
    case 'ambiguous-install':
      return 'Orca found both global and project-scoped copies of this skill.'
    case 'bundled-or-plugin-install':
      return 'Bundled and plugin-cache skills are not mutated by Orca.'
    case 'symlinked-global-install':
      return 'Symlinked global skills are not safe for background updates yet.'
    case 'unsupported-cli-contract':
      return 'This build does not include the verified skills CLI update contract.'
    case 'expected-hash-missing':
      return 'This build does not include an expected hash for this managed skill.'
    case 'lockfile-missing':
      return 'Orca could not find the global skills lockfile.'
    case 'lockfile-malformed':
      return 'The global skills lockfile could not be parsed.'
    case 'lockfile-unsupported-schema':
      return 'The global skills lockfile uses an unsupported schema version.'
    case 'lock-entry-missing':
      return 'The global skills lockfile does not track this skill.'
    case 'lock-entry-unmanaged-source':
      return 'The installed skill is not tracked as Orca-managed source.'
    case 'background-update-disabled':
      return 'Automatic skill updates are turned off, so this update needs manual review.'
    case 'cooldown':
      return 'Orca recently tried this managed-skill check and is cooling down.'
    case 'update-failed':
      return 'The managed-skill update command failed.'
    case 'update-timeout':
      return 'The managed-skill update command timed out.'
  }
}
