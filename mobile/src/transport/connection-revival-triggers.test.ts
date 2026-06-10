import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeConnectionRevivalTriggers } from './connection-revival-triggers'

type AppStateListener = (next: string) => void
type NetworkListener = (state: { isConnected?: boolean; type?: string }) => void

let appStateListener: AppStateListener | null = null
let networkListener: NetworkListener | null = null
const appStateRemove = vi.fn()
const networkRemove = vi.fn()

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: AppStateListener) => {
      appStateListener = listener
      return { remove: appStateRemove }
    }
  }
}))

vi.mock('expo-network', () => ({
  addNetworkStateListener: (listener: NetworkListener) => {
    networkListener = listener
    return { remove: networkRemove }
  }
}))

describe('subscribeConnectionRevivalTriggers', () => {
  let nudge: ReturnType<typeof vi.fn>
  let unsubscribe: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    appStateListener = null
    networkListener = null
    nudge = vi.fn()
    unsubscribe = subscribeConnectionRevivalTriggers(nudge)
  })

  it('nudges when the app returns to the foreground, not on background', () => {
    appStateListener?.('background')
    expect(nudge).not.toHaveBeenCalled()
    appStateListener?.('active')
    expect(nudge).toHaveBeenCalledTimes(1)
  })

  it('nudges when the network comes back online', () => {
    networkListener?.({ isConnected: false, type: 'NONE' })
    expect(nudge).not.toHaveBeenCalled()
    networkListener?.({ isConnected: true, type: 'WIFI' })
    expect(nudge).toHaveBeenCalledTimes(1)
  })

  it('nudges on a Wi-Fi to cellular handoff that never reports offline', () => {
    networkListener?.({ isConnected: true, type: 'WIFI' })
    networkListener?.({ isConnected: true, type: 'CELLULAR' })
    expect(nudge).toHaveBeenCalledTimes(1)
  })

  it('stays quiet on the initial report and on repeated identical states', () => {
    networkListener?.({ isConnected: true, type: 'WIFI' })
    networkListener?.({ isConnected: true, type: 'WIFI' })
    expect(nudge).not.toHaveBeenCalled()
  })

  it('removes both OS listeners on unsubscribe', () => {
    unsubscribe()
    expect(appStateRemove).toHaveBeenCalledTimes(1)
    expect(networkRemove).toHaveBeenCalledTimes(1)
  })
})
