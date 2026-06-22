import { describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  LINEAR_TICKETS_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME
} from '../../shared/agent-feature-install-commands'
import type { DiscoveredSkill, SkillDiscoveryResult } from '../../shared/skills'
import { ManagedSkillUpdateCoordinator } from './managed-skill-updates'

const TEST_MANAGED_HOME_ROOT = join(homedir(), '.agents', 'skills')

function discoveredSkill(
  patch: Partial<DiscoveredSkill> & Pick<DiscoveredSkill, 'name' | 'sourceKind'>
): DiscoveredSkill {
  const rootPath = patch.rootPath ?? TEST_MANAGED_HOME_ROOT
  const directoryPath = patch.directoryPath ?? join(rootPath, patch.name)
  return {
    id: patch.id ?? `${patch.sourceKind}-${patch.name}`,
    name: patch.name,
    description: patch.description ?? null,
    providers: patch.providers ?? ['agent-skills'],
    sourceKind: patch.sourceKind,
    sourceLabel: patch.sourceLabel ?? patch.sourceKind,
    rootPath,
    directoryPath,
    realDirectoryPath: patch.realDirectoryPath ?? directoryPath,
    directoryIsSymlink: patch.directoryIsSymlink ?? false,
    skillFilePath: patch.skillFilePath ?? join(directoryPath, 'SKILL.md'),
    realSkillFilePath: patch.realSkillFilePath ?? join(directoryPath, 'SKILL.md'),
    skillFileIsSymlink: patch.skillFileIsSymlink ?? false,
    installed: patch.installed ?? true,
    fileCount: patch.fileCount ?? 1,
    updatedAt: patch.updatedAt ?? 1
  }
}

function discovery(skills: DiscoveredSkill[]): SkillDiscoveryResult {
  return { skills, sources: [], scannedAt: 1 }
}

function lockfile(skillFolderHash: string): string {
  return JSON.stringify({
    version: 3,
    skills: {
      [ORCHESTRATION_SKILL_NAME]: {
        source: 'stablyai/orca',
        sourceType: 'github',
        sourceUrl: 'https://github.com/stablyai/orca.git',
        skillPath: `skills/${ORCHESTRATION_SKILL_NAME}/SKILL.md`,
        skillFolderHash
      }
    }
  })
}

describe('ManagedSkillUpdateCoordinator', () => {
  it('dedupes concurrent missing-install checks before discovery', async () => {
    const discoverHostSkills = vi.fn(async () => discovery([]))
    const coordinator = new ManagedSkillUpdateCoordinator({ discoverHostSkills })

    const [first, second] = await Promise.all([
      coordinator.ensureManagedReady({
        skillName: LINEAR_TICKETS_SKILL_NAME,
        context: 'linear-worktree',
        discoveryTarget: { runtime: 'host' }
      }),
      coordinator.ensureManagedReady({
        skillName: LINEAR_TICKETS_SKILL_NAME,
        context: 'linear-worktree',
        discoveryTarget: { runtime: 'host' }
      })
    ])

    expect(discoverHostSkills).toHaveBeenCalledTimes(1)
    expect(first.status).toBe('fallback')
    expect(second.status).toBe('fallback')
    expect(first.status === 'fallback' ? first.reason : null).toBe('missing-install')
    expect(first.status === 'fallback' ? first.manualCommand?.kind : null).toBe('install')
  })

  it('cooldowns repeated missing-install checks after the first fallback', async () => {
    let now = 100
    const discoverHostSkills = vi.fn(async () => discovery([]))
    const coordinator = new ManagedSkillUpdateCoordinator({
      cooldownMs: 1_000,
      now: () => now,
      discoverHostSkills
    })

    const first = await coordinator.ensureManagedReady({
      skillName: LINEAR_TICKETS_SKILL_NAME,
      context: 'linear-worktree',
      discoveryTarget: { runtime: 'host' }
    })
    now = 200
    const second = await coordinator.ensureManagedReady({
      skillName: LINEAR_TICKETS_SKILL_NAME,
      context: 'linear-worktree',
      discoveryTarget: { runtime: 'host' }
    })

    expect(first.status === 'fallback' ? first.reason : null).toBe('missing-install')
    expect(second.status === 'fallback' ? second.reason : null).toBe('cooldown')
    expect(discoverHostSkills).toHaveBeenCalledTimes(1)
  })

  it('lets explicit re-checks bypass fallback cooldown', async () => {
    let now = 100
    const discoverHostSkills = vi.fn(async () => discovery([]))
    const coordinator = new ManagedSkillUpdateCoordinator({
      cooldownMs: 1_000,
      now: () => now,
      discoverHostSkills
    })

    await coordinator.ensureManagedReady({
      skillName: LINEAR_TICKETS_SKILL_NAME,
      context: 'linear-worktree',
      discoveryTarget: { runtime: 'host' }
    })
    now = 200
    const forced = await coordinator.ensureManagedReady({
      skillName: LINEAR_TICKETS_SKILL_NAME,
      context: 'linear-worktree',
      discoveryTarget: { runtime: 'host' },
      force: true
    })

    expect(forced.status === 'fallback' ? forced.reason : null).toBe('missing-install')
    expect(discoverHostSkills).toHaveBeenCalledTimes(2)
  })

  it('cooldowns repeated remote-runtime target fallbacks', async () => {
    let now = 100
    const coordinator = new ManagedSkillUpdateCoordinator({
      cooldownMs: 1_000,
      now: () => now
    })
    const request = {
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration' as const,
      remoteRuntime: true
    } as const

    const first = await coordinator.ensureManagedReady(request)
    now = 200
    const second = await coordinator.ensureManagedReady(request)

    expect(first.status === 'fallback' ? first.reason : null).toBe('remote-runtime')
    expect(second.status === 'fallback' ? second.reason : null).toBe('cooldown')
  })

  it('cooldowns repeated target-required fallbacks', async () => {
    let now = 100
    const coordinator = new ManagedSkillUpdateCoordinator({
      cooldownMs: 1_000,
      now: () => now
    })
    const request = {
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration' as const
    } as const

    const first = await coordinator.ensureManagedReady(request)
    now = 200
    const second = await coordinator.ensureManagedReady(request)

    expect(first.status === 'fallback' ? first.reason : null).toBe('target-required')
    expect(second.status === 'fallback' ? second.reason : null).toBe('cooldown')
  })

  it('falls back for project and symlinked global installs', async () => {
    const projectCoordinator = new ManagedSkillUpdateCoordinator({
      discoverHostSkills: async () =>
        discovery([
          discoveredSkill({
            name: ORCHESTRATION_SKILL_NAME,
            sourceKind: 'repo',
            rootPath: '/workspace/current/.agents/skills',
            directoryPath: '/workspace/current/.agents/skills/orchestration'
          })
        ])
    })
    const symlinkCoordinator = new ManagedSkillUpdateCoordinator({
      discoverHostSkills: async () =>
        discovery([
          discoveredSkill({
            name: ORCHESTRATION_SKILL_NAME,
            sourceKind: 'home',
            directoryIsSymlink: true
          })
        ])
    })

    const project = await projectCoordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host', projectRootPath: '/workspace/current' }
    })
    const symlink = await symlinkCoordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    })

    expect(project.status === 'fallback' ? project.reason : null).toBe('project-install')
    expect(symlink.status === 'fallback' ? symlink.reason : null).toBe('symlinked-global-install')
  })

  it('ignores project installs from unrelated repo roots', async () => {
    const coordinator = new ManagedSkillUpdateCoordinator({
      discoverHostSkills: async () =>
        discovery([
          discoveredSkill({
            name: ORCHESTRATION_SKILL_NAME,
            sourceKind: 'home',
            rootPath: TEST_MANAGED_HOME_ROOT
          }),
          discoveredSkill({
            name: ORCHESTRATION_SKILL_NAME,
            sourceKind: 'repo',
            rootPath: '/workspace/unrelated/.agents/skills',
            directoryPath: '/workspace/unrelated/.agents/skills/orchestration'
          })
        ])
    })

    const result = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host', projectRootPath: '/workspace/current' }
    })

    expect(result.status).toBe('ready')
  })

  it('falls back when the current project root has a project-scoped install', async () => {
    const coordinator = new ManagedSkillUpdateCoordinator({
      discoverHostSkills: async () =>
        discovery([
          discoveredSkill({
            name: ORCHESTRATION_SKILL_NAME,
            sourceKind: 'home',
            rootPath: TEST_MANAGED_HOME_ROOT
          }),
          discoveredSkill({
            name: ORCHESTRATION_SKILL_NAME,
            sourceKind: 'repo',
            rootPath: '/workspace/current/.agents/skills',
            directoryPath: '/workspace/current/.agents/skills/orchestration'
          })
        ])
    })

    const result = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host', projectRootPath: '/workspace/current' }
    })

    expect(result.status === 'fallback' ? result.reason : null).toBe('ambiguous-install')
  })

  it('does not emit a global install command when project scope exists but target is unknown', async () => {
    const coordinator = new ManagedSkillUpdateCoordinator({
      discoverHostSkills: async () =>
        discovery([
          discoveredSkill({
            name: ORCHESTRATION_SKILL_NAME,
            sourceKind: 'repo',
            rootPath: '/workspace/current/.agents/skills',
            directoryPath: '/workspace/current/.agents/skills/orchestration'
          })
        ])
    })

    const result = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    })

    expect(result.status === 'fallback' ? result.reason : null).toBe('project-install')
    expect(result.status === 'fallback' ? result.manualCommand : undefined).toBeUndefined()
  })

  it('passes the project root into host discovery', async () => {
    const discoverHostSkills = vi.fn(async () => discovery([]))
    const coordinator = new ManagedSkillUpdateCoordinator({ discoverHostSkills })

    await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host', projectRootPath: '/workspace/current' }
    })

    expect(discoverHostSkills).toHaveBeenCalledWith('/workspace/current')
  })

  it('treats installed global skills as ready when the expected hash manifest is missing', async () => {
    const coordinator = new ManagedSkillUpdateCoordinator({
      discoverHostSkills: async () =>
        discovery([discoveredSkill({ name: ORCHESTRATION_SKILL_NAME, sourceKind: 'home' })])
    })

    const result = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    })

    expect(result.status).toBe('ready')
  })

  it('does not treat Codex or Claude home skills as managed global installs', async () => {
    const readTextFile = vi.fn(async () => lockfile('hash-1'))
    const coordinator = new ManagedSkillUpdateCoordinator({
      homeDir: () => '/home/alice',
      discoverHostSkills: async () =>
        discovery([
          discoveredSkill({
            name: ORCHESTRATION_SKILL_NAME,
            sourceKind: 'home',
            providers: ['codex'],
            rootPath: '/home/alice/.codex/skills',
            directoryPath: '/home/alice/.codex/skills/orchestration'
          })
        ]),
      expectedRevisions: {
        [ORCHESTRATION_SKILL_NAME]: {
          expectedHash: 'hash-1',
          expectedSourceRef: '0123456789abcdef0123456789abcdef01234567',
          skillsPackageVersion: '1.2.3'
        }
      },
      readTextFile
    })

    const result = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    })

    expect(result.status === 'fallback' ? result.reason : null).toBe('missing-install')
    expect(result.status === 'fallback' ? result.manualCommand?.kind : null).toBe('install')
    expect(readTextFile).not.toHaveBeenCalled()
  })

  it('returns ready when a verified manifest and lock hash already match', async () => {
    const coordinator = new ManagedSkillUpdateCoordinator({
      discoverHostSkills: async () =>
        discovery([discoveredSkill({ name: ORCHESTRATION_SKILL_NAME, sourceKind: 'home' })]),
      expectedRevisions: {
        [ORCHESTRATION_SKILL_NAME]: {
          expectedHash: 'hash-1',
          expectedSourceRef: '0123456789abcdef0123456789abcdef01234567',
          skillsPackageVersion: '1.2.3'
        }
      },
      readTextFile: async () => lockfile('hash-1')
    })

    const result = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    })

    expect(result.status).toBe('ready')
  })

  it('serves verified ready checks from the success cache without rediscovery', async () => {
    const discoverHostSkills = vi.fn(async () =>
      discovery([discoveredSkill({ name: ORCHESTRATION_SKILL_NAME, sourceKind: 'home' })])
    )
    const readTextFile = vi.fn(async () => lockfile('hash-1'))
    const coordinator = new ManagedSkillUpdateCoordinator({
      discoverHostSkills,
      expectedRevisions: {
        [ORCHESTRATION_SKILL_NAME]: {
          expectedHash: 'hash-1',
          expectedSourceRef: '0123456789abcdef0123456789abcdef01234567',
          skillsPackageVersion: '1.2.3'
        }
      },
      readTextFile
    })
    const request = {
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration' as const,
      discoveryTarget: { runtime: 'host' as const, projectRootPath: '/workspace/current' }
    } as const

    const first = await coordinator.ensureManagedReady(request)
    const second = await coordinator.ensureManagedReady(request)

    expect(first.status).toBe('ready')
    expect(second.status).toBe('ready')
    expect(discoverHostSkills).toHaveBeenCalledTimes(1)
    expect(readTextFile).toHaveBeenCalledTimes(1)
  })

  it('keeps concurrent checks for different project roots independent', async () => {
    const discoverHostSkills = vi.fn(async () =>
      discovery([
        discoveredSkill({
          name: ORCHESTRATION_SKILL_NAME,
          sourceKind: 'home',
          rootPath: TEST_MANAGED_HOME_ROOT
        }),
        discoveredSkill({
          name: ORCHESTRATION_SKILL_NAME,
          sourceKind: 'repo',
          rootPath: '/workspace/current/.agents/skills',
          directoryPath: '/workspace/current/.agents/skills/orchestration'
        })
      ])
    )
    const coordinator = new ManagedSkillUpdateCoordinator({ discoverHostSkills })

    const [currentProject, otherProject] = await Promise.all([
      coordinator.ensureManagedReady({
        skillName: ORCHESTRATION_SKILL_NAME,
        context: 'agent-orchestration',
        discoveryTarget: { runtime: 'host', projectRootPath: '/workspace/current' }
      }),
      coordinator.ensureManagedReady({
        skillName: ORCHESTRATION_SKILL_NAME,
        context: 'agent-orchestration',
        discoveryTarget: { runtime: 'host', projectRootPath: '/workspace/other' }
      })
    ])

    expect(currentProject.status === 'fallback' ? currentProject.reason : null).toBe(
      'ambiguous-install'
    )
    expect(otherProject.status).toBe('ready')
    expect(discoverHostSkills).toHaveBeenCalledTimes(2)
  })

  it('keys project fallback UI identity by project root', async () => {
    const coordinator = new ManagedSkillUpdateCoordinator({
      discoverHostSkills: async () =>
        discovery([
          discoveredSkill({
            name: ORCHESTRATION_SKILL_NAME,
            sourceKind: 'repo',
            rootPath: '/workspace/current/.agents/skills',
            directoryPath: '/workspace/current/.agents/skills/orchestration'
          })
        ])
    })

    const first = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host', projectRootPath: '/workspace/current' }
    })
    const second = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host', projectRootPath: '/workspace/other' }
    })

    expect(first.status === 'fallback' ? first.uiKey : null).toContain('/workspace/current')
    expect(second.status === 'fallback' ? second.uiKey : null).toContain('/workspace/other')
    expect(
      first.status === 'fallback' && second.status === 'fallback' ? first.uiKey : null
    ).not.toBe(second.status === 'fallback' ? second.uiKey : null)
  })

  it('reads the current global lockfile version field', async () => {
    const coordinator = new ManagedSkillUpdateCoordinator({
      discoverHostSkills: async () =>
        discovery([discoveredSkill({ name: ORCHESTRATION_SKILL_NAME, sourceKind: 'home' })]),
      expectedRevisions: {
        [ORCHESTRATION_SKILL_NAME]: {
          expectedHash: 'hash-1',
          expectedSourceRef: '0123456789abcdef0123456789abcdef01234567',
          skillsPackageVersion: '1.2.3'
        }
      },
      readTextFile: async () =>
        JSON.stringify({
          version: 3,
          skills: {
            [ORCHESTRATION_SKILL_NAME]: {
              source: 'stablyai/orca',
              sourceType: 'github',
              sourceUrl: 'https://github.com/stablyai/orca.git',
              skillPath: `skills/${ORCHESTRATION_SKILL_NAME}/SKILL.md`,
              skillFolderHash: 'hash-1'
            }
          }
        })
    })

    const result = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    })

    expect(result.status).toBe('ready')
  })

  it('returns a malformed fallback for non-object lockfile JSON', async () => {
    const coordinator = new ManagedSkillUpdateCoordinator({
      discoverHostSkills: async () =>
        discovery([discoveredSkill({ name: ORCHESTRATION_SKILL_NAME, sourceKind: 'home' })]),
      expectedRevisions: {
        [ORCHESTRATION_SKILL_NAME]: {
          expectedHash: 'hash-1',
          expectedSourceRef: '0123456789abcdef0123456789abcdef01234567',
          skillsPackageVersion: '1.2.3'
        }
      },
      readTextFile: async () => 'null'
    })

    const result = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    })

    expect(result.status === 'fallback' ? result.reason : null).toBe('lockfile-malformed')
  })

  it('falls back without cooldown when automatic updates are off', async () => {
    let now = 100
    const readTextFile = vi.fn(async () => lockfile('old-hash'))
    const coordinator = new ManagedSkillUpdateCoordinator({
      backgroundUpdatesEnabled: () => false,
      cooldownMs: 1_000,
      now: () => now,
      discoverHostSkills: async () =>
        discovery([discoveredSkill({ name: ORCHESTRATION_SKILL_NAME, sourceKind: 'home' })]),
      expectedRevisions: {
        [ORCHESTRATION_SKILL_NAME]: {
          expectedHash: 'hash-2',
          expectedSourceRef: '0123456789abcdef0123456789abcdef01234567',
          skillsPackageVersion: '1.2.3'
        }
      },
      readTextFile
    })

    const first = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    })
    now = 200
    const second = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    })

    expect(first.status === 'fallback' ? first.reason : null).toBe('background-update-disabled')
    expect(first.status === 'fallback' ? first.manualCommand?.kind : null).toBe('update')
    expect(second.status === 'fallback' ? second.reason : null).toBe('background-update-disabled')
    expect(second.status === 'fallback' ? second.manualCommand?.kind : null).toBe('update')
    expect(readTextFile).toHaveBeenCalledTimes(2)
  })

  it('shows manual update after automatic update cooldown when the setting is turned off', async () => {
    let now = 100
    let backgroundUpdatesEnabled = true
    const readTextFile = vi.fn(async () => lockfile('old-hash'))
    const coordinator = new ManagedSkillUpdateCoordinator({
      backgroundUpdatesEnabled: () => backgroundUpdatesEnabled,
      cooldownMs: 1_000,
      now: () => now,
      discoverHostSkills: async () =>
        discovery([discoveredSkill({ name: ORCHESTRATION_SKILL_NAME, sourceKind: 'home' })]),
      expectedRevisions: {
        [ORCHESTRATION_SKILL_NAME]: {
          expectedHash: 'hash-2',
          expectedSourceRef: '0123456789abcdef0123456789abcdef01234567',
          skillsPackageVersion: '1.2.3'
        }
      },
      readTextFile
    })

    const automaticAttempt = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    })
    backgroundUpdatesEnabled = false
    now = 200
    const manualAttempt = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    })

    expect(automaticAttempt.status === 'fallback' ? automaticAttempt.reason : null).toBe(
      'unsupported-cli-contract'
    )
    expect(manualAttempt.status === 'fallback' ? manualAttempt.reason : null).toBe(
      'background-update-disabled'
    )
    expect(manualAttempt.status === 'fallback' ? manualAttempt.manualCommand?.kind : null).toBe(
      'update'
    )
    expect(readTextFile).toHaveBeenCalledTimes(2)
  })

  it('does not show the manual-update modal while automatic updates are enabled', async () => {
    const coordinator = new ManagedSkillUpdateCoordinator({
      discoverHostSkills: async () =>
        discovery([discoveredSkill({ name: ORCHESTRATION_SKILL_NAME, sourceKind: 'home' })]),
      expectedRevisions: {
        [ORCHESTRATION_SKILL_NAME]: {
          expectedHash: 'hash-2',
          expectedSourceRef: '0123456789abcdef0123456789abcdef01234567',
          skillsPackageVersion: '1.2.3'
        }
      },
      readTextFile: async () => lockfile('old-hash')
    })

    const result = await coordinator.ensureManagedReady({
      skillName: ORCHESTRATION_SKILL_NAME,
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    })

    expect(result.status === 'fallback' ? result.reason : null).toBe('unsupported-cli-contract')
    expect(result.status === 'fallback' ? result.manualCommand : undefined).toBeUndefined()
  })
})
