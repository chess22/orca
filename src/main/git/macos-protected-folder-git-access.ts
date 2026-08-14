import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'

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
