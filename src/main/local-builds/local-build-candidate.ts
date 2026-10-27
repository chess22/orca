import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import {
  LOCAL_BUILD_COMPATIBILITY_FILENAME,
  ORCA_APP_ID,
  parseLocalBuildCompatibility,
  type LocalBuildCompatibility
} from '../../shared/local-build-compatibility'
import { isValidAppVersion } from '../../shared/app-version'

const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_COMPATIBILITY_BYTES = 64 * 1024
const MAX_UPDATE_FILES = 8
const MAX_ZIP_BYTES = 8 * 1024 * 1024 * 1024
const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._ ()+-]*\.zip$/

type ManifestFile = { url: string; sha512: string; size?: number }
type HashRequest = ['sha256' | 'sha512', 'hex' | 'base64']

export type LocalBuildCandidate = {
  version: string
  compatibility: LocalBuildCompatibility
  manifestContent: string
  artifacts: Map<string, { file: FileHandle; size: number }>
  close: () => Promise<void>
}

type LocalBuildCandidateLoaderOptions = {
  readCompatibility?: (zipFile: FileHandle) => Promise<LocalBuildCompatibility>
  expectedManifestSha256?: string
  expectedArtifactSha256?: string
  requireAttestedProvenance?: boolean
}

function assertAttestedCandidateProvenance(
  compatibility: LocalBuildCompatibility,
  manifestVersion: string
) {
  const expectedArtifactIdentity = `orca@${manifestVersion}:darwin-${compatibility.architecture}`
  if (
    compatibility.attestation !== 'attested' ||
    compatibility.packageName !== 'orca' ||
    compatibility.artifactIdentity !== expectedArtifactIdentity ||
    typeof compatibility.sourceCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(compatibility.sourceCommit) ||
    !/^[a-f0-9]{7,40}$/.test(compatibility.commit) ||
    !compatibility.sourceCommit.startsWith(compatibility.commit) ||
    !compatibility.buildId
  ) {
    throw new Error('The selected ZIP has invalid attested build provenance.')
  }
}

function parseManifestFile(value: unknown) {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  if (
    typeof record.url !== 'string' ||
    !SAFE_ARTIFACT_NAME.test(record.url) ||
    basename(record.url) !== record.url ||
    typeof record.sha512 !== 'string' ||
    !/^[A-Za-z0-9+/]{86}==$/.test(record.sha512) ||
    (record.size !== undefined && (!Number.isSafeInteger(record.size) || Number(record.size) <= 0))
  ) {
    throw new Error('The local update manifest contains an invalid file entry.')
  }
  return {
    url: record.url,
    sha512: record.sha512,
    ...(record.size === undefined ? {} : { size: Number(record.size) })
  }
}

function isZipManifestFile(value: unknown) {
  const url =
    value && typeof value === 'object' ? (value as Record<string, unknown>).url : undefined
  return !Array.isArray(value) && typeof url === 'string' && url.toLowerCase().endsWith('.zip')
}

function parseManifest(value: unknown) {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  if (
    typeof record.version !== 'string' ||
    record.version.length > 100 ||
    !isValidAppVersion(record.version) ||
    !Array.isArray(record.files) ||
    record.files.length === 0 ||
    record.files.length > MAX_UPDATE_FILES
  ) {
    throw new Error('The selected file is not a valid macOS update manifest.')
  }
  const zipFiles = record.files.filter(isZipManifestFile)
  if (zipFiles.length === 0) {
    throw new Error('The selected macOS update manifest does not contain a ZIP.')
  }
  return { version: record.version, files: zipFiles.map(parseManifestFile) }
}

async function hashFile(file: FileHandle, [algorithm, encoding]: HashRequest) {
  const hash = createHash(algorithm)
  await new Promise<void>((resolve, reject) => {
    const stream = file.createReadStream({ autoClose: false, start: 0 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest(encoding)
}

async function assertContainedRegularFile(rootPath: string, filePath: string) {
  const fileInfo = await lstat(filePath)
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
    throw new Error('Local update artifacts must be regular files, not links.')
  }
  const [resolvedRoot, resolvedFile] = await Promise.all([realpath(rootPath), realpath(filePath)])
  if (dirname(resolvedFile) !== resolvedRoot) {
    throw new Error('Local update artifacts must stay beside latest-mac.yml.')
  }
}

function extractCompatibility(zipFile: FileHandle) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      '/usr/bin/unzip',
      ['-p', '/dev/fd/3', `Orca.app/Contents/Resources/${LOCAL_BUILD_COMPATIBILITY_FILENAME}`],
      { stdio: ['ignore', 'pipe', 'ignore', zipFile.fd] }
    )
    const chunks: Buffer[] = []
    let outputBytes = 0
    let outputError: Error | null = null
    const stdout = child.stdout
    if (!stdout) {
      child.kill()
      reject(new Error('Could not read compatibility metadata.'))
      return
    }
    stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_COMPATIBILITY_BYTES) {
        outputError = new Error('Compatibility metadata is too large.')
        child.kill()
        return
      }
      chunks.push(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (outputError) {
        reject(outputError)
      } else if (code !== 0) {
        reject(new Error(`unzip exited with status ${code ?? 'unknown'}.`))
      } else {
        resolve(Buffer.concat(chunks).toString('utf8'))
      }
    })
  })
}

async function readCompatibility(zipFile: FileHandle) {
  let stdout: string
  try {
    stdout = await extractCompatibility(zipFile)
  } catch (error) {
    console.warn('[local-build] Could not read compatibility metadata:', error)
    throw new Error(
      'This build predates local switching or is missing its signed compatibility metadata.'
    )
  }
  try {
    return parseLocalBuildCompatibility(JSON.parse(stdout))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('The selected build has malformed compatibility metadata.')
    }
    throw error
  }
}

async function validateArtifact(
  rootPath: string,
  manifestFile: ManifestFile,
  manifestVersion: string,
  compatibilityReader: (zipFile: FileHandle) => Promise<LocalBuildCompatibility>,
  requireAttestedProvenance: boolean
) {
  const filePath = join(rootPath, manifestFile.url)
  await assertContainedRegularFile(rootPath, filePath)
  const file = await openReadonly(filePath)
  try {
    const fileStats = await file.stat()
    if (!fileStats.isFile() || fileStats.size <= 0 || fileStats.size > MAX_ZIP_BYTES) {
      throw new Error('The selected local build ZIP has an invalid size.')
    }
    if (manifestFile.size !== undefined && fileStats.size !== manifestFile.size) {
      throw new Error(`Size verification failed for ${manifestFile.url}.`)
    }
    if ((await hashFile(file, ['sha512', 'base64'])) !== manifestFile.sha512) {
      throw new Error(`SHA-512 verification failed for ${manifestFile.url}.`)
    }
    const sha256 = await hashFile(file, ['sha256', 'hex'])
    const compatibility = await compatibilityReader(file)
    if (compatibility.appId !== ORCA_APP_ID || compatibility.version !== manifestVersion) {
      throw new Error('The selected ZIP does not match its update manifest.')
    }
    if (requireAttestedProvenance) {
      assertAttestedCandidateProvenance(compatibility, manifestVersion)
    }
    return { compatibility, file, sha256, size: fileStats.size }
  } catch (error) {
    await file.close()
    throw error
  }
}

const openReadonly = (filePath: string) =>
  open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))

async function closeArtifacts(artifacts: Awaited<ReturnType<typeof validateArtifact>>[]) {
  await Promise.all(artifacts.map((entry) => entry.file.close()))
}

export async function loadLocalBuildCandidate(
  manifestPath: string,
  architecture: NodeJS.Architecture,
  options: LocalBuildCandidateLoaderOptions = {}
) {
  if (basename(manifestPath) !== 'latest-mac.yml') {
    throw new Error('Select the latest-mac.yml generated by pn build:mac.')
  }
  await assertContainedRegularFile(dirname(manifestPath), manifestPath)
  const manifestFile = await openReadonly(manifestPath)
  let manifestText: string
  try {
    const manifestStats = await manifestFile.stat()
    if (manifestStats.size <= 0 || manifestStats.size > MAX_MANIFEST_BYTES) {
      throw new Error('The selected update manifest is too large.')
    }
    const manifestBytes = await manifestFile.readFile()
    if (
      options.expectedManifestSha256 !== undefined &&
      createHash('sha256').update(manifestBytes).digest('hex') !== options.expectedManifestSha256
    ) {
      throw new Error('SHA-256 verification failed for latest-mac.yml.')
    }
    manifestText = manifestBytes.toString('utf8')
  } finally {
    await manifestFile.close()
  }
  const manifest = parseManifest(parse(manifestText, { maxAliasCount: 0 }))
  const compatibilityReader = options.readCompatibility ?? readCompatibility
  const requireAttestedProvenance =
    options.requireAttestedProvenance ??
    (options.expectedManifestSha256 !== undefined && options.expectedArtifactSha256 !== undefined)
  const validationResults = await Promise.allSettled(
    manifest.files.map((file) =>
      validateArtifact(
        dirname(manifestPath),
        file,
        manifest.version,
        compatibilityReader,
        requireAttestedProvenance
      )
    )
  )
  const validated = validationResults
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
  const failed = validationResults.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') {
    await closeArtifacts(validated)
    throw failed.reason
  }
  const matching = validated
    .map((entry, index) => ({ ...entry, manifestFile: manifest.files[index] }))
    .filter((entry) => entry.compatibility.architecture === architecture)
  if (matching.length !== 1) {
    await closeArtifacts(validated)
    throw new Error(`The manifest must contain exactly one ${architecture} Orca ZIP.`)
  }
  const target = matching[0]
  if (
    options.expectedArtifactSha256 !== undefined &&
    target.sha256 !== options.expectedArtifactSha256
  ) {
    await closeArtifacts(validated)
    throw new Error(`SHA-256 verification failed for ${target.manifestFile.url}.`)
  }
  await Promise.all(
    validated.filter((entry) => entry.file !== target.file).map((entry) => entry.file.close())
  )
  const sanitizedFile = target.manifestFile
  return {
    version: manifest.version,
    compatibility: target.compatibility,
    manifestContent: stringify({
      version: manifest.version,
      files: [sanitizedFile],
      path: sanitizedFile.url,
      sha512: sanitizedFile.sha512
    }),
    artifacts: new Map([[target.manifestFile.url, { file: target.file, size: target.size }]]),
    close: () => target.file.close()
  }
}
