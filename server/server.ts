import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream'
import { LEVERS } from '../src/core/uni.ts'
import type { Lever } from '../src/core/uni.ts'
import { MissingRowError, openArchive } from './archive.ts'
import type { Archive } from './archive.ts'
import { appendEntry, isJournalDate, listEntries, readEntry, writeEntry } from './journal.ts'
import { isNoteChapter, listNotes, readNote, writeNote } from './notes.ts'
import { readSettings, writeSettings } from './settings.ts'
import { buildStats, emptyStats, STATS_MODES } from './stats.ts'
import type { StatsMode } from './stats.ts'

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
  '.pdf': 'application/pdf',
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
const MAX_JOURNAL_CHARS = 200000
// The longest from..to span /api/days and /api/stats answer (the all-time view reaches 1,100 days back).
const MAX_DAYS_SPAN = 1100
const MS_PER_DAY = 86400000

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

// A journal body: a string of at most MAX_JOURNAL_CHARS; blank is allowed only when asked for.
function journalText(o: Fields, allowBlank: boolean): string {
  const v = o.text
  if (typeof v !== 'string') return bad('text', 'a string')
  if (v.length > MAX_JOURNAL_CHARS) return bad('text', `at most ${MAX_JOURNAL_CHARS} characters`)
  return allowBlank || v.trim() !== '' ? v : bad('text', 'not blank')
}

// A YYYY-MM-DD that names a real day; it ends up in a file name, so nothing else passes.
function journalDate(value: string | null, name: string): string {
  return value !== null && isJournalDate(value) ? value : bad(name, 'a date as YYYY-MM-DD')
}

// An optional query integer: absent -> undefined; otherwise digits only and within [min, max].
function queryInt(params: URLSearchParams, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const raw = params.get(name)
  if (raw === null) return undefined
  const v = Number(raw)
  return /^\d+$/.test(raw) && Number.isSafeInteger(v) && v >= min && v <= max
    ? v
    : bad(name, `an integer between ${min} and ${max === Number.MAX_SAFE_INTEGER ? 'the safe maximum' : max}`)
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(2000, m - 1, d))
  t.setUTCFullYear(y)
  return t.getTime() / MS_PER_DAY
}

// A chapter number from a path segment: digits only, 1-99.
function chapterParam(raw: string): number {
  const v = Number(raw)
  return /^\d+$/.test(raw) && v >= 1 && v <= 99 ? v : bad('chapter', 'an integer between 1 and 99')
}

// A note chapter from a path segment: digits only (05 is chapter 5) and 1-26.
function noteChapter(raw: string): number {
  const v = Number(raw)
  return /^\d+$/.test(raw) && isNoteChapter(v) ? v : bad('chapter', 'an integer between 1 and 26')
}

const RESULT_MODES = ['stage0', 'section', 'chapter-test']

function allow(res: ServerResponse, ...methods: string[]): never {
  res.setHeader('allow', methods.join(', '))
  throw new HttpError(405, 'Method not allowed')
}

interface ApiContext {
  archive(): Archive
  /** The archive if it is open or its file already exists; null when nothing was ever saved (never creates it). */
  existingArchive(): Archive | null
  settingsFile: string
  journalDir: string
  notesDir: string
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
    const hints = body.hints
    if (hints !== undefined && hints !== 'miss' && hints !== 'always') bad('hints', 'one of miss, always')
    ctx.ensureDataDir()
    sendJson(
      res,
      200,
      writeSettings(ctx.settingsFile, {
        ...(vis === undefined ? {} : { boardVisibility: vis }),
        ...(hints === undefined ? {} : { hints }),
      }),
    )
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
    if (method === 'GET') {
      const params = new URL(req.url ?? '/', 'http://localhost').searchParams
      const limit = queryInt(params, 'limit', 1, 200) ?? 50
      const beforeId = queryInt(params, 'beforeId', 0)
      const rawDate = params.get('date')
      const date = rawDate === null ? undefined : journalDate(rawDate, 'date')
      sendJson(res, 200, ctx.existingArchive()?.listTests({ limit, beforeId, date }) ?? [])
      return
    }
    if (method !== 'POST') allow(res, 'GET', 'POST')
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
    sendJson(res, 200, ctx.existingArchive()?.lastTest(mode, section) ?? null)
    return
  }

  const one = /^\/api\/tests\/(\d+)$/.exec(pathname)
  if (one) {
    if (method !== 'GET') allow(res, 'GET')
    const testId = Number(one[1])
    const found = Number.isSafeInteger(testId) ? ctx.existingArchive()?.getTest(testId) : undefined
    if (!found) throw new HttpError(404, 'No such test')
    sendJson(res, 200, found)
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

  if (pathname === '/api/results') {
    if (method !== 'GET') allow(res, 'GET')
    const mode = new URL(req.url ?? '/', 'http://localhost').searchParams.get('mode')
    if (mode === null || !RESULT_MODES.includes(mode)) bad('mode', `one of ${RESULT_MODES.join(', ')}`)
    sendJson(res, 200, ctx.existingArchive()?.sectionResults(mode) ?? [])
    return
  }

  if (pathname === '/api/progress') {
    if (method !== 'GET') allow(res, 'GET')
    sendJson(res, 200, ctx.existingArchive()?.listMarks() ?? [])
    return
  }

  // Any single segment lands here so a non-numeric chapter answers 400, not 404.
  const progress = /^\/api\/progress\/([^/]+)$/.exec(pathname)
  if (progress) {
    if (method !== 'PUT' && method !== 'DELETE') allow(res, 'PUT', 'DELETE')
    const chapter = chapterParam(progress[1])
    if (method === 'DELETE') {
      ctx.existingArchive()?.clearMark(chapter)
      sendJson(res, 200, { ok: true })
      return
    }
    const kind = asObject(await readBody(req, res)).kind
    if (kind !== 'read' && kind !== 'override') bad('kind', 'one of read, override')
    const at = Date.now()
    ctx.archive().setMark(chapter, kind, at)
    sendJson(res, 200, { chapter, kind, at })
    return
  }

  if (pathname === '/api/days') {
    if (method !== 'GET') allow(res, 'GET')
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams
    const from = journalDate(params.get('from'), 'from')
    const to = journalDate(params.get('to'), 'to')
    const span = dayNumber(to) - dayNumber(from)
    if (span < 0) throw new HttpError(400, '"from" must not be after "to"')
    if (span > MAX_DAYS_SPAN) throw new HttpError(400, `"from" and "to" must be at most ${MAX_DAYS_SPAN} days apart`)
    sendJson(res, 200, ctx.existingArchive()?.dayStats(from, to) ?? [])
    return
  }

  if (pathname === '/api/stats') {
    if (method !== 'GET') allow(res, 'GET')
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams
    const from = journalDate(params.get('from'), 'from')
    const to = journalDate(params.get('to'), 'to')
    const rawMode = params.get('mode') ?? 'free'
    const mode = (STATS_MODES as readonly string[]).includes(rawMode) ? (rawMode as StatsMode) : bad('mode', 'one of free, drills, all')
    const span = dayNumber(to) - dayNumber(from)
    if (span < 0) throw new HttpError(400, '"from" must not be after "to"')
    if (span > MAX_DAYS_SPAN) throw new HttpError(400, `"from" and "to" must be at most ${MAX_DAYS_SPAN} days apart`)
    const archive = ctx.existingArchive()
    sendJson(res, 200, archive ? buildStats(archive, { from, to, mode }) : emptyStats({ from, to, mode }))
    return
  }

  if (pathname === '/api/journal') {
    if (method !== 'GET') allow(res, 'GET')
    sendJson(res, 200, listEntries(ctx.journalDir))
    return
  }

  // The date segment excludes '/', so a decoded ../x never reaches the filesystem; it is also
  // validated by isJournalDate before use.
  const entry = /^\/api\/journal\/([^/]+)(\/append)?$/.exec(pathname)
  if (entry) {
    const append = entry[2] !== undefined
    if (append && method !== 'POST') allow(res, 'POST')
    if (!append && method !== 'GET' && method !== 'PUT') allow(res, 'GET', 'PUT')
    const date = journalDate(entry[1], 'date')
    if (method === 'GET') {
      sendJson(res, 200, { date, text: readEntry(ctx.journalDir, date) })
      return
    }
    const body = asObject(await readBody(req, res))
    const text = journalText(body, !append)
    if (append) {
      sendJson(res, 200, { date, text: appendEntry(ctx.journalDir, date, text) })
    } else {
      writeEntry(ctx.journalDir, date, text)
      sendJson(res, 200, { date, text })
    }
    return
  }

  if (pathname === '/api/notes') {
    if (method !== 'GET') allow(res, 'GET')
    sendJson(res, 200, listNotes(ctx.notesDir))
    return
  }

  // The chapter segment excludes '/', and noteChapter admits only digits in 1-26 before any file access.
  const note = /^\/api\/notes\/([^/]+)$/.exec(pathname)
  if (note) {
    if (method !== 'GET' && method !== 'PUT') allow(res, 'GET', 'PUT')
    const chapter = noteChapter(note[1])
    if (method === 'GET') {
      sendJson(res, 200, { chapter, text: readNote(ctx.notesDir, chapter) })
      return
    }
    const text = journalText(asObject(await readBody(req, res)), true)
    writeNote(ctx.notesDir, chapter, text)
    sendJson(res, 200, { chapter, text })
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
    journalDir: join(dataDir, 'journal'),
    notesDir: join(dataDir, 'notes'),
    ensureDataDir: () => {
      mkdirSync(dataDir, { recursive: true })
    },
    existingArchive: () => (archive || existsSync(join(dataDir, 'steno.db')) ? ctx.archive() : null),
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
