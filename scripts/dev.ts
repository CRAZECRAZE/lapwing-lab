import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })

const children: ChildProcess[] = [
  run('node', ['--watch', 'server/main.ts'], { NO_OPEN: '1' }),
  run('npx', ['vite']),
]

let stopping = false
function stop(code: number) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 500).unref()
}

for (const child of children) {
  child.on('error', (err) => {
    console.error(err.message)
    stop(1)
  })
  // If either side dies, take the other down too.
  child.on('exit', (code) => stop(code ?? 0))
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
