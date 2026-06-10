import { describe, expect, it } from 'vitest'
import {
  formatCreateProjectParentSummary,
  getCreateProjectDefaultParentAutoFill,
  getDefaultCreateProjectParentFromWorkspaceDir,
  getDefaultCreateProjectParent,
  joinCreateProjectPath
} from './create-project-defaults'

describe('create project defaults', () => {
  it('builds the POSIX default project parent', () => {
    expect(getDefaultCreateProjectParent('/Users/alice')).toBe('/Users/alice/orca/projects')
  })

  it('builds the Windows default project parent', () => {
    expect(getDefaultCreateProjectParent('C:\\Users\\alice')).toBe(
      'C:\\Users\\alice\\orca\\projects'
    )
  })

  it('derives the runtime project default from a resolved server home', () => {
    expect(getDefaultCreateProjectParent('/home/alice')).toBe('/home/alice/orca/projects')
  })

  it('joins path previews without mixing separators', () => {
    expect(joinCreateProjectPath('/home/alice/orca/projects', 'demo')).toBe(
      '/home/alice/orca/projects/demo'
    )
    expect(joinCreateProjectPath('C:\\Users\\alice\\orca\\projects', 'demo')).toBe(
      'C:\\Users\\alice\\orca\\projects\\demo'
    )
  })

  it('derives the project parent from the configured Orca workspace root', () => {
    expect(getDefaultCreateProjectParentFromWorkspaceDir('/Users/alice/orca/workspaces')).toBe(
      '/Users/alice/orca/projects'
    )
    expect(
      getDefaultCreateProjectParentFromWorkspaceDir('C:\\Users\\alice\\orca\\workspaces')
    ).toBe('C:\\Users\\alice\\orca\\projects')
  })

  it('follows custom workspace directory preferences', () => {
    expect(getDefaultCreateProjectParentFromWorkspaceDir('/Volumes/dev/orca-workspaces')).toBe(
      '/Volumes/dev/orca-workspaces/projects'
    )
    expect(getDefaultCreateProjectParentFromWorkspaceDir('D:\\Dev\\Orca')).toBe(
      'D:\\Dev\\Orca\\projects'
    )
  })

  it('auto-fills only the first empty local create step', () => {
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: null,
        workspaceDir: '/Users/alice/orca/workspaces',
        createStepAutoFilled: false
      })
    ).toEqual({ parent: '/Users/alice/orca/projects' })
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '/tmp/project',
        activeRuntimeEnvironmentId: null,
        workspaceDir: '/Users/alice/orca/workspaces',
        createStepAutoFilled: false
      })
    ).toBeNull()
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: null,
        workspaceDir: '/Users/alice/orca/workspaces',
        createStepAutoFilled: true
      })
    ).toBeNull()
  })

  it('does not apply a local default while a runtime environment is active', () => {
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: 'env-1',
        workspaceDir: '/Users/alice/orca/workspaces',
        createStepAutoFilled: false
      })
    ).toBeNull()
  })

  it('uses a short local summary only for the local default parent', () => {
    expect(
      formatCreateProjectParentSummary({
        parent: '/Users/alice/orca/projects',
        defaultParent: '/Users/alice/orca/projects'
      })
    ).toBe('~/orca/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '',
        defaultParent: '',
        runtimeEnvironmentId: 'env-1'
      })
    ).toBe('server folder not selected')
  })
})
