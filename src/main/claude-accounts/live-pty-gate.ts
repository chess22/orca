const liveClaudePtyIds = new Set<string>()
const claudePtyExitListeners = new Set<() => void>()
let switchInProgress = false

export function markClaudePtySpawned(ptyId: string): void {
  liveClaudePtyIds.add(ptyId)
}

export function markClaudePtyExited(ptyId: string): void {
  if (!liveClaudePtyIds.delete(ptyId)) {
    return
  }
  for (const listener of claudePtyExitListeners) {
    listener()
  }
}

export function onClaudePtyExited(listener: () => void): () => void {
  claudePtyExitListeners.add(listener)
  return () => {
    claudePtyExitListeners.delete(listener)
  }
}

export function hasLiveClaudePtys(): boolean {
  return liveClaudePtyIds.size > 0
}

export function beginClaudeAuthSwitch(): void {
  if (switchInProgress) {
    throw new Error('A Claude account switch is already in progress.')
  }
  switchInProgress = true
}

export function endClaudeAuthSwitch(): void {
  switchInProgress = false
}

export function isClaudeAuthSwitchInProgress(): boolean {
  return switchInProgress
}
