import { describe, expect, it } from 'vitest'
import { makeSlugger, slugify } from '../../scripts/lib/slug.ts'

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('Problematic words')).toBe('problematic-words')
    expect(slugify('Chapter 4 test')).toBe('chapter-4-test')
  })

  it('drops backticks and punctuation', () => {
    expect(slugify('`AE` for `AEU`')).toBe('ae-for-aeu')
    expect(slugify('Left hand d, b, and l')).toBe('left-hand-d-b-and-l')
  })
})

describe('makeSlugger', () => {
  it('appends -1, -2 to repeated headings', () => {
    const slug = makeSlugger()
    expect(slug('x')).toBe('x')
    expect(slug('x')).toBe('x-1')
    expect(slug('x')).toBe('x-2')
    expect(slug('y')).toBe('y')
  })
})
