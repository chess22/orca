import type { SshGitProvider } from '../providers/ssh-git-provider'

const GIT_USERNAME_CONFIG_KEYS = [
  'github.user',
  'user.username',
  'user.email',
  'user.name'
] as const

export function normalizeGitUsername(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  const localPart = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed
  return localPart.replace(/^\d+\+/, '')
}

async function getSshGitConfigValue(
  provider: SshGitProvider,
  repoPath: string,
  key: string
): Promise<string> {
  try {
    const { stdout } = await provider.exec(['config', '--get', key], repoPath)
    return stdout.trim()
  } catch {
    // Missing config keys are expected; callers try the next candidate.
    return ''
  }
}

export async function getSshGitUsername(
  provider: SshGitProvider,
  repoPath: string
): Promise<string> {
  // Why: remote hosts cannot safely rely on the local `gh` account. Prefer
  // explicit username config, then derive from email before using display name.
  for (const key of GIT_USERNAME_CONFIG_KEYS) {
    const username = normalizeGitUsername(await getSshGitConfigValue(provider, repoPath, key))
    if (username) {
      return username
    }
  }
  return ''
}
