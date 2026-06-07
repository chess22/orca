import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStoreState = vi.hoisted(() => ({
  activeGroupIdByWorktree: {} as Record<string, string>,
  activeWorktreeId: 'wt-1',
  activateTab: vi.fn(),
  createEmptySplitGroup: vi.fn(),
  createUnifiedTab: vi.fn(),
  dropUnifiedTab: vi.fn(),
  focusGroup: vi.fn(),
  groupsByWorktree: {} as Record<string, { id: string }[]>,
  settings: { mobileEmulatorEnabled: true },
  setActiveTab: vi.fn(),
  setActiveTabType: vi.fn(),
  unifiedTabsByWorktree: {} as Record<
    string,
    { id: string; groupId: string; contentType: string; label?: string }[]
  >
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mockStoreState
  }
}))

describe('ensureSimulatorTab', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'Macintosh' }
    })
    mockStoreState.activeGroupIdByWorktree = { 'wt-1': 'group-1' }
    mockStoreState.activeWorktreeId = 'wt-1'
    mockStoreState.groupsByWorktree = { 'wt-1': [{ id: 'group-1' }] }
    mockStoreState.settings = { mobileEmulatorEnabled: true }
    mockStoreState.unifiedTabsByWorktree = {
      'wt-1': [{ id: 'sim-1', groupId: 'group-1', contentType: 'simulator' }]
    }
    mockStoreState.activateTab.mockReset()
    mockStoreState.createEmptySplitGroup.mockReset()
    mockStoreState.createUnifiedTab.mockReset()
    mockStoreState.dropUnifiedTab.mockReset()
    mockStoreState.focusGroup.mockReset()
    mockStoreState.setActiveTab.mockReset()
    mockStoreState.setActiveTabType.mockReset()
    vi.resetModules()
  })

  it('activates an existing simulator tab through unified tab state', async () => {
    const { ensureSimulatorTab } = await import('./ensure-simulator-tab')

    expect(ensureSimulatorTab('wt-1')).toBe('sim-1')

    expect(mockStoreState.activateTab).toHaveBeenCalledWith('sim-1')
    expect(mockStoreState.setActiveTab).not.toHaveBeenCalled()
    expect(mockStoreState.focusGroup).toHaveBeenCalledWith('wt-1', 'group-1')
    expect(mockStoreState.setActiveTabType).toHaveBeenCalledWith('simulator')
  })

  it('creates a simulator tab in a new right split when requested', async () => {
    mockStoreState.unifiedTabsByWorktree = { 'wt-1': [] }
    mockStoreState.createUnifiedTab.mockReturnValue({
      id: 'sim-2',
      groupId: 'group-1',
      contentType: 'simulator'
    })
    mockStoreState.dropUnifiedTab.mockImplementation(() => {
      mockStoreState.unifiedTabsByWorktree = {
        'wt-1': [{ id: 'sim-2', groupId: 'group-2', contentType: 'simulator' }]
      }
      return true
    })
    const { ensureSimulatorTab } = await import('./ensure-simulator-tab')

    expect(ensureSimulatorTab('wt-1', { placement: 'rightSplit' })).toBe('sim-2')

    expect(mockStoreState.createEmptySplitGroup).not.toHaveBeenCalled()
    expect(mockStoreState.createUnifiedTab).toHaveBeenCalledWith('wt-1', 'simulator', {
      label: 'Mobile Emulator',
      targetGroupId: 'group-1',
      activate: true
    })
    expect(mockStoreState.dropUnifiedTab).toHaveBeenCalledWith('sim-2', {
      groupId: 'group-1',
      splitDirection: 'right'
    })
    expect(mockStoreState.activateTab).toHaveBeenCalledWith('sim-2')
    expect(mockStoreState.focusGroup).toHaveBeenCalledWith('wt-1', 'group-2')
    expect(mockStoreState.setActiveTabType).toHaveBeenCalledWith('simulator')
  })

  it('falls back to the source group when right split movement is a no-op', async () => {
    mockStoreState.unifiedTabsByWorktree = { 'wt-1': [] }
    mockStoreState.dropUnifiedTab.mockReturnValue(false)
    mockStoreState.createUnifiedTab.mockReturnValue({
      id: 'sim-3',
      groupId: 'group-1',
      contentType: 'simulator'
    })
    const { ensureSimulatorTab } = await import('./ensure-simulator-tab')

    expect(ensureSimulatorTab('wt-1', { placement: 'rightSplit' })).toBe('sim-3')

    expect(mockStoreState.createUnifiedTab).toHaveBeenCalledWith('wt-1', 'simulator', {
      label: 'Mobile Emulator',
      targetGroupId: 'group-1',
      activate: true
    })
    expect(mockStoreState.dropUnifiedTab).toHaveBeenCalledWith('sim-3', {
      groupId: 'group-1',
      splitDirection: 'right'
    })
    expect(mockStoreState.focusGroup).toHaveBeenCalledWith('wt-1', 'group-1')
  })

  it('does not create a split for background auto-attach', async () => {
    mockStoreState.unifiedTabsByWorktree = { 'wt-1': [] }
    mockStoreState.createUnifiedTab.mockReturnValue({
      id: 'sim-4',
      groupId: 'group-1',
      contentType: 'simulator'
    })
    const { ensureSimulatorTab } = await import('./ensure-simulator-tab')

    expect(ensureSimulatorTab('wt-1', { placement: 'rightSplit', surfacePane: false })).toBe(
      'sim-4'
    )

    expect(mockStoreState.dropUnifiedTab).not.toHaveBeenCalled()
    expect(mockStoreState.createUnifiedTab).toHaveBeenCalledWith('wt-1', 'simulator', {
      label: 'Mobile Emulator',
      targetGroupId: 'group-1',
      activate: false
    })
    expect(mockStoreState.activateTab).not.toHaveBeenCalled()
    expect(mockStoreState.focusGroup).not.toHaveBeenCalled()
    expect(mockStoreState.setActiveTabType).not.toHaveBeenCalled()
  })

  it('does not create or focus a simulator tab when disabled in settings', async () => {
    mockStoreState.settings = { mobileEmulatorEnabled: false }
    const { ensureSimulatorTab } = await import('./ensure-simulator-tab')

    expect(ensureSimulatorTab('wt-1')).toBeNull()

    expect(mockStoreState.activateTab).not.toHaveBeenCalled()
    expect(mockStoreState.createUnifiedTab).not.toHaveBeenCalled()
  })
})
