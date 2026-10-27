import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createServer, listen, parsePort } from './server.ts'

const root = join(import.meta.dirname, '..')
const host = '127.0.0.1'

let port: number
try {
  port = parsePort(process.env.PORT)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}

const server = createServer({ root, dataDir: join(root, 'data') })

try {
  const actual = await listen(server, port, host)
  const url = `http://127.0.0.1:${actual}`
  console.log(`Lapwing Lab running at ${url}`)
  if (!process.env.NO_OPEN) {
    // Opening the browser is a convenience; a missing xdg-open must never matter.
    const child = spawn('xdg-open', [url], { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
