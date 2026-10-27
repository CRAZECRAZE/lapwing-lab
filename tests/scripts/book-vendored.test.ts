import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const book = join(import.meta.dirname, '..', '..', 'content', 'lapwing-book')

describe('vendored Lapwing book', () => {
  it('is pinned to the expected upstream commit', () => {
    const pinned = readFileSync(join(book, 'PINNED_COMMIT'), 'utf8').trim()
    expect(pinned).toBe('46b53e1ebec3b19fb402da046d6dc0a13b530787')
  })

  it('contains the chapters', () => {
    expect(existsSync(join(book, 'src', 'Chapter-05.md'))).toBe(true)
  })

  it('contains the 57 practice word lists', () => {
    const files = readdirSync(join(book, 'src', 'practice')).filter((f) => f.endsWith('.txt'))
    expect(files).toHaveLength(57)
  })

  it('ships the GPL license text', () => {
    expect(readFileSync(join(book, 'LICENSE'), 'utf8')).toContain('GNU GENERAL PUBLIC LICENSE')
  })
})
