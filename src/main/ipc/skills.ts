import { BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence'
import { discoverSkills } from '../skills/discovery'
import type {
  ManagedAgentSkillEnsureRequest,
  ManagedAgentSkillEnsureResult,
  SkillDiscoveryResult,
  SkillDiscoveryTarget
} from '../../shared/skills'
import { shouldEmitManagedAgentSkillFallback } from '../../shared/skills'
import { getDefaultWslDistro, getWslHome } from '../wsl'
import { getManagedSkillUpdateCoordinator } from '../skills/managed-skill-updates'

type SkillDiscoveryRuntimeTarget =
  | { runtime: 'host' }
  | { runtime: 'wsl'; wslDistro: string | null | undefined }

function getSkillDiscoveryRuntimeTarget(
  target: SkillDiscoveryTarget | undefined
): SkillDiscoveryRuntimeTarget {
  const projectRuntime = target?.projectRuntime
  if (!projectRuntime) {
    return target?.runtime === 'wsl'
      ? { runtime: 'wsl', wslDistro: target.wslDistro }
      : { runtime: 'host' }
  }

  if (projectRuntime.status === 'repair-required') {
    throw new Error(
      `Project runtime requires repair before skill discovery: ${projectRuntime.repair.reason}`
    )
  }

  if (projectRuntime.runtime.kind === 'wsl') {
    return { runtime: 'wsl', wslDistro: projectRuntime.runtime.distro }
  }

  return { runtime: 'host' }
}

export function registerSkillsHandlers(store: Store): void {
  ipcMain.handle(
    'skills:discover',
    async (_event, target?: SkillDiscoveryTarget): Promise<SkillDiscoveryResult> => {
      const runtimeTarget = getSkillDiscoveryRuntimeTarget(target)
      if (runtimeTarget.runtime === 'wsl') {
        if (process.platform !== 'win32') {
          throw new Error('WSL skill discovery is only available on Windows.')
        }
        const distro = runtimeTarget.wslDistro?.trim() || getDefaultWslDistro()
        if (!distro) {
          throw new Error('No WSL distribution is available for skill discovery.')
        }
        const homeDir = getWslHome(distro)
        if (!homeDir) {
          throw new Error(`Could not resolve the WSL home directory for ${distro}.`)
        }
        return discoverSkills({ repos: [], homeDir, cwd: homeDir })
      }

      return discoverSkills({ repos: store.getRepos() })
    }
  )

  ipcMain.handle(
    'skills:ensureManagedReady',
    async (
      event,
      request: ManagedAgentSkillEnsureRequest
    ): Promise<ManagedAgentSkillEnsureResult> => {
      const result = await getManagedSkillUpdateCoordinator(store).ensureManagedReady(request)
      if (shouldEmitManagedAgentSkillFallback(result)) {
        event.sender.send('skills:managedFallback', result)
      }
      if (result.status === 'updated') {
        sendManagedSkillUpdated(result)
      }
      return result
    }
  )
}

export function sendManagedSkillFallback(result: ManagedAgentSkillEnsureResult): void {
  if (!shouldEmitManagedAgentSkillFallback(result)) {
    return
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('skills:managedFallback', result)
  }
}

export function sendManagedSkillUpdated(result: ManagedAgentSkillEnsureResult): void {
  if (result.status !== 'updated') {
    return
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('skills:managedUpdated', result)
  }
}
