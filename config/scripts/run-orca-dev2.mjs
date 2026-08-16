import { applyOrcaDev2Environment } from './orca-dev2-profile.mjs'

applyOrcaDev2Environment()
await import('./run-electron-vite-dev.mjs')
