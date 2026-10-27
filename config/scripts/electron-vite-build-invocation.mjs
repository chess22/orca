const explicitConfigCount = (args) => {
  let count = 0
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') {
      break
    }
    if (argument === '--config' || argument === '-c') {
      if (!args[index + 1] || args[index + 1].startsWith('-')) {
        throw new Error(`${argument} requires one config path`)
      }
      count += 1
      index += 1
    } else if (argument.startsWith('--config=')) {
      if (argument.length === '--config='.length) {
        throw new Error('--config requires one config path')
      }
      count += 1
    } else if (argument.startsWith('-c') && argument.length > 2) {
      count += 1
    }
  }
  if (count > 1) {
    throw new Error('Electron Vite accepts exactly one explicit config')
  }
  return count
}

export function resolveElectronViteBuildInvocation(args, env, defaultConfig) {
  if (explicitConfigCount(args) === 1) {
    return { args: [...args], env: { ...env }, usesDefaultConfig: false }
  }
  const childEnv = { ...env }
  delete childEnv.ORCA_ELECTRON_VITE_TARGET
  return {
    args: ['--config', defaultConfig, '--ignoreConfigWarning', ...args],
    env: childEnv,
    usesDefaultConfig: true
  }
}

export function verifyRendererAfterElectronViteBuild(env, rendererExists, verify) {
  const target = env.ORCA_ELECTRON_VITE_TARGET
  return rendererExists && (!target || target === 'renderer') ? verify() : 0
}
