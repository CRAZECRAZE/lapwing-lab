import type { IncomingMessage } from 'node:http'

export type GuardResult = { ok: true } | { ok: false; reason: 'host' | 'origin' }

// What the guard reads from a request; an IncomingMessage satisfies it.
type GuardRequest = Pick<IncomingMessage, 'headers' | 'rawHeaders'> & { socket: { localPort?: number } }

// The only names the app is reached by. The server binds 127.0.0.1, but a browser may use any of these.
const HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]']

// How many times a header appears on the wire. Node keeps only the first Host and joins the others,
// so a repeated header has to be spotted in the raw list.
function occurrences(rawHeaders: readonly string[], name: string): number {
  let n = 0
  for (let i = 0; i < rawHeaders.length; i += 2) if (rawHeaders[i].toLowerCase() === name) n++
  return n
}

// Exact comparison against a fixed list, lower-cased: no parsing, so a lookalike such as
// 127.0.0.1.evil.example, another port, a userinfo part or a comma list can never match.
function matches(value: string, prefix: string, port: number): boolean {
  const lower = value.toLowerCase()
  return HOSTNAMES.some((name) => lower === `${prefix}${name}:${port}`)
}

// Refuses requests that did not come from a page served by this server itself: the Host must name this
// server and its own port (DNS rebinding), and an Origin, when present, must be this server too (cross-site writes).
export function checkRequest(req: GuardRequest): GuardResult {
  const port = req.socket.localPort
  const host = req.headers.host
  if (port === undefined || host === undefined || occurrences(req.rawHeaders, 'host') !== 1 || !matches(host, '', port)) {
    return { ok: false, reason: 'host' }
  }
  const origin = req.headers.origin
  if (origin === undefined && occurrences(req.rawHeaders, 'origin') === 0) return { ok: true }
  if (origin === undefined || occurrences(req.rawHeaders, 'origin') !== 1 || !matches(origin, 'http://', port)) {
    return { ok: false, reason: 'origin' }
  }
  return { ok: true }
}
