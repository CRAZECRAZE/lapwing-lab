import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

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
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res)
  return true
}

// Single dispatch point for /api/*. Task 14 adds the settings and test routes here.
async function handleApi(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _opts: ServerOptions,
): Promise<void> {
  if (pathname === '/api/health') {
    send(res, 200, 'application/json; charset=utf-8', '{"ok":true}')
    return
  }
  notFound(res)
}

export function createServer(opts: ServerOptions): Server {
  const root = resolve(opts.root)
  const contentRoot = join(root, 'content', 'build')
  const mediaRoot = join(root, 'content', 'lapwing-book', 'src', 'img')
  const distRoot = join(root, 'dist')

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD')
      send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed')
      return
    }

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

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, opts)
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

  return createHttpServer((req, res) => {
    handle(req, res).catch(() => {
      if (res.headersSent) res.destroy()
      else send(res, 500, 'text/plain; charset=utf-8', 'Internal error')
    })
  })
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
