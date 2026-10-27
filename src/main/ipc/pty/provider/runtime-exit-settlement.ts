const pendingLocalRuntimeExits = new Map<string, Promise<boolean>>()

function settlementKey(ptyId: string, incarnationId?: string): string {
  return `${ptyId}\0${incarnationId ?? ''}`
}

export function settleRuntimePtyExit(
  ptyId: string,
  retire: () => void | Promise<void>
): Promise<boolean> {
  let retirement: void | Promise<void>
  try {
    retirement = retire()
  } catch (error) {
    console.error(`[pty] Failed to retire PTY ${ptyId} after provider exit:`, error)
    return Promise.resolve(false)
  }
  if (!retirement) {
    return Promise.resolve(true)
  }
  return retirement.then(
    () => true,
    (error: unknown) => {
      console.error(`[pty] Failed to retire PTY ${ptyId} after provider exit:`, error)
      return false
    }
  )
}

export function registerLocalRuntimePtyExit(
  ptyId: string,
  incarnationId: string | undefined,
  retire: () => void | Promise<void>
): void {
  const key = settlementKey(ptyId, incarnationId)
  const settlement = settleRuntimePtyExit(ptyId, retire)
  pendingLocalRuntimeExits.set(key, settlement)
  queueMicrotask(() => {
    if (pendingLocalRuntimeExits.get(key) === settlement) {
      pendingLocalRuntimeExits.delete(key)
    }
  })
}

export function consumeLocalRuntimePtyExit(
  ptyId: string,
  incarnationId?: string
): Promise<boolean> | undefined {
  const key = settlementKey(ptyId, incarnationId)
  const settlement = pendingLocalRuntimeExits.get(key)
  pendingLocalRuntimeExits.delete(key)
  return settlement
}
