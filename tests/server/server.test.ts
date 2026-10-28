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
  write('content/lapwing-book/src/img/x.pdf', 'pdf-bytes')
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

  it('serves a vendored PDF from /media/* as application/pdf', async () => {
    const res = await fetch(`${base}/media/x.pdf`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(await res.text()).toBe('pdf-bytes')
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

  it('answers GET /api/tests/last with null without creating the archive, and reads it once it exists', async () => {
    expect(await (await call('GET', '/api/tests/last?mode=stage0&section=rows-star')).json()).toBeNull()
    expect(existsSync(join(dir, 'data'))).toBe(false)
    const testId = await newTest()
    await call('POST', `/api/tests/${testId}/finish`, { endedAt: 2000, wpm: 12, accuracy: 0.9, meta: {} })
    expect(await (await call('GET', '/api/tests/last?mode=stage0-test&section=pseudo')).json()).toMatchObject({ id: testId })
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

  it('does not answer GET /api/tests/last with a test that was left early', async () => {
    const done = await newTest()
    await call('POST', `/api/tests/${done}/finish`, { endedAt: 2000, wpm: 12, accuracy: 0.9, meta: {} })
    const left = await newTest()
    await call('POST', `/api/tests/${left}/finish`, { endedAt: 3000, wpm: 50, accuracy: 1, meta: { abandoned: true } })
    expect(await (await call('GET', '/api/tests/last?mode=stage0-test&section=pseudo')).json()).toMatchObject({ id: done })
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
      ['/api/settings', { hints: 'nope' }],
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
      ['DELETE', '/api/tests', 'GET, POST'],
      ['PUT', '/api/tests', 'GET, POST'],
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
    expect(await (await call('GET', '/api/settings')).json()).toEqual({ boardVisibility: 'always', hints: 'miss' })
    const put = await call('PUT', '/api/settings', { boardVisibility: 'hover' })
    expect(await put.json()).toEqual({ boardVisibility: 'hover', hints: 'miss' })
    expect(await (await call('GET', '/api/settings')).json()).toEqual({ boardVisibility: 'hover', hints: 'miss' })
  })

  it('stores hints on their own, keeps the board setting, and an empty PUT returns the current values', async () => {
    await call('PUT', '/api/settings', { boardVisibility: 'hidden' })
    const put = await call('PUT', '/api/settings', { hints: 'always' })
    expect(await put.json()).toEqual({ boardVisibility: 'hidden', hints: 'always' })
    expect(await (await call('GET', '/api/settings')).json()).toEqual({ boardVisibility: 'hidden', hints: 'always' })
    expect(await (await call('PUT', '/api/settings', {})).json()).toEqual({ boardVisibility: 'hidden', hints: 'always' })
    const both = await call('PUT', '/api/settings', { boardVisibility: 'always', hints: 'miss' })
    expect(await both.json()).toEqual({ boardVisibility: 'always', hints: 'miss' })
  })

  it('400s an invalid hints value and leaves the file unchanged', async () => {
    await call('PUT', '/api/settings', { hints: 'always' })
    const file = join(dataDir, 'settings.json')
    const before = readFileSync(file, 'utf8')
    expect((await call('PUT', '/api/settings', { hints: 'nope' })).status).toBe(400)
    expect((await call('PUT', '/api/settings', { boardVisibility: 'hover', hints: 7 })).status).toBe(400)
    expect(readFileSync(file, 'utf8')).toBe(before)
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
    expect(await (await call('GET', '/api/settings')).json()).toEqual({ boardVisibility: 'always', hints: 'miss' })
  })

  async function finishedRun(mode: string, section: string, meta: unknown, accuracy = 0.9, wpm = 20): Promise<number> {
    const { id: sessionId } = (await (await call('POST', '/api/sessions', { startedAt: 1000 })).json()) as { id: number }
    const res = await call('POST', '/api/tests', {
      sessionId, startedAt: 1001, mode, chapter: 4, section, itemCount: 1,
    })
    const id = ((await res.json()) as { id: number }).id
    await call('POST', `/api/tests/${id}/strokes`, strokeBody)
    await call('POST', `/api/tests/${id}/finish`, { endedAt: 2000, wpm, accuracy, meta })
    return id
  }

  it('answers results and progress reads on a fresh data dir without creating anything', async () => {
    for (const mode of ['stage0', 'section', 'chapter-test']) {
      const res = await call('GET', `/api/results?mode=${mode}`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    }
    expect(await (await call('GET', '/api/progress')).json()).toEqual([])
    const del = await call('DELETE', '/api/progress/5')
    expect(del.status).toBe(200)
    expect(await del.json()).toEqual({ ok: true })
    expect(existsSync(join(dir, 'data'))).toBe(false)
  })

  it('reports results from runs seeded through the POST routes and ignores abandoned ones', async () => {
    await finishedRun('section', 'rows-star', { passed: true }, 0.95, 30)
    await finishedRun('section', 'rows-star', { abandoned: true }, 1, 99)
    await finishedRun('stage0', 'other', { passed: true })
    const res = await call('GET', '/api/results?mode=section')
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual([
      {
        section: 'rows-star',
        runs: 1,
        passed: true,
        best: { accuracy: 0.95, wpm: 30 },
        last: { accuracy: 0.95, wpm: 30, endedAt: 2000, passed: true },
      },
    ])
    expect(((await (await call('GET', '/api/results?mode=stage0')).json()) as { section: string }[]).map((r) => r.section)).toEqual(['other'])
    expect(await (await call('GET', '/api/results?mode=chapter-test')).json()).toEqual([])
  })

  it('400s a missing or unknown results mode', async () => {
    for (const path of ['/api/results', '/api/results?mode=', '/api/results?mode=nope', '/api/results?mode=Section']) {
      const res = await call('GET', path)
      expect(res.status, path).toBe(400)
      expect(((await res.json()) as { error: string }).error, path).toContain('mode')
    }
  })

  it('round-trips, replaces and deletes progress marks', async () => {
    const before = Date.now()
    const put = await call('PUT', '/api/progress/5', { kind: 'read' })
    expect(put.status).toBe(200)
    const mark = (await put.json()) as { chapter: number; kind: string; at: number }
    expect(mark).toMatchObject({ chapter: 5, kind: 'read' })
    expect(mark.at).toBeGreaterThanOrEqual(before)
    expect(mark.at).toBeLessThanOrEqual(Date.now())
    expect(await (await call('GET', '/api/progress')).json()).toEqual([mark])
    await call('PUT', '/api/progress/2', { kind: 'override' })
    const replaced = (await (await call('PUT', '/api/progress/5', { kind: 'override' })).json()) as { kind: string }
    expect(replaced.kind).toBe('override')
    const all = (await (await call('GET', '/api/progress')).json()) as { chapter: number; kind: string }[]
    expect(all.map((m) => [m.chapter, m.kind])).toEqual([[2, 'override'], [5, 'override']])
    expect(await (await call('DELETE', '/api/progress/5')).json()).toEqual({ ok: true })
    expect(await (await call('DELETE', '/api/progress/5')).json()).toEqual({ ok: true })
    expect(((await (await call('GET', '/api/progress')).json()) as { chapter: number }[]).map((m) => m.chapter)).toEqual([2])
    expect((await call('PUT', '/api/progress/1', { kind: 'read' })).status).toBe(200)
    expect((await call('PUT', '/api/progress/99', { kind: 'read' })).status).toBe(200)
  })

  it('400s bad progress kinds and chapters before writing anything', async () => {
    for (const body of [{ kind: 'nope' }, { kind: 3 }, {}, [], 'x']) {
      expect((await call('PUT', '/api/progress/5', body)).status, JSON.stringify(body)).toBe(400)
    }
    expect((await call('PUT', '/api/progress/5', '{oops')).status).toBe(400)
    for (const chapter of ['0', '100', 'abc', '-1', '1.5', '007x', '12345678901234567890']) {
      expect((await call('PUT', `/api/progress/${chapter}`, { kind: 'read' })).status, `PUT ${chapter}`).toBe(400)
      expect((await call('DELETE', `/api/progress/${chapter}`)).status, `DELETE ${chapter}`).toBe(400)
    }
    expect(existsSync(join(dir, 'data'))).toBe(false)
  })

  it('405s wrong methods on results and progress with an Allow header', async () => {
    const cases: [string, string, string][] = [
      ['POST', '/api/results', 'GET'],
      ['PUT', '/api/results', 'GET'],
      ['POST', '/api/progress', 'GET'],
      ['DELETE', '/api/progress', 'GET'],
      ['GET', '/api/progress/5', 'PUT, DELETE'],
      ['POST', '/api/progress/5', 'PUT, DELETE'],
    ]
    for (const [method, path, allowed] of cases) {
      const res = await call(method, path)
      expect(res.status, `${method} ${path}`).toBe(405)
      expect(res.headers.get('allow'), `${method} ${path}`).toBe(allowed)
    }
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

describe('lab routes', () => {
  let dir: string
  let dataDir: string
  let api: Server
  let url: string

  function call(method: string, path: string, body?: unknown) {
    return fetch(`${url}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  }

  async function json(method: string, path: string, body?: unknown): Promise<any> {
    const res = await call(method, path, body)
    expect(res.status, `${method} ${path}`).toBe(200)
    return res.json()
  }

  // Seeds one finished test with `strokes` strokes through the public POST routes.
  async function seed(startedAt: number, strokes = 2): Promise<number> {
    const { id: sessionId } = await json('POST', '/api/sessions', { startedAt })
    const { id } = await json('POST', '/api/tests', {
      sessionId, startedAt, mode: 'stage0-test', chapter: 4, section: 'pseudo', itemCount: strokes,
    })
    for (let i = 0; i < strokes; i++) {
      await json('POST', `/api/tests/${id}/strokes`, {
        tsMs: startedAt + 1000 * (i + 1),
        prompt: 'sap',
        expected: ['SAP'],
        pressedLevers: ['S1-', 'A-', 'P-'],
        pressedMask: 11,
        correct: true,
        latencyMs: 400,
        attemptNo: 1,
      })
    }
    await json('POST', `/api/tests/${id}/finish`, { endedAt: startedAt + 5000, wpm: 10, accuracy: 1, meta: null })
    return id
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lapwing-lab-'))
    dataDir = join(dir, 'data')
    api = createServer({ root: dir, dataDir })
    url = `http://127.0.0.1:${await listen(api, 0)}`
  })

  afterEach(async () => {
    await new Promise((ok) => api.close(ok))
    rmSync(dir, { recursive: true, force: true })
  })

  it('answers empty results on a fresh data dir without creating anything', async () => {
    expect(await json('GET', '/api/tests')).toEqual([])
    expect(await json('GET', '/api/days?from=2026-10-01&to=2026-10-31')).toEqual([])
    expect(await json('GET', '/api/journal')).toEqual([])
    expect(await json('GET', '/api/journal/2026-10-27')).toEqual({ date: '2026-10-27', text: '' })
    expect(await json('GET', '/api/notes')).toEqual([])
    expect(await json('GET', '/api/notes/5')).toEqual({ chapter: 5, text: '' })
    expect((await call('GET', '/api/tests/1')).status).toBe(404)
    expect(existsSync(dataDir)).toBe(false)
  })

  it('lists tests newest first and honors limit, beforeId and date', async () => {
    const day1 = new Date(2026, 9, 26, 12).getTime()
    const day2 = new Date(2026, 9, 27, 12).getTime()
    const a = await seed(day1)
    const b = await seed(day2)
    const c = await seed(day2 + 60000)
    const all = await json('GET', '/api/tests')
    expect(all.map((t: { id: number }) => t.id)).toEqual([c, b, a])
    expect(all[0]).toMatchObject({ strokeCount: 2, mode: 'stage0-test' })
    expect((await json('GET', '/api/tests?limit=2')).map((t: { id: number }) => t.id)).toEqual([c, b])
    expect((await json('GET', `/api/tests?beforeId=${c}`)).map((t: { id: number }) => t.id)).toEqual([b, a])
    expect((await json('GET', '/api/tests?date=2026-10-26')).map((t: { id: number }) => t.id)).toEqual([a])
    expect((await json('GET', '/api/tests?limit=200')).length).toBe(3)
  })

  it('400s bad history parameters, with or without an archive', async () => {
    const bads = ['limit=0', 'limit=abc', 'limit=201', 'limit=-1', 'limit=1.5', 'limit=', 'beforeId=-1', 'beforeId=x', 'date=2026-02-30', 'date=2026-2-3']
    for (const q of bads) expect((await call('GET', `/api/tests?${q}`)).status, q).toBe(400)
    await seed(1000)
    for (const q of bads) expect((await call('GET', `/api/tests?${q}`)).status, q).toBe(400)
  })

  it('returns one test with its strokes, 404 for unknown ids, and keeps /last working', async () => {
    const id = await seed(5000, 3)
    const got = await json('GET', `/api/tests/${id}`)
    expect(got.test).toMatchObject({ id, mode: 'stage0-test', wpm: 10 })
    expect(got.strokes.length).toBe(3)
    expect(got.strokes[0]).toMatchObject({ prompt: 'sap', expected: ['SAP'] })
    expect((await call('GET', '/api/tests/999')).status).toBe(404)
    expect((await call('GET', '/api/tests/abc')).status).toBe(404)
    expect((await call('GET', `/api/tests/${'9'.repeat(30)}`)).status).toBe(404)
    expect(await json('GET', '/api/tests/last?mode=stage0-test&section=pseudo')).toMatchObject({ id })
    const res = await call('DELETE', `/api/tests/${id}`)
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET')
  })

  it('validates /api/days parameters and returns seeded totals', async () => {
    await seed(new Date(2026, 9, 27, 12).getTime(), 3)
    await seed(new Date(2026, 9, 27, 13).getTime(), 1)
    const days = await json('GET', '/api/days?from=2026-10-01&to=2026-10-31')
    expect(days).toEqual([expect.objectContaining({ date: '2026-10-27', tests: 2, strokes: 4 })])
    expect(await json('GET', '/api/days?from=2026-10-27&to=2026-10-27')).toHaveLength(1)
    expect(await json('GET', '/api/days?from=2024-10-11&to=2027-10-16')).toHaveLength(1) // exactly 1,100 days apart
    const bads = [
      '', 'from=2026-10-01', 'to=2026-10-31', 'from=2026-10-31&to=2026-10-01', 'from=2026-02-30&to=2026-03-01',
      'from=abc&to=2026-10-01', 'from=2024-10-10&to=2027-10-16', 'from=2000-01-01&to=2026-10-31',
    ]
    for (const q of bads) expect((await call('GET', `/api/days?${q}`)).status, q).toBe(400)
    const res = await call('POST', '/api/days?from=2026-10-01&to=2026-10-31')
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET')
  })

  it('answers /api/stats with the shape, defaulting to free mode', async () => {
    await seed(new Date(2026, 9, 27, 12).getTime(), 3)
    const all = await json('GET', '/api/stats?from=2026-10-01&to=2026-10-31&mode=all')
    expect(all).toMatchObject({ from: '2026-10-01', to: '2026-10-31', mode: 'all', allTimeStrokes: 3 })
    expect(all.days).toEqual([expect.objectContaining({ date: '2026-10-27', runs: 1 })])
    expect(all.keys).toEqual(expect.arrayContaining([expect.objectContaining({ slot: 'S-', required: 3, missed: 0 })]))
    expect(all.mixups).toEqual([])
    // the seeded run is a stage0-test run: not a free run, so the default mode lists no day, but keys still count it
    const dflt = await json('GET', '/api/stats?from=2026-10-01&to=2026-10-31')
    expect(dflt).toMatchObject({ mode: 'free', days: [], allTimeStrokes: 3 })
    expect(dflt.keys).toEqual(all.keys)
    expect((await json('GET', '/api/stats?from=2026-11-01&to=2026-11-30&mode=drills')).days).toEqual([])
    expect(await json('GET', '/api/stats?from=2024-10-11&to=2027-10-16&mode=all')).toMatchObject({ allTimeStrokes: 3 }) // exactly 1,100 days
  })

  it('400s bad /api/stats parameters, with or without an archive, and 405s other methods', async () => {
    const bads = [
      '', 'from=2026-10-01', 'to=2026-10-31', 'from=2026-10-31&to=2026-10-01', 'from=2026-02-30&to=2026-03-01',
      'from=abc&to=2026-10-01', 'from=2024-10-10&to=2027-10-16', 'from=2000-01-01&to=2026-10-31',
      'from=2026-10-01&to=2026-10-31&mode=weird', 'from=2026-10-01&to=2026-10-31&mode=', 'from=2026-10-01&to=2026-10-31&mode=ALL',
    ]
    for (const q of bads) expect((await call('GET', `/api/stats?${q}`)).status, q).toBe(400)
    await seed(new Date(2026, 9, 27, 12).getTime())
    for (const q of bads) expect((await call('GET', `/api/stats?${q}`)).status, q).toBe(400)
    const res = await call('POST', '/api/stats?from=2026-10-01&to=2026-10-31')
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET')
  })

  it('answers /api/stats with the empty response and creates nothing when there is no database', async () => {
    expect(await json('GET', '/api/stats?from=2026-10-01&to=2026-10-31&mode=drills')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      mode: 'drills',
      days: [],
      keys: [],
      mixups: [],
      allTimeStrokes: 0,
    })
    expect((await json('GET', '/api/stats?from=2026-10-01&to=2026-10-31')).mode).toBe('free')
    expect(existsSync(dataDir)).toBe(false)
  })

  it('round-trips a journal entry through PUT, GET and the list', async () => {
    expect(await json('PUT', '/api/journal/2026-10-27', { text: 'first line' })).toEqual({ date: '2026-10-27', text: 'first line' })
    expect(await json('GET', '/api/journal/2026-10-27')).toEqual({ date: '2026-10-27', text: 'first line' })
    expect(await json('GET', '/api/journal')).toEqual([{ date: '2026-10-27', chars: 10 }])
    expect(readFileSync(join(dataDir, 'journal', '2026-10-27.md'), 'utf8')).toBe('first line')
    expect(await json('PUT', '/api/journal/2026-10-27', { text: '' })).toEqual({ date: '2026-10-27', text: '' })
    expect(await json('GET', '/api/journal')).toEqual([])
  })

  it('appends a stamped block and returns the full text', async () => {
    await json('PUT', '/api/journal/2026-10-27', { text: 'morning' })
    const out = await json('POST', '/api/journal/2026-10-27/append', { text: '  ## 14:05 stuck on the star keys  ' })
    expect(out).toEqual({ date: '2026-10-27', text: 'morning\n\n## 14:05 stuck on the star keys\n' })
    expect((await json('GET', '/api/journal/2026-10-27')).text).toBe(out.text)
    const fresh = await json('POST', '/api/journal/2026-10-28/append', { text: 'hello' })
    expect(fresh).toEqual({ date: '2026-10-28', text: 'hello\n' })
  })

  it('400s bad journal bodies and dates, and writes nothing for them', async () => {
    const long = 'x'.repeat(200001)
    const cases: [string, string, unknown][] = [
      ['PUT', '/api/journal/2026-10-27', { text: 5 }],
      ['PUT', '/api/journal/2026-10-27', {}],
      ['PUT', '/api/journal/2026-10-27', []],
      ['PUT', '/api/journal/2026-10-27', { text: long }],
      ['POST', '/api/journal/2026-10-27/append', { text: '' }],
      ['POST', '/api/journal/2026-10-27/append', { text: '  \n ' }],
      ['POST', '/api/journal/2026-10-27/append', { text: 5 }],
      ['POST', '/api/journal/2026-10-27/append', { text: long }],
      ['PUT', '/api/journal/2026-02-30', { text: 'x' }],
      ['PUT', '/api/journal/today', { text: 'x' }],
      ['POST', '/api/journal/2026-13-01/append', { text: 'x' }],
      ['GET', '/api/journal/2026-02-30', undefined],
      ['GET', '/api/journal/2026-1-1', undefined],
    ]
    for (const [method, path, body] of cases) {
      const res = await call(method, path, body)
      expect(res.status, `${method} ${path} ${JSON.stringify(body)?.slice(0, 40)}`).toBe(400)
      expect(typeof ((await res.json()) as { error: string }).error).toBe('string')
    }
    expect(existsSync(join(dataDir, 'journal'))).toBe(false)
    expect((await call('PUT', '/api/journal/2026-10-27', { text: 'x'.repeat(200000) })).status).toBe(200)
  })

  it('never serves or writes outside data/journal for traversal-looking dates', async () => {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'settings.json'), '{"boardVisibility":"hover"}')
    const targets = ['..%2Fsettings', '..%2Fsettings.json', '%2E%2E%2Fsettings', '..%5Csettings', '2026-10-27%2F..%2Fx']
    for (const t of targets) {
      for (const method of ['GET', 'PUT', 'POST']) {
        const path = method === 'POST' ? `/api/journal/${t}/append` : `/api/journal/${t}`
        const res = await call(method, path, method === 'GET' ? undefined : { text: 'pwned' })
        expect(res.status, `${method} ${path}`).toBeGreaterThanOrEqual(400)
        expect(res.status, `${method} ${path}`).toBeLessThan(500)
      }
    }
    expect(readdirSync(dataDir)).toEqual(['settings.json'])
    expect(readFileSync(join(dataDir, 'settings.json'), 'utf8')).toBe('{"boardVisibility":"hover"}')
    expect(readdirSync(dir).sort()).toEqual(['data'])
  })

  it('405s wrong journal methods with an Allow header', async () => {
    const cases: [string, string, string][] = [
      ['DELETE', '/api/journal/2026-10-27', 'GET, PUT'],
      ['POST', '/api/journal/2026-10-27', 'GET, PUT'],
      ['GET', '/api/journal/2026-10-27/append', 'POST'],
      ['PUT', '/api/journal/2026-10-27/append', 'POST'],
      ['POST', '/api/journal', 'GET'],
      ['PUT', '/api/journal', 'GET'],
    ]
    for (const [method, path, allowed] of cases) {
      const res = await call(method, path)
      expect(res.status, `${method} ${path}`).toBe(405)
      expect(res.headers.get('allow'), `${method} ${path}`).toBe(allowed)
    }
    expect(existsSync(dataDir)).toBe(false)
  })

  it('round-trips a note through PUT, GET and the list', async () => {
    expect(await json('PUT', '/api/notes/5', { text: 'héllo\r\nworld' })).toEqual({ chapter: 5, text: 'héllo\r\nworld' })
    expect(await json('GET', '/api/notes/5')).toEqual({ chapter: 5, text: 'héllo\r\nworld' })
    expect(await json('GET', '/api/notes')).toEqual([{ chapter: 5, chars: 12 }])
    expect(readFileSync(join(dataDir, 'notes', 'ch05.md'), 'utf8')).toBe('héllo\r\nworld')
    await json('PUT', '/api/notes/12', { text: 'b' })
    expect(await json('GET', '/api/notes')).toEqual([
      { chapter: 5, chars: 12 },
      { chapter: 12, chars: 1 },
    ])
    expect(await json('PUT', '/api/notes/5', { text: '' })).toEqual({ chapter: 5, text: '' })
    expect(await json('GET', '/api/notes/5')).toEqual({ chapter: 5, text: '' })
    expect(await json('GET', '/api/notes')).toEqual([{ chapter: 12, chars: 1 }])
  })

  it('accepts a leading zero in the chapter segment', async () => {
    expect(await json('PUT', '/api/notes/05', { text: 'five' })).toEqual({ chapter: 5, text: 'five' })
    expect(await json('GET', '/api/notes/5')).toEqual({ chapter: 5, text: 'five' })
    expect(await json('GET', '/api/notes/05')).toEqual({ chapter: 5, text: 'five' })
    expect(readdirSync(join(dataDir, 'notes'))).toEqual(['ch05.md'])
  })

  it('accepts text of exactly 200000 characters', async () => {
    expect((await call('PUT', '/api/notes/26', { text: 'x'.repeat(200000) })).status).toBe(200)
  })

  it('400s bad note bodies and chapters, and creates nothing for them', async () => {
    const long = 'x'.repeat(200001)
    const cases: [string, string, unknown][] = [
      ['PUT', '/api/notes/5', { text: 5 }],
      ['PUT', '/api/notes/5', { text: null }],
      ['PUT', '/api/notes/5', {}],
      ['PUT', '/api/notes/5', []],
      ['PUT', '/api/notes/5', { text: long }],
      ['PUT', '/api/notes/0', { text: 'x' }],
      ['PUT', '/api/notes/27', { text: 'x' }],
      ['PUT', '/api/notes/abc', { text: 'x' }],
      ['PUT', '/api/notes/05x', { text: 'x' }],
      ['PUT', '/api/notes/1e1', { text: 'x' }],
      ['PUT', '/api/notes/%35x', { text: 'x' }],
      ['PUT', '/api/notes/-1', { text: 'x' }],
      ['GET', '/api/notes/0', undefined],
      ['GET', '/api/notes/27', undefined],
      ['GET', '/api/notes/abc', undefined],
      ['GET', '/api/notes/05x', undefined],
      ['GET', '/api/notes/1e1', undefined],
      ['GET', '/api/notes/%35x', undefined],
    ]
    for (const [method, path, body] of cases) {
      const res = await call(method, path, body)
      expect(res.status, `${method} ${path} ${JSON.stringify(body)?.slice(0, 40)}`).toBe(400)
      expect(typeof ((await res.json()) as { error: string }).error).toBe('string')
    }
    expect(existsSync(dataDir)).toBe(false)
  })

  it('405s wrong note methods with an Allow header', async () => {
    const cases: [string, string, string][] = [
      ['DELETE', '/api/notes/5', 'GET, PUT'],
      ['POST', '/api/notes/5', 'GET, PUT'],
      ['POST', '/api/notes', 'GET'],
      ['PUT', '/api/notes', 'GET'],
      ['DELETE', '/api/notes', 'GET'],
    ]
    for (const [method, path, allowed] of cases) {
      const res = await call(method, path)
      expect(res.status, `${method} ${path}`).toBe(405)
      expect(res.headers.get('allow'), `${method} ${path}`).toBe(allowed)
    }
    expect(existsSync(dataDir)).toBe(false)
  })

  it('does not let the notes routes shadow the journal or tests routes', async () => {
    expect(await json('GET', '/api/journal')).toEqual([])
    expect(await json('GET', '/api/tests')).toEqual([])
    expect(await json('PUT', '/api/journal/2026-10-27', { text: 'j' })).toEqual({ date: '2026-10-27', text: 'j' })
    await json('PUT', '/api/notes/5', { text: 'n' })
    expect(await json('GET', '/api/journal')).toEqual([{ date: '2026-10-27', chars: 1 }])
    expect(await json('GET', '/api/notes')).toEqual([{ chapter: 5, chars: 1 }])
  })
})
