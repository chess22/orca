import { describe, expect, it } from 'vitest'
import {
  getPackagedBuildMetadata,
  readPackagedBuildMetadataFromPackageJson
} from './packaged-build-metadata'

describe('readPackagedBuildMetadataFromPackageJson', () => {
  it('reads buildBranch/buildCommitHash written by electron-builder extraMetadata', () => {
    const readFile = () =>
      JSON.stringify({
        name: 'orca-dev-app',
        buildBranch: 'chess22/version-identity',
        buildCommitHash: 'a1b2c3d4'
      })

    expect(readPackagedBuildMetadataFromPackageJson('/app/package.json', readFile)).toEqual({
      branch: 'chess22/version-identity',
      commitHash: 'a1b2c3d4'
    })
  })

  it('returns nulls when the fields are absent (production package.json)', () => {
    const readFile = () => JSON.stringify({ name: 'orca' })

    expect(readPackagedBuildMetadataFromPackageJson('/app/package.json', readFile)).toEqual({
      branch: null,
      commitHash: null
    })
  })

  it('returns nulls without throwing when the file is unreadable or malformed', () => {
    const throwingRead = () => {
      throw new Error('ENOENT')
    }
    expect(readPackagedBuildMetadataFromPackageJson('/app/package.json', throwingRead)).toEqual({
      branch: null,
      commitHash: null
    })

    const malformedRead = () => 'not json'
    expect(readPackagedBuildMetadataFromPackageJson('/app/package.json', malformedRead)).toEqual({
      branch: null,
      commitHash: null
    })
  })
})

describe('getPackagedBuildMetadata', () => {
  it('skips reading package.json entirely for interactive (non-packaged) runs', () => {
    expect(getPackagedBuildMetadata('/repo', false)).toEqual({ branch: null, commitHash: null })
  })
})
