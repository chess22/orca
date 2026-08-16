#!/usr/bin/env node

import { applyOrcaDev2Environment } from './orca-dev2-profile.mjs'

applyOrcaDev2Environment()
await import('./orca-dev.mjs')
