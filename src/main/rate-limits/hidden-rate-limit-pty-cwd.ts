import { mkdirSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'

const HIDDEN_RATE_LIMIT_PTY_CWD_DIR = 'rate-limit-pty-cwd'
const WSL_RATE_LIMIT_PTY_CWD_DIR = 'orca-rate-limit-pty-cwd'

function isRootLikePath(path: string): boolean {
  const trimmed = path.trim()
  if (!trimmed) {
    return true
  }
  if (posix.normalize(trimmed.replace(/\\/g, '/')) === '/') {
    return true
  }
  const windowsPath = trimmed.replace(/\//g, '\\')
  return /^[A-Za-z]:\\?$/.test(windowsPath) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(windowsPath)
}

function resolveUserDataRoot(userDataPath?: string | null): string {
  const root = userDataPath?.trim() || process.env.ORCA_USER_DATA_PATH?.trim()
  if (root && !isRootLikePath(root)) {
    return root
  }
  return join(tmpdir(), 'orca-rate-limit-pty')
}

export function resolveHiddenRateLimitPtyCwd(options?: { userDataPath?: string | null }): string {
  const cwd = join(resolveUserDataRoot(options?.userDataPath), HIDDEN_RATE_LIMIT_PTY_CWD_DIR)
  mkdirSync(cwd, { recursive: true })
  const realCwd = realpathSync(cwd)
  if (isRootLikePath(realCwd) || !statSync(realCwd).isDirectory()) {
    throw new Error(`Hidden rate-limit PTY cwd is not a safe directory: ${realCwd}`)
  }
  return realCwd
}

export function getHiddenRateLimitWslCwdSetupCommands(): string[] {
  return [
    `orca_rate_limit_cwd="\${TMPDIR:-/tmp}/${WSL_RATE_LIMIT_PTY_CWD_DIR}"`,
    'mkdir -p "$orca_rate_limit_cwd"',
    'cd "$orca_rate_limit_cwd"'
  ]
}
