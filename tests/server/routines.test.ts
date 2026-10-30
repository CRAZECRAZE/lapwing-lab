import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRoutines, writeRoutines } from '../../server/routines.ts'
import { createServer, listen } from '../../server/server.ts'
import { EMPTY_ROUTINES } from '../../src/core/routine.ts'
import type { RoutineDoc } from '../../src/core/routine.ts'
import type { Server } from 'node:http'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lapwing-routines-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const DOC: RoutineDoc = {
  routines: [
    {
      id: 'morning',
      name: 'Morning',
      steps: [
        { kind: 'list', listId: '12-numbers' },
        { kind: 'fixup', tab: 'words' },
      ],
    },
  ],
  active: 'morning',
}

describe('readRoutines / writeRoutines', () => {
  it('reads a missing file as no routines and creates nothing', () => {
    const file = join(root, 'data', 'routines.json')
    expect(readRoutines(file)).toEqual(EMPTY_ROUTINES)
    expect(existsSync(join(root, 'data'))).toBe(false)
  })

  it('reads a corrupt file, a non-object and a doc that fails validation as no routines', () => {
    const file = join(root, 'routines.json')
    for (const text of ['{oops', '[]', 'null', '{"routines":[{"id":"A","name":"x","steps":[]}],"active":null}', '']) {
      writeFileSync(file, text)
      expect(readRoutines(file), text).toEqual(EMPTY_ROUTINES)
    }
  })

  it('returns a fresh empty doc each time', () => {
    const a = readRoutines(join(root, 'none.json'))
    a.routines.push({ id: 'x', name: 'x', steps: [] })
    expect(readRoutines(join(root, 'none.json'))).toEqual(EMPTY_ROUTINES)
    expect(EMPTY_ROUTINES.routines).toEqual([])
  })

  it('writes atomically, creating the folder, and reads it back', () => {
    const file = join(root, 'data', 'routines.json')
    writeRoutines(file, DOC)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(DOC)
    expect(readRoutines(file)).toEqual(DOC)
  })
})

describe('/api/routines', () => {
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

  it('answers the empty doc on a fresh data dir without creating it', async () => {
    expect(await json('GET', '/api/routines')).toEqual({ routines: [], active: null })
    expect(existsSync(dataDir)).toBe(false)
  })

  it('answers the empty doc for a corrupt or invalid file', async () => {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'routines.json'), '{oops')
    expect(await json('GET', '/api/routines')).toEqual({ routines: [], active: null })
    writeFileSync(join(dataDir, 'routines.json'), '{"routines":[],"active":"ghost"}')
    expect(await json('GET', '/api/routines')).toEqual({ routines: [], active: null })
  })

  it('round-trips a doc through PUT and GET', async () => {
    expect(await json('PUT', '/api/routines', DOC)).toEqual(DOC)
    expect(await json('GET', '/api/routines')).toEqual(DOC)
    expect(JSON.parse(readFileSync(join(dataDir, 'routines.json'), 'utf8'))).toEqual(DOC)
  })

  it('saves the cleaned doc: names trimmed, extra fields dropped', async () => {
    const saved = await json('PUT', '/api/routines', {
      routines: [{ id: 'a', name: '  Warm up  ', extra: 1, steps: [{ kind: 'fixup', tab: 'words', junk: true }] }],
      active: null,
      more: 2,
    })
    expect(saved).toEqual({ routines: [{ id: 'a', name: 'Warm up', steps: [{ kind: 'fixup', tab: 'words' }] }], active: null })
    expect(await json('GET', '/api/routines')).toEqual(saved)
  })

  it('400s an invalid doc with the validator message and leaves the file byte-identical', async () => {
    await json('PUT', '/api/routines', DOC)
    const file = join(dataDir, 'routines.json')
    const before = readFileSync(file)
    const cases: [unknown, string][] = [
      [{ routines: [], active: 'ghost' }, 'The active routine must be one of the routines, or null'],
      [{ routines: 'no', active: null }, 'The routines need a list of routines'],
      [[], 'The routines must be an object'],
      [{ routines: [{ id: 'a', name: '', steps: [] }], active: null }, 'A routine needs a name of 1 to 40 characters'],
      [
        { routines: [{ id: 'a', name: 'A', steps: [{ kind: 'text', id: 'pasted', part: 1 }] }], active: null },
        'A text step needs a saved text; save the text first',
      ],
    ]
    for (const [body, message] of cases) {
      const res = await call('PUT', '/api/routines', body)
      expect(res.status, message).toBe(400)
      expect(await res.json()).toEqual({ error: message })
      expect(readFileSync(file).equals(before)).toBe(true)
    }
  })

  it('400s a body that is not JSON, and creates nothing', async () => {
    const res = await fetch(`${url}/api/routines`, { method: 'PUT', body: '{oops' })
    expect(res.status).toBe(400)
    expect(existsSync(dataDir)).toBe(false)
  })

  it('413s a body of more than 1 MiB and keeps serving', async () => {
    const big = { routines: [], active: null, pad: 'x'.repeat(1024 * 1024 + 1) }
    expect((await call('PUT', '/api/routines', big)).status).toBe(413)
    expect(existsSync(join(dataDir, 'routines.json'))).toBe(false)
    expect(await json('GET', '/api/routines')).toEqual({ routines: [], active: null })
  })

  it('405s wrong methods with an Allow header', async () => {
    for (const method of ['POST', 'DELETE', 'PATCH']) {
      const res = await call(method, '/api/routines')
      expect(res.status, method).toBe(405)
      expect(res.headers.get('allow'), method).toBe('GET, PUT')
    }
    expect(existsSync(dataDir)).toBe(false)
  })
})
