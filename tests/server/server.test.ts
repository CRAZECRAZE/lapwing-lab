import { mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { connect } from 'node:net'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, listen, parsePort } from '../../server/server.ts'

let root: string
let server: Server
let base: string

function write(rel: string, body: string | Uint8Array) {
  const file = join(root, rel)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, body)
}

// fetch() normalises dot segments, so send the raw request target ourselves.
function raw(target: string, method = 'GET'): Promise<{ status: number; body: string }> {
  const { port } = new URL(base)
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: target, method }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end()
  })
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'lapwing-server-'))
  write('content/build/book.json', '{"chapters":[]}')
  write('content/build/pages/ch05.json', '{}')
  write('content/buildx/secret.txt', 'sibling secret')
  write('content/lapwing-book/src/img/x.png', 'png-bytes')
  write('content/lapwing-book/src/Chapter-05.md', 'not an image')
  write('dist/index.html', '<!doctype html><title>app</title>')
  write('dist/assets/app.js', 'console.log(1)')
  write('dist/assets/app.css', 'body{}')
  write('dist/clip.mp4', 'mp4')
  write('dist/font.woff2', 'woff2')
  write('dist/big.bin', Buffer.alloc(32 * 1024 * 1024))
  write('package.json', '{"name":"outside"}')
  write('secret.txt', 'outside secret')
  server = createServer({ root, dataDir: join(root, 'data') })
  const port = await listen(server, 0)
  base = `http://127.0.0.1:${port}`
})

afterAll(() => {
  server.close()
  rmSync(root, { recursive: true, force: true })
})

describe('routes', () => {
  it('answers /api/health', async () => {
    const res = await fetch(`${base}/api/health`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ ok: true })
  })

  it('returns 404 for unknown /api routes', async () => {
    expect((await fetch(`${base}/api/nope`)).status).toBe(404)
  })

  it('serves /content/* from content/build as JSON', async () => {
    const res = await fetch(`${base}/content/book.json`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ chapters: [] })
    expect((await fetch(`${base}/content/pages/ch05.json`)).status).toBe(200)
  })

  it('serves /media/* from the book img folder', async () => {
    const res = await fetch(`${base}/media/x.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(await res.text()).toBe('png-bytes')
  })

  it('serves dist files with the right content types', async () => {
    const types: Record<string, string> = {
      '/': 'text/html',
      '/index.html': 'text/html',
      '/assets/app.js': 'text/javascript',
      '/assets/app.css': 'text/css',
      '/clip.mp4': 'video/mp4',
      '/font.woff2': 'font/woff2',
    }
    for (const [path, type] of Object.entries(types)) {
      const res = await fetch(`${base}${path}`)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('content-type'), path).toContain(type)
    }
  })

  it('falls back to index.html for client routes', async () => {
    const res = await fetch(`${base}/page/ch05`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('<title>app</title>')
  })

  it('does not fall back for files, /content or /media', async () => {
    expect((await fetch(`${base}/missing.js`)).status).toBe(404)
    expect((await fetch(`${base}/content/nope`)).status).toBe(404)
    expect((await fetch(`${base}/media/nope`)).status).toBe(404)
  })

  it('answers HEAD without a body', async () => {
    const res = await fetch(`${base}/content/book.json`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('15')
    expect(await res.text()).toBe('')
  })

  it('rejects non-GET/HEAD on static paths with an Allow header', async () => {
    for (const path of ['/content/book.json', '/media/x.png', '/index.html', '/page/ch05']) {
      const res = await fetch(`${base}${path}`, { method: 'POST' })
      expect(res.status, path).toBe(405)
      expect(res.headers.get('allow'), path).toBe('GET, HEAD')
    }
  })

  it('leaves methods on /api paths to the API handler', async () => {
    expect((await fetch(`${base}/api/nope`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${base}/api/nope`, { method: 'PUT', body: '{}' })).status).toBe(404)
  })
})

describe('path safety', () => {
  const attacks = [
    '/content/..%2F..%2Fetc%2Fpasswd',
    '/content/..%2Fbuildx%2Fsecret.txt',
    '/content/../buildx/secret.txt',
    '/content/%2e%2e/buildx/secret.txt',
    '/content/..%5Cbuildx%5Csecret.txt',
    '/content/..\\buildx\\secret.txt',
    '/content/%252e%252e%252fbuildx%252fsecret.txt',
    '/content/%2e%2e%2f%2e%2e%2fsecret.txt',
    '/media/../../package.json',
    '/media/..%2F..%2F..%2F..%2Fpackage.json',
    '/media/..%2FChapter-05.md',
    '/media/%2e%2e/Chapter-05.md',
    '/media/..%252f..%252fpackage.json',
    '/media/x.png%00.txt',
    '/..%2Fpackage.json',
    '/..%2F..%2Fetc%2Fpasswd',
    '/%2e%2e/secret.txt',
    '/assets/..%2F..%2Fsecret.txt',
  ]

  for (const target of attacks) {
    it(`404s ${target}`, async () => {
      const res = await raw(target)
      expect(res.status).toBe(404)
      expect(res.body).not.toContain('secret')
      expect(res.body).not.toContain('outside')
      expect(res.body).not.toContain('not an image')
    })
  }

  it('404s malformed percent-encoding instead of failing', async () => {
    expect((await raw('/content/%E0%A4%A')).status).toBe(404)
    expect((await raw('/%')).status).toBe(404)
  })

  it('404s directories', async () => {
    expect((await raw('/content/pages')).status).toBe(404)
    expect((await raw('/content/pages/')).status).toBe(404)
    expect((await raw('/media/')).status).toBe(404)
  })

  it('ignores the query string when resolving files', async () => {
    expect((await raw('/content/book.json?v=1')).status).toBe(200)
  })
})

describe('listen', () => {
  it('rejects with a message naming the port and PORT when it is busy', async () => {
    const other = createServer({ root, dataDir: join(root, 'data') })
    const taken = Number(new URL(base).port)
    const err = await listen(other, taken).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain(String(taken))
    expect((err as Error).message).toContain('PORT')
  })
})

describe('aborted downloads', () => {
  function openFds(suffix: string): string[] {
    return readdirSync('/proc/self/fd').filter((fd) => {
      try {
        return readlinkSync(`/proc/self/fd/${fd}`).endsWith(suffix)
      } catch {
        return false
      }
    })
  }

  it.skipIf(process.platform !== 'linux')('closes the file when the client disconnects mid-download', async () => {
    const { port } = new URL(base)
    const socket = connect(Number(port), '127.0.0.1')
    await new Promise<void>((ok) => socket.once('connect', () => ok()))
    socket.write('GET /big.bin HTTP/1.1\r\nHost: x\r\n\r\n')
    await new Promise<void>((ok) => socket.once('data', () => ok()))
    expect(openFds('big.bin')).toHaveLength(1)
    socket.destroy()
    for (let i = 0; i < 50 && openFds('big.bin').length > 0; i++) await new Promise((r) => setTimeout(r, 20))
    expect(openFds('big.bin')).toEqual([])
  })
})

describe('parsePort', () => {
  it('defaults to 5757 when unset or empty', () => {
    expect(parsePort(undefined)).toBe(5757)
    expect(parsePort('')).toBe(5757)
  })

  it('accepts valid ports', () => {
    expect(parsePort('8080')).toBe(8080)
    expect(parsePort('0')).toBe(0)
  })

  it('rejects non-numeric and out-of-range values', () => {
    for (const bad of ['abc', '12x', '-1', '65536', '1.5', ' ']) {
      expect(() => parsePort(bad), bad).toThrow(/PORT/)
    }
  })
})
