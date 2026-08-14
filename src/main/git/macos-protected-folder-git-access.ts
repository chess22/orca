import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'

let startupDiscoveryActive = true

function protectedRootForPath(targetPath: string): string | null {
  if (process.platform !== 'darwin' || !isAbsolute(targetPath)) {
    return null
  }
  const accountHome = homedir()
  for (const folder of ['Documents', 'Desktop', 'Downloads']) {
    const root = join(accountHome, folder)
    const relativePath = relative(root, targetPath)
    if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
      return root
    }
  }
  return null
}

export function shouldDeferMacosProtectedFolderGitDiscovery(targetPath: string): boolean {
  return protectedRootForPath(targetPath) !== null
}

export function shouldDeferMacosProtectedFolderGitStartup(
  targetPath: string,
  wslDistro?: string
): boolean {
  return (
    startupDiscoveryActive && !wslDistro && shouldDeferMacosProtectedFolderGitDiscovery(targetPath)
  )
}

export function completeMacosProtectedFolderGitStartup(): void {
  startupDiscoveryActive = false
}

export function resetMacosProtectedFolderGitStartupForTests(): void {
  startupDiscoveryActive = true
}
