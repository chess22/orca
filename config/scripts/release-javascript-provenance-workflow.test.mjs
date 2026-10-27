import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

describe('release JavaScript provenance workflow', () => {
  it('exports one build ID and injects the checked-out source into the bundle build', () => {
    const workflow = parse(readFileSync('.github/workflows/release-javascript.yml', 'utf8'))
    const bundle = workflow.jobs.bundle
    expect(workflow.on.workflow_call.outputs.build_id.value).toContain(
      'jobs.bundle.outputs.build_id'
    )
    expect(bundle.outputs.build_id).toContain('steps.source.outputs.build_id')
    const build = bundle.steps.find((step) => step.name === 'Build and archive release JavaScript')
    expect(build.env.ORCA_BUILD_ID).toContain('steps.source.outputs.build_id')
    expect(build.env.ORCA_BUILD_SOURCE_COMMIT).toContain('steps.source.outputs.sha')
    expect(build.env.ORCA_ADHOC_BUILD_VERSION).toContain('inputs.package_version')
  })

  it('passes the final adhoc version into the shared JavaScript build', () => {
    const source = readFileSync('.github/workflows/adhoc-mac-build.yml', 'utf8')
    expect(source).toContain('package_version: ${{ needs.orcad-template-support.outputs.version }}')
  })

  it.each(['release-mac-build.yml', 'release-cut.yml'])(
    '%s pins provenance to the checked-out HEAD without dirtying tracked source',
    (name) => {
      const source = readFileSync(`.github/workflows/${name}`, 'utf8')
      expect(source).toContain('ORCA_BUILD_SOURCE_COMMIT=$(git rev-parse HEAD)')
      expect(source).toContain('$RUNNER_TEMP/orca-workflow-tools')
      expect(source).not.toContain(
        'git checkout "$WORKFLOW_SHA" -- config/scripts/assert-github-release-is-draft.mjs'
      )
    }
  )

  it('keeps restored workflow actions outside the tracked source tree', () => {
    const source = readFileSync('.github/workflows/release-cut.yml', 'utf8')
    expect(source).toContain('.build/workflow-actions')
    expect(source).not.toContain('git checkout "$WORKFLOW_SHA" -- .github/actions')
    expect(readFileSync('.gitignore', 'utf8')).toContain('/.build/')
  })

  it('propagates the shared build ID into every packaging consumer', () => {
    const release = readFileSync('.github/workflows/release-cut.yml', 'utf8')
    const mac = readFileSync('.github/workflows/release-mac-build.yml', 'utf8')
    const adhoc = readFileSync('.github/workflows/adhoc-mac-build.yml', 'utf8')
    const windows = readFileSync('.github/workflows/dev-channel-win-build.yml', 'utf8')
    expect(release).toContain('needs.release-javascript.outputs.build_id')
    expect(release).toContain('RELEASE_MAC_BUILD_JAVASCRIPT_BUILD_ID')
    expect(mac).toContain('inputs.javascript_build_id')
    expect(adhoc).toContain('needs.release-javascript.outputs.build_id')
    expect(windows).toContain('inputs.javascript_build_id')
  })
})
