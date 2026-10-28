// Preact's hooks schedule effects with a setTimeout fallback and then call the global cancelAnimationFrame. An
// effect queued as a jsdom file ends can fire after Vitest tore the jsdom globals down, so that call threw an
// uncaught ReferenceError (exit code 1). This preload (test.execArgv, it must run before the environment is set up)
// gives plain Node timer-based globals; jsdom still shadows them in jsdom files and Vitest restores them at teardown.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number
}
if (typeof globalThis.cancelAnimationFrame !== 'function') {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
}
