import { describe, expect, it } from 'vitest'
import {
  getPackagedBuildMetadata,
  readPackagedBuildMetadataFromResourceFile
} from './packaged-build-metadata'

describe('readPackagedBuildMetadataFromResourceFile', () => {
  it('reads branch/commitHash from the build-identity.json extraResource', () => {
    const readFile = () =>
      JSON.stringify({
        branch: 'chess22/version-identity',
        commitHash: 'a1b2c3d4'
      })

    expect(
      readPackagedBuildMetadataFromResourceFile('/resources/build-identity.json', readFile)
    ).toEqual({
      branch: 'chess22/version-identity',
      commitHash: 'a1b2c3d4'
    })
  })

  it('returns nulls when the fields are absent', () => {
    const readFile = () => JSON.stringify({})

    expect(
      readPackagedBuildMetadataFromResourceFile('/resources/build-identity.json', readFile)
    ).toEqual({
      branch: null,
      commitHash: null
    })
  })

  it('returns nulls without throwing when the file is unreadable or malformed', () => {
    const throwingRead = () => {
      throw new Error('ENOENT')
    }
    expect(
      readPackagedBuildMetadataFromResourceFile('/resources/build-identity.json', throwingRead)
    ).toEqual({
      branch: null,
      commitHash: null
    })

    const malformedRead = () => 'not json'
    expect(
      readPackagedBuildMetadataFromResourceFile('/resources/build-identity.json', malformedRead)
    ).toEqual({
      branch: null,
      commitHash: null
    })
  })
})

describe('getPackagedBuildMetadata', () => {
  it('skips reading build-identity.json entirely for interactive (non-packaged) runs', () => {
    expect(getPackagedBuildMetadata('/resources', false)).toEqual({
      branch: null,
      commitHash: null
    })
  })
})
