import { describe, expect, it } from 'vitest'
import { checkRequest } from '../../server/guard.ts'

const PORT = 5757

// A request as the guard sees it: the parsed headers, the raw header list and the port it arrived on.
function req(headers: Record<string, string | undefined>, rawHeaders?: string[], localPort: number | null = PORT) {
  const lowered: Record<string, string> = {}
  const raw: string[] = []
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    lowered[name.toLowerCase()] = value
    raw.push(name, value)
  }
  return { headers: lowered, rawHeaders: rawHeaders ?? raw, socket: { localPort: localPort ?? undefined } }
}

describe('checkRequest host', () => {
  it.each(['127.0.0.1:5757', 'localhost:5757', '[::1]:5757', 'LOCALHOST:5757', 'LocalHost:5757'])('allows Host %s', (host) => {
    expect(checkRequest(req({ Host: host }))).toEqual({ ok: true })
  })

  it.each([
    'evil.example:5757',
    'evil.example',
    '127.0.0.1',
    'localhost',
    '127.0.0.1:1',
    'localhost:5173',
    '127.0.0.1.evil.example:5757',
    'localhost.evil.example:5757',
    'evil.example/127.0.0.1:5757',
    'evil.example#127.0.0.1:5757',
    'user@127.0.0.1:5757',
    '127.0.0.1:5757@evil.example',
    '127.0.0.1:5757.evil.example',
    '127.0.0.1:05757',
    '127.0.0.1:5757 ',
    'localhost.:5757',
    '127.0.0.1:5757, evil.example',
    '127.0.0.1:5757,127.0.0.1:5757',
    '0.0.0.0:5757',
    '[::1]',
    '[::2]:5757',
    '',
  ])('refuses Host %j', (host) => {
    expect(checkRequest(req({ Host: host }))).toEqual({ ok: false, reason: 'host' })
  })

  it('refuses a missing Host', () => {
    expect(checkRequest(req({}))).toEqual({ ok: false, reason: 'host' })
  })

  it('refuses a duplicated Host header even when the first one is good', () => {
    const r = req({ Host: '127.0.0.1:5757' }, ['Host', '127.0.0.1:5757', 'host', 'evil.example'])
    expect(checkRequest(r)).toEqual({ ok: false, reason: 'host' })
  })

  it('follows the port the request arrived on, not a fixed one', () => {
    expect(checkRequest(req({ Host: '127.0.0.1:41234' }, undefined, 41234))).toEqual({ ok: true })
    expect(checkRequest(req({ Host: '127.0.0.1:5757' }, undefined, 41234))).toEqual({ ok: false, reason: 'host' })
  })

  it('refuses everything when the local port is unknown', () => {
    expect(checkRequest(req({ Host: '127.0.0.1:5757' }, undefined, null))).toEqual({ ok: false, reason: 'host' })
  })
})

describe('checkRequest origin', () => {
  const host = '127.0.0.1:5757'

  it('allows a request without Origin', () => {
    expect(checkRequest(req({ Host: host }))).toEqual({ ok: true })
  })

  it.each(['http://127.0.0.1:5757', 'http://localhost:5757', 'http://[::1]:5757', 'http://LOCALHOST:5757'])(
    'allows Origin %s',
    (origin) => {
      expect(checkRequest(req({ Host: host, Origin: origin }))).toEqual({ ok: true })
    },
  )

  it.each([
    'https://evil.example',
    'http://evil.example',
    'http://evil.example:5757',
    'null',
    '',
    'http://127.0.0.1:1',
    'http://127.0.0.1',
    'http://localhost.evil.example:5757',
    'http://127.0.0.1.evil.example:5757',
    'http://127.0.0.1:5757.evil.example',
    'http://localhost:5173',
    'https://127.0.0.1:5757',
    'http://127.0.0.1:5757/',
    'http://127.0.0.1:5757, http://evil.example',
    'http://user@127.0.0.1:5757',
    '127.0.0.1:5757',
  ])('refuses Origin %j', (origin) => {
    expect(checkRequest(req({ Host: host, Origin: origin }))).toEqual({ ok: false, reason: 'origin' })
  })

  it('refuses a duplicated Origin header even when the first one is good', () => {
    const r = req({ Host: host, Origin: 'http://127.0.0.1:5757' }, [
      'Host',
      host,
      'Origin',
      'http://127.0.0.1:5757',
      'origin',
      'http://evil.example',
    ])
    expect(checkRequest(r)).toEqual({ ok: false, reason: 'origin' })
  })

  it('reports the host first when both are wrong', () => {
    expect(checkRequest(req({ Host: 'evil.example', Origin: 'http://evil.example' }))).toEqual({
      ok: false,
      reason: 'host',
    })
  })
})
