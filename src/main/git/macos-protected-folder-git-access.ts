import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'

const protectedFolderAccess = new Map<string, Promise<boolean>>()

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

export async function mayScanGitInProtectedFolder(targetPath: string): Promise<boolean> {
  const root = protectedRootForPath(targetPath)
  if (!root) {
    return true
  }
  let check = protectedFolderAccess.get(root)
  if (!check) {
    // Why: one root-level probe lets macOS settle TCC once before concurrent repo scans multiply prompts.
    check = access(root, constants.R_OK).then(
      () => true,
      () => false
    )
    protectedFolderAccess.set(root, check)
  }
  return check
}

export function resetMacosProtectedFolderGitAccessForTests(): void {
  protectedFolderAccess.clear()
}
