import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createServer, listen } from './server.ts'

const root = join(import.meta.dirname, '..')
const host = '127.0.0.1'

const rawPort = process.env.PORT ?? '5757'
const port = Number(rawPort)
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid PORT "${rawPort}". Use a number between 0 and 65535.`)
  process.exit(1)
}

const server = createServer({ root, dataDir: join(root, 'data') })

try {
  const actual = await listen(server, port, host)
  const url = `http://localhost:${actual}`
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
