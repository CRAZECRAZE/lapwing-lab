import { createReadStream, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream'
import { LEVERS } from '../src/core/uni.ts'
import type { Lever } from '../src/core/uni.ts'
import { MissingRowError, openArchive } from './archive.ts'
import type { Archive } from './archive.ts'
import { readSettings, writeSettings } from './settings.ts'

export interface ServerOptions {
  root: string
  dataDir: string
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function send(res: ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function notFound(res: ServerResponse) {
  send(res, 404, 'text/plain; charset=utf-8', 'Not found')
}

// Join `rel` onto `base` and return the absolute path only if it stays inside
// `base`. The check includes the separator so `/x/build` never matches `/x/buildx`.
function resolveInside(base: string, rel: string): string | null {
  const target = resolve(base, '.' + sep + rel)
  return target === base || target.startsWith(base + sep) ? target : null
}

async function sendFile(req: IncomingMessage, res: ServerResponse, file: string): Promise<boolean> {
  let info
  try {
    info = await stat(file)
  } catch {
    return false
  }
  if (!info.isFile()) return false
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': info.size,
  })
  if (req.method === 'HEAD') {
    res.end()
    return true
  }
  // pipeline destroys the file stream if the client goes away mid-download.
  pipeline(createReadStream(file), res, () => {})
  return true
}

const JSON_TYPE = 'application/json; charset=utf-8'
const MAX_BODY_BYTES = 1024 * 1024

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown) {
  send(res, status, JSON_TYPE, JSON.stringify(value))
}

// Reads a JSON body of at most MAX_BODY_BYTES. Past the limit it stops collecting
// and answers 413 with Connection: close so the socket is torn down after the reply.
function readBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const tooBig = () => {
      res.setHeader('connection', 'close')
      reject(new HttpError(413, 'Request body too large'))
    }
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
      tooBig()
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    req.on('data', (chunk: Buffer) => {
      if (done) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        done = true
        chunks.length = 0
        tooBig()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (done) return
      done = true
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError(400, 'Body must be valid JSON'))
      }
    })
    req.on('error', (err) => {
      if (done) return
      done = true
      reject(err)
    })
  })
}

type Fields = Record<string, unknown>

function asObject(value: unknown): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'Body must be a JSON object')
  }
  return value as Fields
}

function bad(name: string, what: string): never {
  throw new HttpError(400, `"${name}" must be ${what}`)
}

function int(o: Fields, name: string): number {
  const v = o[name]
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : bad(name, 'a non-negative integer')
}

// A duration or rate: finite, non-negative, small enough to round-trip through SQLite.
function measure(o: Fields, name: string, max = Number.MAX_SAFE_INTEGER): number {
  const v = o[name]
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
    ? v
    : bad(name, `a number between 0 and ${max}`)
}

function positiveInt(o: Fields, name: string): number {
  const v = o[name]
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : bad(name, 'an integer >= 1')
}

function str(o: Fields, name: string): string {
  const v = o[name]
  return typeof v === 'string' && v !== '' ? v : bad(name, 'a non-empty string')
}

function nullable<T>(o: Fields, name: string, read: (o: Fields, name: string) => T): T | null {
  return o[name] === null || o[name] === undefined ? null : read(o, name)
}

function bool(o: Fields, name: string): boolean {
  const v = o[name]
  return typeof v === 'boolean' ? v : bad(name, 'a boolean')
}

function strings(o: Fields, name: string): string[] {
  const v = o[name]
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : bad(name, 'an array of strings')
}

function levers(o: Fields, name: string): Lever[] {
  const known: readonly string[] = LEVERS
  const v = strings(o, name)
  return v.every((x) => known.includes(x)) ? (v as Lever[]) : bad(name, 'an array of known levers')
}

function allow(res: ServerResponse, ...methods: string[]): never {
  res.setHeader('allow', methods.join(', '))
  throw new HttpError(405, 'Method not allowed')
}

interface ApiContext {
  archive(): Archive
  settingsFile: string
  ensureDataDir(): void
}

// Single dispatch point for /api/*. Handlers throw HttpError; anything else is a
// 500 whose details stay on the server.
async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, ctx: ApiContext) {
  try {
    await route(req, res, pathname, ctx)
  } catch (err) {
    if (res.headersSent) {
      res.destroy()
    } else if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message })
    } else if (err instanceof RangeError) {
      sendJson(res, 400, { error: err.message })
    } else if (err instanceof MissingRowError) {
      sendJson(res, 404, { error: err.message })
    } else {
      sendJson(res, 500, { error: 'Internal error' })
    }
  }
}

async function route(req: IncomingMessage, res: ServerResponse, pathname: string, ctx: ApiContext) {
  const method = req.method ?? 'GET'

  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (pathname === '/api/settings') {
    if (method === 'GET') {
      sendJson(res, 200, readSettings(ctx.settingsFile))
      return
    }
    if (method !== 'PUT') allow(res, 'GET', 'PUT')
    const body = asObject(await readBody(req, res))
    const vis = body.boardVisibility
    if (vis !== undefined && vis !== 'always' && vis !== 'hover' && vis !== 'hidden') {
      bad('boardVisibility', 'one of always, hover, hidden')
    }
    ctx.ensureDataDir()
    sendJson(res, 200, writeSettings(ctx.settingsFile, vis === undefined ? {} : { boardVisibility: vis }))
    return
  }

  if (pathname === '/api/sessions') {
    if (method !== 'POST') allow(res, 'POST')
    const body = asObject(await readBody(req, res))
    const startedAt = int(body, 'startedAt')
    sendJson(res, 200, { id: ctx.archive().createSession(startedAt) })
    return
  }

  if (pathname === '/api/tests') {
    if (method !== 'POST') allow(res, 'POST')
    const body = asObject(await readBody(req, res))
    const test = {
      sessionId: int(body, 'sessionId'),
      startedAt: int(body, 'startedAt'),
      mode: str(body, 'mode'),
      chapter: nullable(body, 'chapter', int),
      section: nullable(body, 'section', str),
      itemCount: int(body, 'itemCount'),
    }
    sendJson(res, 200, { id: ctx.archive().startTest(test) })
    return
  }

  // Must stay ahead of the /api/tests/:id/... pattern below.
  if (pathname === '/api/tests/last') {
    if (method !== 'GET') allow(res, 'GET')
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams
    const mode = params.get('mode')
    const section = params.get('section')
    if (!mode || !section) throw new HttpError(400, '"mode" and "section" query parameters are required')
    sendJson(res, 200, ctx.archive().lastTest(mode, section) ?? null)
    return
  }

  const match = /^\/api\/tests\/(\d+)\/(strokes|finish)$/.exec(pathname)
  if (match) {
    if (method !== 'POST') allow(res, 'POST')
    const testId = Number(match[1])
    if (!Number.isSafeInteger(testId)) throw new HttpError(404, 'No such test')
    const body = asObject(await readBody(req, res))
    if (match[2] === 'strokes') {
      ctx.archive().addStroke({
        testId,
        tsMs: int(body, 'tsMs'),
        prompt: str(body, 'prompt'),
        expected: strings(body, 'expected'),
        pressedLevers: levers(body, 'pressedLevers'),
        pressedMask: int(body, 'pressedMask'),
        correct: bool(body, 'correct'),
        latencyMs: measure(body, 'latencyMs'),
        attemptNo: positiveInt(body, 'attemptNo'),
      })
    } else {
      ctx.archive().finishTest(testId, {
        endedAt: int(body, 'endedAt'),
        wpm: measure(body, 'wpm'),
        accuracy: measure(body, 'accuracy', 1),
        meta: body.meta ?? null,
      })
    }
    sendJson(res, 200, { ok: true })
    return
  }

  throw new HttpError(404, 'Not found')
}

export function createServer(opts: ServerOptions): Server {
  const root = resolve(opts.root)
  const contentRoot = join(root, 'content', 'build')
  const mediaRoot = join(root, 'content', 'lapwing-book', 'src', 'img')
  const distRoot = join(root, 'dist')
  const dataDir = resolve(opts.dataDir)

  // data/ and steno.db appear only when something is first saved.
  let archive: Archive | undefined
  const ctx: ApiContext = {
    settingsFile: join(dataDir, 'settings.json'),
    ensureDataDir: () => {
      mkdirSync(dataDir, { recursive: true })
    },
    archive: () => {
      if (!archive) {
        mkdirSync(dataDir, { recursive: true })
        archive = openArchive(join(dataDir, 'steno.db'))
      }
      return archive
    },
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    // Decode exactly once. Anything that still looks like a traversal afterwards
    // (backslash, NUL, ..) is caught by the containment check or rejected here.
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      notFound(res)
      return
    }
    if (pathname.includes('\0') || pathname.includes('\\')) {
      notFound(res)
      return
    }

    // API routes own their methods; the GET/HEAD restriction is for static files only.
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, ctx)
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD')
      send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed')
      return
    }

    const mounts: [string, string][] = [
      ['/content/', contentRoot],
      ['/media/', mediaRoot],
    ]
    for (const [prefix, dir] of mounts) {
      if (pathname.startsWith(prefix)) {
        const file = resolveInside(dir, pathname.slice(prefix.length))
        if (file && (await sendFile(req, res, file))) return
        notFound(res)
        return
      }
    }
    if (pathname === '/content' || pathname === '/media') {
      notFound(res)
      return
    }

    const file = resolveInside(distRoot, pathname === '/' ? 'index.html' : pathname)
    if (!file) {
      notFound(res)
      return
    }
    if (await sendFile(req, res, file)) return
    // Client-side routes have no extension; real missing files stay 404.
    if (extname(pathname) === '' && (await sendFile(req, res, join(distRoot, 'index.html')))) return
    notFound(res)
  }

  const server = createHttpServer((req, res) => {
    handle(req, res).catch(() => {
      if (res.headersSent) res.destroy()
      else send(res, 500, 'text/plain; charset=utf-8', 'Internal error')
    })
  })
  server.on('close', () => {
    archive?.close()
    archive = undefined
  })
  return server
}

export function listen(server: Server, port: number, host = '127.0.0.1'): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is in use. Set PORT=<other> and retry.`, { cause: err })
          : err,
      )
    }
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      const address = server.address()
      resolvePort(typeof address === 'object' && address ? address.port : port)
    })
  })
}

// PORT env value -> port number. Unset or empty means the default.
export function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 5757
  const port = Number(raw)
  if (!/^\d+$/.test(raw) || port > 65535) {
    throw new Error(`Invalid PORT "${raw}". Use a number between 0 and 65535.`)
  }
  return port
}
