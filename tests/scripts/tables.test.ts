import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBriefTables, parseSentences } from '../../scripts/lib/tables.ts'

const book = (name: string) => readFileSync(`content/lapwing-book/src/${name}`, 'utf8')

describe('parseBriefTables', () => {
  const rows = parseBriefTables(5, book('Chapter-05.md'))

  it('reads chapter and extra brief rows with their strokes', () => {
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'chapter', translation: 'the', outlines: ['-T'] }))
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'chapter', translation: 'are', outlines: ['R', '-R'] }))
    expect(rows).toContainEqual(expect.objectContaining({ translation: '.', outlines: ['TP-PL'] }))
    expect(rows).toContainEqual(expect.objectContaining({ translation: '?', outlines: ['KW-PL'] }))
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'extra', translation: 'did you', outlines: ['TKU'] }))
  })

  it('does not pick up other tables in the chapter', () => {
    expect(rows.some((r) => r.translation === 'cat')).toBe(false)
  })

  it('gives explanations as plain text without tags', () => {
    expect(rows.find((r) => r.translation === 'did' && r.kind === 'chapter')?.explanation).toBe('did')
    expect(rows.find((r) => r.translation === 'did you')?.explanation).toBe('TK + U')
  })

  it('keeps both rows for a translation with two briefs', () => {
    const mother = parseBriefTables(12, book('Chapter-12.md')).filter((r) => r.translation === 'mother')
    expect(mother.map((r) => r.outlines)).toEqual([['PHO*RT'], ['PHOER']])
  })

  it('handles long explanations with links and code spans', () => {
    const your = parseBriefTables(12, book('Chapter-12.md')).find((r) => r.translation === 'your')
    expect(your?.outlines).toEqual(['KWHUR'])
    expect(your?.explanation).toContain('update your dictionary')
    expect(your?.explanation).not.toContain('](')
  })

  it('throws naming chapter and row when an outline cell has no stroke', () => {
    const md = '## Chapter briefs\n\n| Word | Brief | Explanation |\n|---|---|---|\n| the | none | x |\n'
    expect(() => parseBriefTables(9, md)).toThrow(/Chapter 9.*"the"/)
  })

  it('throws on an unparseable stroke', () => {
    const md = '## Chapter briefs\n\n| Word | Brief | Explanation |\n|---|---|---|\n| the | `QQ` | x |\n'
    expect(() => parseBriefTables(9, md)).toThrow(/Chapter 9.*"the".*QQ/)
  })
})

describe('parseSentences', () => {
  it('zips practice sentences with their answers', () => {
    const rows = parseSentences(5, book('Chapter-05.md'))
    expect(rows).toHaveLength(4)
    expect(rows[0]).toEqual({ chapter: 5, text: 'I do tip the lad.', outline: 'EU/TKO/TEUP/-T/HRAD/TP-PL' })
  })

  it('throws naming the chapter when the lists differ in length', () => {
    const md = '### Practice sentences\n\n1. a\n2. b\n\n#### Answers\n\n1. `A`\n'
    expect(() => parseSentences(7, md)).toThrow(/Chapter 7/)
  })

  it('returns nothing for a chapter without practice sentences', () => {
    expect(parseSentences(4, '# Title\n\ntext\n')).toEqual([])
  })
})
