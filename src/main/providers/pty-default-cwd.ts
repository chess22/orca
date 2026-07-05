import { homedir } from 'node:os'
import { posix } from 'node:path'

function isRootLikePath(path: string | null | undefined): boolean {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) {
    return true
  }
  if (posix.normalize(trimmed.replace(/\\/g, '/')) === '/') {
    return true
  }
  const windowsPath = trimmed.replace(/\//g, '\\')
  return /^[A-Za-z]:\\?$/.test(windowsPath) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(windowsPath)
}

function homeDrivePath(env: NodeJS.ProcessEnv): string | null {
  if (!env.HOMEDRIVE || !env.HOMEPATH) {
    return null
  }
  return `${env.HOMEDRIVE}${env.HOMEPATH}`
}

export function isSafeImplicitPtyCwd(path: string | null | undefined): path is string {
  return !isRootLikePath(path)
}

export function resolveSafePtyDefaultCwd(env: NodeJS.ProcessEnv = process.env): string {
  const candidates =
    process.platform === 'win32'
      ? [env.USERPROFILE, homeDrivePath(env), homedir()]
      : [env.HOME, homedir()]
  const selected = candidates.find(isSafeImplicitPtyCwd)
  if (!selected) {
    throw new Error('No safe default working directory is available for terminal launch.')
  }
  return selected
}

export function assertSafeAgentStartupCwd(cwd: string | undefined, command: string): void {
  if (isSafeImplicitPtyCwd(cwd)) {
    return
  }
  throw new Error(
    `Automatic agent startup command "${command}" requires a non-root workspace working directory.`
  )
}
