#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const DESKTOP_RELEASE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/

export function parseDesktopReleaseTag(tag) {
  if (typeof tag !== 'string') {
    return null
  }

  const match = DESKTOP_RELEASE_TAG_PATTERN.exec(tag)
  if (!match) {
    return null
  }

  return {
    tag,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: match[4] === undefined ? null : Number(match[4])
  }
}

function compareDesktopReleaseTags(a, b) {
  const versionDiff = a.major - b.major || a.minor - b.minor || a.patch - b.patch
  if (versionDiff !== 0) {
    return versionDiff
  }
  if (a.rc === b.rc) {
    return 0
  }
  if (a.rc === null) {
    return 1
  }
  if (b.rc === null) {
    return -1
  }
  return a.rc - b.rc
}

export function latestPreviousDesktopReleaseTag(tags, tag) {
  const current = parseDesktopReleaseTag(tag)
  if (!current) {
    return ''
  }

  const previousTags = tags
    .map((candidate) => parseDesktopReleaseTag(candidate))
    .filter((candidate) => candidate && candidate.tag !== current.tag)
    .filter((candidate) => compareDesktopReleaseTags(candidate, current) < 0)
    .sort(compareDesktopReleaseTags)

  return previousTags.at(-1)?.tag ?? ''
}

export function gitTagNames({ cwd = process.cwd(), execFileSyncImpl = execFileSync } = {}) {
  return execFileSyncImpl('git', ['tag', '--list'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function previousDesktopReleaseTagFromGit(tag, options = {}) {
  if (!parseDesktopReleaseTag(tag)) {
    return ''
  }

  return latestPreviousDesktopReleaseTag(gitTagNames(options), tag)
}

function main() {
  const tag = process.argv[2]
  if (!tag) {
    throw new Error('Usage: node config/scripts/previous-desktop-release-tag.mjs <tag>')
  }

  process.stdout.write(previousDesktopReleaseTagFromGit(tag))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
