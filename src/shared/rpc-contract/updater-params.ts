import { z } from 'zod'

export const UpdaterCheckParams = z.object({
  includePrerelease: z.boolean().optional(),
  includePerfPrerelease: z.boolean().optional()
})

const Sha256Digest = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest.')

export const LocalBuildInstallStartParams = z.object({
  manifestPath: z.string().min(1),
  expectedManifestSha256: Sha256Digest,
  expectedArtifactSha256: Sha256Digest
})
