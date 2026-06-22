import type { ProjectExecutionRuntimeResolution } from './project-execution-runtime'
import type {
  COMPUTER_USE_SKILL_NAME,
  LINEAR_TICKETS_SKILL_NAME,
  ORCA_CLI_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME
} from './agent-feature-install-commands'

export type SkillProvider = 'codex' | 'claude' | 'agent-skills'

export type SkillSourceKind = 'home' | 'repo' | 'bundled' | 'plugin'

export type DiscoveredSkill = {
  id: string
  name: string
  description: string | null
  providers: SkillProvider[]
  sourceKind: SkillSourceKind
  sourceLabel: string
  rootPath: string
  directoryPath: string
  realDirectoryPath?: string | null
  directoryIsSymlink?: boolean
  skillFilePath: string
  realSkillFilePath?: string | null
  skillFileIsSymlink?: boolean
  installed: boolean
  fileCount: number
  updatedAt: number | null
}

export type SkillDiscoverySource = {
  id: string
  label: string
  path: string
  sourceKind: SkillSourceKind
  providers: SkillProvider[]
  exists: boolean
  skippedReason?: 'missing' | 'remote-repo'
}

export type SkillDiscoveryResult = {
  skills: DiscoveredSkill[]
  sources: SkillDiscoverySource[]
  scannedAt: number
}

export type SkillDiscoveryTarget = {
  runtime?: 'host' | 'wsl'
  wslDistro?: string | null
  projectRuntime?: ProjectExecutionRuntimeResolution
  projectRootPath?: string | null
}

export type SkillFrontmatterSummary = {
  name: string | null
  description: string | null
}

export type ManagedAgentSkillName =
  | typeof COMPUTER_USE_SKILL_NAME
  | typeof LINEAR_TICKETS_SKILL_NAME
  | typeof ORCA_CLI_SKILL_NAME
  | typeof ORCHESTRATION_SKILL_NAME

export type ManagedAgentSkillContext =
  | 'linear-worktree'
  | 'agent-orchestration'
  | 'agent-computer-use'
  | 'agent-orca-cli'

export type ManagedAgentSkillRuntime = 'host' | 'wsl' | 'remote' | 'unknown'

export type ManagedAgentSkillScope = 'global' | 'project' | 'bundled' | 'plugin' | 'missing'

export type ManagedAgentSkillFallbackReason =
  | 'target-required'
  | 'unsupported-skill'
  | 'repair-required-runtime'
  | 'remote-runtime'
  | 'wsl-runtime'
  | 'missing-install'
  | 'project-install'
  | 'ambiguous-install'
  | 'bundled-or-plugin-install'
  | 'symlinked-global-install'
  | 'unsupported-cli-contract'
  | 'expected-hash-missing'
  | 'lockfile-missing'
  | 'lockfile-malformed'
  | 'lockfile-unsupported-schema'
  | 'lock-entry-missing'
  | 'lock-entry-unmanaged-source'
  | 'background-update-disabled'
  | 'cooldown'
  | 'update-failed'
  | 'update-timeout'

export type ManagedAgentSkillManualCommand = {
  kind: 'install' | 'update'
  command: string
  runtime: ManagedAgentSkillRuntime
  scope: Extract<ManagedAgentSkillScope, 'global' | 'project'>
}

export type ManagedAgentSkillEnsureRequest = {
  skillName: ManagedAgentSkillName
  context: ManagedAgentSkillContext
  discoveryTarget?: SkillDiscoveryTarget
  remoteRuntime?: boolean
  force?: boolean
}

export type ManagedAgentSkillFallback = {
  status: 'fallback'
  skillName: ManagedAgentSkillName
  context: ManagedAgentSkillContext
  runtime: ManagedAgentSkillRuntime
  distro?: string | null
  scope: ManagedAgentSkillScope
  reason: ManagedAgentSkillFallbackReason
  uiKey: string
  message: string
  manualCommand?: ManagedAgentSkillManualCommand
  request: ManagedAgentSkillEnsureRequest
}

export type ManagedAgentSkillReady = {
  status: 'ready'
  skillName: ManagedAgentSkillName
  context: ManagedAgentSkillContext
  runtime: ManagedAgentSkillRuntime
  distro?: string | null
  scope: Extract<ManagedAgentSkillScope, 'global'>
}

export type ManagedAgentSkillUpdated = {
  status: 'updated'
  skillName: ManagedAgentSkillName
  context: ManagedAgentSkillContext
  runtime: ManagedAgentSkillRuntime
  distro?: string | null
  scope: Extract<ManagedAgentSkillScope, 'global'>
}

export type ManagedAgentSkillEnsureResult =
  | ManagedAgentSkillFallback
  | ManagedAgentSkillReady
  | ManagedAgentSkillUpdated

export function shouldEmitManagedAgentSkillFallback(
  result: ManagedAgentSkillEnsureResult
): result is ManagedAgentSkillFallback {
  return (
    result.status === 'fallback' &&
    result.reason !== 'cooldown' &&
    // Why: the modal is an install/update surface; fallbacks without a command
    // only create a dead-end Re-check loop.
    Boolean(result.manualCommand)
  )
}
