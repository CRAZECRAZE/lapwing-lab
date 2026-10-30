import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createViteServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, listen } from '../../server/server.ts'
import { devProxy } from '../../vite.config.ts'

// The real dev setup in miniature: the API server on an ephemeral port behind a Vite dev server that uses the
// proxy options from vite.config.ts, with a browser-like Origin and Host (the Vite address) on every request.
let root: string
let api: Server
let vite: ViteDevServer
let vitePort: number

function viaVite(method: string, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: vitePort, path, method, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(method === 'GET' ? undefined : '{"hints":"always"}')
  })
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'lapwing-devproxy-'))
  mkdirSync(join(root, 'content', 'build'), { recursive: true })
  writeFileSync(join(root, 'content', 'build', 'book.json'), '{"chapters":[]}')
  api = createServer({ root, dataDir: join(root, 'data') })
  const apiPort = await listen(api, 0)
  vite = await createViteServer({
    configFile: false,
    root,
    logLevel: 'silent',
    server: { port: 0, host: '127.0.0.1', proxy: devProxy(`http://127.0.0.1:${apiPort}`), watch: null },
  })
  await vite.listen()
  const address = vite.httpServer?.address()
  vitePort = typeof address === 'object' && address ? address.port : 0
})

afterAll(async () => {
  await vite.close()
  api.close()
  rmSync(root, { recursive: true, force: true })
})

describe('Vite dev proxy', () => {
  const browser = () => ({ Host: `localhost:${vitePort}`, Origin: `http://localhost:${vitePort}` })

  it('reaches the guarded API with the browser Host and Origin of the Vite page', async () => {
    const read = await viaVite('GET', '/api/settings', browser())
    expect(read.status).toBe(200)
    const write = await viaVite('PUT', '/api/settings', { ...browser(), 'Content-Type': 'application/json' })
    expect(write.status).toBe(200)
    expect(JSON.parse(write.body)).toMatchObject({ hints: 'always' })
    expect((await viaVite('GET', '/content/book.json', browser())).status).toBe(200)
  })

  it('does not relabel a foreign Origin, so the server refuses it and writes nothing', async () => {
    const dataDir = join(root, 'data')
    rmSync(dataDir, { recursive: true, force: true }) // an earlier test saved settings here
    for (const origin of ['https://evil.example', 'http://evil.example', 'null', 'http://localhost:5173']) {
      const res = await viaVite('PUT', '/api/settings', {
        Host: `localhost:${vitePort}`,
        Origin: origin,
        'Content-Type': 'text/plain',
      })
      expect(res.status, origin).toBe(403)
      expect(res.body).toBe('Forbidden origin')
    }
    expect((await viaVite('GET', '/api/settings', { Host: `localhost:${vitePort}`, Origin: 'https://evil.example' })).status).toBe(403)
    expect(existsSync(dataDir)).toBe(false)
  })

  it('also works for a same-origin read without an Origin header', async () => {
    expect((await viaVite('GET', '/api/health', { Host: `localhost:${vitePort}` })).status).toBe(200)
  })
})
