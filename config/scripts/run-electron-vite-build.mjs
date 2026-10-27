import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveElectronViteBuildInvocation,
  verifyRendererAfterElectronViteBuild
} from './electron-vite-build-invocation.mjs'
import { appendBuildOldSpaceOption } from './node-old-space-limit.mjs'
import { RENDERER_BUILD_DIR, verifyRendererBootGraph } from './renderer-boot-graph.mjs'

const require = createRequire(import.meta.url)
const electronVitePackageJson = require.resolve('electron-vite/package.json')
const electronViteCli = path.join(path.dirname(electronVitePackageJson), 'bin', 'electron-vite.js')
const defaultConfig = fileURLToPath(new URL('../electron-vite-build.config.cts', import.meta.url))

// Release builds have started OOMing on GitHub's macOS runners during the
// renderer bundle. Reserve memory on smaller hosts so the OS does not kill Vite.
const nodeOptions = appendBuildOldSpaceOption(process.env.NODE_OPTIONS)

const invocation = resolveElectronViteBuildInvocation(
  process.argv.slice(2),
  process.env,
  defaultConfig
)
const child = spawn(process.execPath, [electronViteCli, 'build', ...invocation.args], {
  stdio: 'inherit',
  env: {
    ...invocation.env,
    NODE_OPTIONS: nodeOptions
  }
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  if (code !== 0) {
    process.exit(code ?? 1)
  }

  // Why here: this is the only place a real renderer bundle exists, and the
  // boot graph is exactly what a stray static import silently regresses. The
  // target gate keeps the parallel runner's concurrent main/preload builds from
  // reading out/renderer while the renderer target is still writing it.
  process.exit(
    verifyRendererAfterElectronViteBuild(
      invocation.env,
      fs.existsSync(path.join(RENDERER_BUILD_DIR, 'index.html')),
      verifyRendererBootGraph
    )
  )
})
