import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, listen } from '../../server/server.ts'
import {
  MAX_NAME_CHARS,
  MAX_TEXTS,
  deleteSavedText,
  isTextId,
  listTexts,
  readSavedText,
  writeSavedText,
} from '../../server/texts.ts'
import { MAX_TEXT_CHARS } from '../../src/core/realtext.ts'
import type { Server } from 'node:http'

let root: string
let dir: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lapwing-texts-'))
  dir = join(root, 'texts')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('isTextId', () => {
  it('accepts lower-case words with single dashes, up to 40 characters', () => {
    for (const id of ['a', 'frost-road', 'ch-5', '7', 'a'.repeat(40)]) expect(isTextId(id), id).toBe(true)
  })

  it('refuses everything else', () => {
    for (const id of ['../x', 'a/b', 'A', '-a', 'a-', 'a--b', '', 'a b', 'a.json', 'a\\b', 'é', 'a'.repeat(41)]) {
      expect(isTextId(id), id).toBe(false)
    }
  })
})

describe('invalid ids', () => {
  it('throw RangeError from every call before touching the filesystem', () => {
    for (const id of ['../x', 'a/b', '', 'A']) {
      expect(() => readSavedText(dir, id), id).toThrow(RangeError)
      expect(() => writeSavedText(dir, id, { name: 'n', text: 't' }), id).toThrow(RangeError)
      expect(() => deleteSavedText(dir, id), id).toThrow(RangeError)
    }
    expect(existsSync(dir)).toBe(false)
  })
})

describe('saved texts', () => {
  it('round-trips write, read, list and delete', () => {
    writeSavedText(dir, 'frost', { name: 'Frost', text: 'Two roads\r\ndiverged' })
    expect(readSavedText(dir, 'frost')).toEqual({ id: 'frost', name: 'Frost', text: 'Two roads\r\ndiverged' })
    expect(JSON.parse(readFileSync(join(dir, 'frost.json'), 'utf8'))).toEqual({
      name: 'Frost',
      text: 'Two roads\r\ndiverged',
    })
    expect(listTexts(dir)).toEqual([{ id: 'frost', name: 'Frost', chars: 19 }])
    writeSavedText(dir, 'frost', { name: 'Frost 2', text: 'x' })
    expect(readSavedText(dir, 'frost')).toEqual({ id: 'frost', name: 'Frost 2', text: 'x' })
    expect(deleteSavedText(dir, 'frost')).toBe(true)
    expect(readSavedText(dir, 'frost')).toBeNull()
    expect(listTexts(dir)).toEqual([])
    expect(deleteSavedText(dir, 'frost')).toBe(false)
    expect(readdirSync(dir)).toEqual([])
  })

  it('lists sorted by name and skips corrupt, misshapen and non-json files', () => {
    writeSavedText(dir, 'b', { name: 'beta', text: 'bb' })
    writeSavedText(dir, 'a', { name: 'Gamma', text: 'a' })
    writeSavedText(dir, 'c', { name: 'alpha', text: '' })
    writeFileSync(join(dir, 'bad.json'), '{not json')
    writeFileSync(join(dir, 'shape.json'), JSON.stringify({ name: 1, text: 'x' }))
    writeFileSync(join(dir, 'arr.json'), '[]')
    writeFileSync(join(dir, 'notes.txt'), '{"name":"n","text":"t"}')
    writeFileSync(join(dir, 'Bad Id.json'), '{"name":"n","text":"t"}')
    mkdirSync(join(dir, 'folder.json'))
    expect(listTexts(dir)).toEqual([
      { id: 'c', name: 'alpha', chars: 0 },
      { id: 'b', name: 'beta', chars: 2 },
      { id: 'a', name: 'Gamma', chars: 1 },
    ])
  })

  it('reads a missing id, a missing folder, and a corrupt file as null without creating anything', () => {
    expect(readSavedText(dir, 'nope')).toBeNull()
    expect(listTexts(dir)).toEqual([])
    expect(deleteSavedText(dir, 'nope')).toBe(false)
    expect(existsSync(dir)).toBe(false)
    mkdirSync(dir)
    writeFileSync(join(dir, 'bad.json'), 'nope')
    writeFileSync(join(dir, 'shape.json'), '{"name":"n"}')
    expect(readSavedText(dir, 'bad')).toBeNull()
    expect(readSavedText(dir, 'shape')).toBeNull()
  })

  it('exports the limits', () => {
    expect(MAX_TEXTS).toBe(50)
    expect(MAX_NAME_CHARS).toBe(60)
  })
})

describe('/api/texts', () => {
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

  beforeEach(async () => {
    dataDir = join(root, 'data')
    api = createServer({ root, dataDir })
    url = `http://127.0.0.1:${await listen(api, 0)}`
  })
  afterEach(async () => {
    await new Promise((ok) => api.close(ok))
  })

  it('answers [] on a fresh data dir without creating it', async () => {
    expect(await json('GET', '/api/texts')).toEqual([])
    expect((await call('GET', '/api/texts/frost')).status).toBe(404)
    expect((await call('DELETE', '/api/texts/frost')).status).toBe(404)
    expect(existsSync(dataDir)).toBe(false)
  })

  it('round-trips a text through PUT, GET, the list and DELETE', async () => {
    expect(await json('PUT', '/api/texts/frost', { name: '  Frost  ', text: 'Two roads' })).toEqual({
      id: 'frost',
      name: 'Frost',
      text: 'Two roads',
    })
    expect(await json('GET', '/api/texts/frost')).toEqual({ id: 'frost', name: 'Frost', text: 'Two roads' })
    expect(await json('GET', '/api/texts')).toEqual([{ id: 'frost', name: 'Frost', chars: 9 }])
    expect(JSON.parse(readFileSync(join(dataDir, 'texts', 'frost.json'), 'utf8'))).toEqual({
      name: 'Frost',
      text: 'Two roads',
    })
    expect(await json('DELETE', '/api/texts/frost')).toEqual({ ok: true })
    expect(await json('GET', '/api/texts')).toEqual([])
    expect((await call('GET', '/api/texts/frost')).status).toBe(404)
    expect((await call('DELETE', '/api/texts/frost')).status).toBe(404)
  })

  it('accepts a name of 60 characters and text of exactly MAX_TEXT_CHARS', async () => {
    expect((await call('PUT', '/api/texts/a', { name: 'n'.repeat(60), text: 'x'.repeat(MAX_TEXT_CHARS) })).status).toBe(
      200,
    )
  })

  it('400s a bad id for every method and touches no file', async () => {
    mkdirSync(join(dataDir, 'texts'), { recursive: true })
    writeFileSync(join(dataDir, 'x.json'), '{"name":"secret","text":"secret"}')
    const before = readdirSync(join(dataDir, 'texts'))
    for (const id of ['A', '-a', 'a--b', 'a.b', 'x'.repeat(41)]) {
      for (const method of ['GET', 'DELETE', 'PUT']) {
        const res = await call(method, `/api/texts/${id}`, method === 'PUT' ? { name: 'n', text: 't' } : undefined)
        expect(res.status, `${method} ${id}`).toBe(400)
      }
    }
    expect(readdirSync(join(dataDir, 'texts'))).toEqual(before)
    expect(readFileSync(join(dataDir, 'x.json'), 'utf8')).toBe('{"name":"secret","text":"secret"}')
  })

  it('never reaches the disk for an id with a slash or dot segment (no route matches)', async () => {
    mkdirSync(join(dataDir, 'texts'), { recursive: true })
    writeFileSync(join(dataDir, 'x.json'), '{"name":"secret","text":"secret"}')
    for (const id of ['a%2Fb', 'a%5Cb', 'a%00', '..%2Fx', '%2e%2e%2fx']) {
      for (const method of ['GET', 'DELETE', 'PUT']) {
        const res = await call(method, `/api/texts/${id}`, method === 'PUT' ? { name: 'n', text: 't' } : undefined)
        expect(res.status, `${method} ${id}`).toBe(404)
      }
    }
    expect(readdirSync(join(dataDir, 'texts'))).toEqual([])
    expect(readFileSync(join(dataDir, 'x.json'), 'utf8')).toBe('{"name":"secret","text":"secret"}')
  })

  it('answers a raw dot-segment id without touching the disk', async () => {
    const { port } = new URL(url)
    for (const method of ['GET', 'DELETE']) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path: '/api/texts/%2e%2e', method }, (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        })
        req.on('error', reject)
        req.end()
      })
      expect(status, method).toBe(404)
    }
    expect(existsSync(dataDir)).toBe(false)
  })

  it('400s a bad id without creating the data folder', async () => {
    expect((await call('GET', '/api/texts/A')).status).toBe(400)
    expect((await call('DELETE', '/api/texts/A')).status).toBe(400)
    expect((await call('PUT', '/api/texts/A', { name: 'n', text: 't' })).status).toBe(400)
    expect(existsSync(dataDir)).toBe(false)
  })

  it('400s bad bodies and creates nothing for them', async () => {
    const ok = 'fine'
    const cases: unknown[] = [
      { text: ok },
      { name: '', text: ok },
      { name: '   ', text: ok },
      { name: 'n'.repeat(61), text: ok },
      { name: 5, text: ok },
      { name: null, text: ok },
      { name: ok },
      { name: ok, text: 5 },
      { name: ok, text: null },
      { name: ok, text: 'x'.repeat(MAX_TEXT_CHARS + 1) },
      [],
    ]
    for (const body of cases) {
      const res = await call('PUT', '/api/texts/a', body)
      expect(res.status, JSON.stringify(body)?.slice(0, 60)).toBe(400)
      expect(typeof ((await res.json()) as { error: string }).error).toBe('string')
    }
    expect(existsSync(dataDir)).toBe(false)
  })

  it('refuses the 51st distinct id but allows overwriting at the limit', async () => {
    for (let i = 1; i <= MAX_TEXTS; i++) await json('PUT', `/api/texts/t${i}`, { name: `Text ${i}`, text: 'x' })
    expect((await call('PUT', '/api/texts/extra', { name: 'Extra', text: 'x' })).status).toBe(400)
    expect(existsSync(join(dataDir, 'texts', 'extra.json'))).toBe(false)
    expect((await call('PUT', '/api/texts/t7', { name: 'Seven', text: 'y' })).status).toBe(200)
    expect(await json('GET', '/api/texts/t7')).toEqual({ id: 't7', name: 'Seven', text: 'y' })
    expect(await json('GET', '/api/texts')).toHaveLength(MAX_TEXTS)
    await json('DELETE', '/api/texts/t1')
    expect((await call('PUT', '/api/texts/extra', { name: 'Extra', text: 'x' })).status).toBe(200)
  })

  it('answers a corrupt file as 404 and skips it in the list', async () => {
    mkdirSync(join(dataDir, 'texts'), { recursive: true })
    writeFileSync(join(dataDir, 'texts', 'bad.json'), '{oops')
    await json('PUT', '/api/texts/good', { name: 'Good', text: 'x' })
    expect((await call('GET', '/api/texts/bad')).status).toBe(404)
    expect(await json('GET', '/api/texts')).toEqual([{ id: 'good', name: 'Good', chars: 1 }])
  })

  it('405s wrong methods with an Allow header', async () => {
    const cases: [string, string, string][] = [
      ['POST', '/api/texts', 'GET'],
      ['PUT', '/api/texts', 'GET'],
      ['DELETE', '/api/texts', 'GET'],
      ['POST', '/api/texts/a', 'GET, PUT, DELETE'],
      ['PATCH', '/api/texts/a', 'GET, PUT, DELETE'],
    ]
    for (const [method, path, allowed] of cases) {
      const res = await call(method, path)
      expect(res.status, `${method} ${path}`).toBe(405)
      expect(res.headers.get('allow'), `${method} ${path}`).toBe(allowed)
    }
    expect(existsSync(dataDir)).toBe(false)
  })
})
