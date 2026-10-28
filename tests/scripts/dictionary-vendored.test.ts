import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { syncDictionary } from '../../scripts/sync-dictionary.ts'

const dir = join(import.meta.dirname, '..', '..', 'content', 'lapwing-dictionary')

const FLOORS: Record<string, number> = {
  'lapwing-base.json': 100000,
  'lapwing-uk-additions.json': 10000,
  'lapwing-proper-nouns.json': 10000,
  'lapwing-numbers.json': 100,
  'lapwing-commands.json': 100,
  'lapwing-semi-modal-movement.json': 5,
}

describe('vendored Lapwing dictionary', () => {
  it('is pinned to the expected upstream commit', () => {
    const pinned = readFileSync(join(dir, 'PINNED_COMMIT'), 'utf8').trim()
    expect(pinned).toBe('4ac5d53cf039a2b1f4c484456663c85e7df4e859')
  })

  for (const [file, floor] of Object.entries(FLOORS)) {
    it(`${file} is a JSON object of strings with more than ${floor} entries`, () => {
      const data: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      expect(typeof data).toBe('object')
      expect(data).not.toBeNull()
      expect(Array.isArray(data)).toBe(false)
      const values = Object.values(data as Record<string, unknown>)
      expect(values.every((v) => typeof v === 'string')).toBe(true)
      expect(values.length).toBeGreaterThan(floor)
    })
  }

  it('ships the MIT license text', () => {
    expect(readFileSync(join(dir, 'LICENSE'), 'utf8')).toContain('MIT License')
  })

  it('names the upstream URL and commit in SOURCE.md', () => {
    const source = readFileSync(join(dir, 'SOURCE.md'), 'utf8')
    expect(source).toContain('https://github.com/aerickt/plover-lapwing-aio')
    expect(source).toContain('4ac5d53cf039a2b1f4c484456663c85e7df4e859')
  })
})

describe('syncDictionary', () => {
  it('refuses anything but a full 40-hex commit hash', () => {
    expect(() => syncDictionary('main')).toThrow(/40-hex/)
    expect(() => syncDictionary('a'.repeat(39))).toThrow(/40-hex/)
  })
})
