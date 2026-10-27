import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { connect } from 'node:net'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

describe('archive API', () => {
  let dir: string
  let dataDir: string
  let api: Server
  let url: string

  async function start(): Promise<void> {
    api = createServer({ root: dir, dataDir })
    url = `http://127.0.0.1:${await listen(api, 0)}`
  }

  function call(method: string, path: string, body?: unknown) {
    return fetch(`${url}${path}`, {
      method,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
  }

  const strokeBody = {
    tsMs: 100,
    prompt: 'sap',
    expected: ['SAP'],
    pressedLevers: ['S1-', 'A-', 'T-'],
    pressedMask: 11,
    correct: false,
    latencyMs: 400,
    attemptNo: 1,
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lapwing-api-'))
    dataDir = join(dir, 'data', 'nested')
    await start()
  })

  afterEach(async () => {
    await new Promise((ok) => api.close(ok))
    rmSync(dir, { recursive: true, force: true })
  })

  async function newTest(): Promise<number> {
    const { id: sessionId } = (await (await call('POST', '/api/sessions', { startedAt: 1000 })).json()) as { id: number }
    const res = await call('POST', '/api/tests', {
      sessionId, startedAt: 1001, mode: 'stage0-test', chapter: 4, section: 'pseudo', itemCount: 2,
    })
    return ((await res.json()) as { id: number }).id
  }

  it('creates nothing on disk until the first archive request', async () => {
    await call('GET', '/api/health')
    await call('GET', '/api/settings')
    await call('GET', '/content/nope')
    expect(existsSync(join(dir, 'data'))).toBe(false)
    await call('POST', '/api/sessions', { startedAt: 1 })
    expect(existsSync(join(dataDir, 'steno.db'))).toBe(true)
  })

  it('runs the full POST sequence and returns the finished test', async () => {
    const testId = await newTest()
    expect(testId).toBeGreaterThan(0)
    for (const body of [strokeBody, { ...strokeBody, correct: true, pressedLevers: ['S1-', 'A-', 'P-'] }]) {
      const res = await call('POST', `/api/tests/${testId}/strokes`, body)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    }
    expect(await (await call('GET', '/api/tests/last?mode=stage0-test&section=pseudo')).json()).toBeNull()
    const fin = await call('POST', `/api/tests/${testId}/finish`, {
      endedAt: 2000, wpm: 12, accuracy: 0.9, meta: { missed: ['SAP'] },
    })
    expect(await fin.json()).toEqual({ ok: true })
    const last = await call('GET', '/api/tests/last?mode=stage0-test&section=pseudo')
    expect(last.headers.get('content-type')).toContain('application/json')
    expect(await last.json()).toMatchObject({
      id: testId, endedAt: 2000, accuracy: 0.9, wpm: 12, chapter: 4, section: 'pseudo', meta: { missed: ['SAP'] },
    })
  })

  it('answers GET /api/tests/last for an unknown test with null, and 400 without params', async () => {
    expect(await (await call('GET', '/api/tests/last?mode=x&section=y')).json()).toBeNull()
    expect((await call('GET', '/api/tests/last?mode=x')).status).toBe(400)
  })

  it('400s bad JSON and wrong shapes with an {error} body', async () => {
    const testId = await newTest()
    const cases: [string, unknown][] = [
      ['/api/sessions', '{not json'],
      ['/api/sessions', ''],
      ['/api/sessions', []],
      ['/api/sessions', { startedAt: 'now' }],
      ['/api/sessions', { startedAt: null }],
      ['/api/tests', { sessionId: 1, startedAt: 1, mode: '', chapter: null, section: null, itemCount: 1 }],
      ['/api/tests', { sessionId: 1, startedAt: 1, mode: 'm', chapter: 'x', section: null, itemCount: 1 }],
      ['/api/tests', { sessionId: 1, startedAt: 1, mode: 'm', chapter: null, section: null }],
      [`/api/tests/${testId}/strokes`, { ...strokeBody, pressedLevers: ['S1-', 'ZZ'] }],
      [`/api/tests/${testId}/strokes`, { ...strokeBody, expected: 'SAP' }],
      [`/api/tests/${testId}/strokes`, { ...strokeBody, correct: 1 }],
      [`/api/tests/${testId}/strokes`, { ...strokeBody, latencyMs: 'fast' }],
      [`/api/tests/${testId}/strokes`, { ...strokeBody, pressedMask: -1 }],
      [`/api/tests/${testId}/finish`, { endedAt: 1, wpm: 'x', accuracy: 1, meta: null }],
      [`/api/tests/${testId}/strokes`, { ...strokeBody, tsMs: 1e18 }],
      [`/api/tests/${testId}/strokes`, { ...strokeBody, tsMs: 1.5 }],
      [`/api/tests/${testId}/strokes`, { ...strokeBody, latencyMs: -1 }],
      [`/api/tests/${testId}/strokes`, { ...strokeBody, latencyMs: 1e300 }],
      [`/api/tests/${testId}/strokes`, { ...strokeBody, attemptNo: 0 }],
      [`/api/tests/${testId}/strokes`, { ...strokeBody, attemptNo: 1.5 }],
      [`/api/tests/${testId}/finish`, { endedAt: 1e18, wpm: 1, accuracy: 1, meta: null }],
      [`/api/tests/${testId}/finish`, { endedAt: 1.5, wpm: 1, accuracy: 1, meta: null }],
      [`/api/tests/${testId}/finish`, { endedAt: 1, wpm: -1, accuracy: 1, meta: null }],
      [`/api/tests/${testId}/finish`, { endedAt: 1, wpm: 1, accuracy: 1.5, meta: null }],
      [`/api/tests/${testId}/finish`, { endedAt: 1, wpm: 1, accuracy: -0.5, meta: null }],
      ['/api/sessions', { startedAt: 1e18 }],
      ['/api/tests', { sessionId: 1, startedAt: 1e18, mode: 'm', chapter: null, section: null, itemCount: 1 }],
      ['/api/tests', { sessionId: 1, startedAt: 1, mode: 'm', chapter: null, section: null, itemCount: -1 }],
      ['/api/tests', { sessionId: 1, startedAt: 1, mode: 'm', chapter: null, section: 5, itemCount: 1 }],
      ['/api/settings', { boardVisibility: 'sideways' }],
      ['/api/settings', '[]'],
    ]
    for (const [path, body] of cases) {
      const res = await call(path === '/api/settings' ? 'PUT' : 'POST', path, body)
      expect(res.status, `${path} ${JSON.stringify(body)}`).toBe(400)
      const json = (await res.json()) as { error: string }
      expect(typeof json.error).toBe('string')
      expect(json.error).not.toMatch(/\bat \S+\.ts|node:|stack/i)
    }
  })

  it('keeps the store readable after rejected oversized timestamps', async () => {
    const testId = await newTest()
    await call('POST', `/api/tests/${testId}/strokes`, { ...strokeBody, tsMs: 1e18 })
    await call('POST', `/api/tests/${testId}/finish`, { endedAt: 1e18, wpm: 1, accuracy: 1, meta: null })
    expect(await (await call('GET', '/api/tests/last?mode=stage0-test&section=pseudo')).json()).toBeNull()
    expect((await call('POST', `/api/tests/${testId}/finish`, { endedAt: 5, wpm: 1, accuracy: 1, meta: null })).status).toBe(200)
    expect(await (await call('GET', '/api/tests/last?mode=stage0-test&section=pseudo')).json()).toMatchObject({ endedAt: 5 })
  })

  it('treats an omitted chapter or section as null', async () => {
    const { id: sessionId } = (await (await call('POST', '/api/sessions', { startedAt: 1 })).json()) as { id: number }
    const res = await call('POST', '/api/tests', { sessionId, startedAt: 2, mode: 'free', itemCount: 0 })
    expect(res.status).toBe(200)
    const { id } = (await res.json()) as { id: number }
    await call('POST', `/api/tests/${id}/finish`, { endedAt: 3, wpm: 0, accuracy: 0, meta: null })
    const only = await call('POST', '/api/tests', { sessionId, startedAt: 2, mode: 'm', chapter: 'x', itemCount: 0 })
    expect(only.status).toBe(400)
  })

  it('rejects non-finite numbers', async () => {
    // JSON cannot carry NaN/Infinity, but 1e999 parses to Infinity.
    expect((await call('POST', '/api/sessions', '{"startedAt":1e999}')).status).toBe(400)
  })

  it('404s unknown test ids and unknown sessions', async () => {
    expect((await call('POST', '/api/tests/999/strokes', strokeBody)).status).toBe(404)
    expect((await call('POST', '/api/tests/999/finish', { endedAt: 1, wpm: 1, accuracy: 1, meta: null })).status).toBe(404)
    expect((await call('POST', '/api/tests/abc/strokes', strokeBody)).status).toBe(404)
    const res = await call('POST', '/api/tests', {
      sessionId: 999, startedAt: 1, mode: 'm', chapter: null, section: null, itemCount: 1,
    })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBeTruthy()
  })

  it('405s wrong methods with an Allow header', async () => {
    const cases: [string, string, string][] = [
      ['GET', '/api/sessions', 'POST'],
      ['GET', '/api/tests', 'POST'],
      ['POST', '/api/tests/last', 'GET'],
      ['GET', '/api/tests/1/strokes', 'POST'],
      ['GET', '/api/tests/1/finish', 'POST'],
      ['DELETE', '/api/settings', 'GET, PUT'],
      ['POST', '/api/settings', 'GET, PUT'],
    ]
    for (const [method, path, allowed] of cases) {
      const res = await call(method, path)
      expect(res.status, `${method} ${path}`).toBe(405)
      expect(res.headers.get('allow'), `${method} ${path}`).toBe(allowed)
    }
  })

  it('413s bodies over 1 MB and keeps serving', async () => {
    const { port } = new URL(url)
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/api/sessions', method: 'POST', headers: { 'transfer-encoding': 'chunked' } },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        },
      )
      req.on('error', reject)
      req.write(Buffer.alloc(2 * 1024 * 1024, 0x20))
      req.end()
    })
    expect(status).toBe(413)
    const declared = await call('POST', '/api/sessions', ' '.repeat(1024 * 1024 + 1))
    expect(declared.status).toBe(413)
    expect((await call('GET', '/api/health')).status).toBe(200)
  })

  it('serves and updates settings', async () => {
    expect(await (await call('GET', '/api/settings')).json()).toEqual({ boardVisibility: 'always' })
    const put = await call('PUT', '/api/settings', { boardVisibility: 'hover' })
    expect(await put.json()).toEqual({ boardVisibility: 'hover' })
    expect(await (await call('GET', '/api/settings')).json()).toEqual({ boardVisibility: 'hover' })
  })

  it('400s an invalid settings PUT and leaves the file unchanged', async () => {
    await call('PUT', '/api/settings', { boardVisibility: 'hidden' })
    const file = join(dataDir, 'settings.json')
    const before = readFileSync(file, 'utf8')
    expect((await call('PUT', '/api/settings', { boardVisibility: 'sideways' })).status).toBe(400)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('falls back to defaults when settings.json is corrupt', async () => {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'settings.json'), '{oops')
    expect(await (await call('GET', '/api/settings')).json()).toEqual({ boardVisibility: 'always' })
  })

  it('keeps data across a server restart', async () => {
    const testId = await newTest()
    await call('POST', `/api/tests/${testId}/finish`, { endedAt: 2000, wpm: 1, accuracy: 0.5, meta: null })
    await new Promise((ok) => api.close(ok))
    await start()
    const last = (await (await call('GET', '/api/tests/last?mode=stage0-test&section=pseudo')).json()) as { id: number }
    expect(last.id).toBe(testId)
  })
})
