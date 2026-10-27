export type HeadlessLocalBuildInstallRequest = {
  manifestPath: string
  expectedManifestSha256: string
  expectedArtifactSha256: string
}

export type HeadlessLocalBuildInstallPhase =
  | 'validating'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'staged'
  | 'installing'
  | 'relaunching'
  | 'failed'

export type HeadlessLocalBuildInstallTransition = {
  phase: HeadlessLocalBuildInstallPhase
  at: number
  version?: string
  percent?: number
  message?: string
}

export type HeadlessLocalBuildInstallSnapshot = {
  operationId: string
  manifestPath: string
  expectedManifestSha256: string
  expectedArtifactSha256: string
  current: HeadlessLocalBuildInstallTransition
  transitions: HeadlessLocalBuildInstallTransition[]
}
