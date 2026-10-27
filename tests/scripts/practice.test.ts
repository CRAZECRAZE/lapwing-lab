import { describe, expect, it } from 'vitest'
import { parsePracticeFile } from '../../scripts/lib/practice.ts'

describe('parsePracticeFile', () => {
  it('parses a single line into one item', () => {
    expect(parsePracticeFile('5-cvc', 'snatch\tSTPHAFP\n')).toEqual({
      id: '5-cvc',
      items: [{ prompt: 'snatch', outlines: ['STPHAFP'] }],
    })
  })

  it('keeps multistroke outlines verbatim', () => {
    const list = parsePracticeFile('x', 'sprinklers\tSPR*EUPBG/HRER/-Z\n')
    expect(list.items).toEqual([{ prompt: 'sprinklers', outlines: ['SPR*EUPBG/HRER/-Z'] }])
  })

  it('merges repeated prompts with different outlines, keeping first-seen order', () => {
    const list = parsePracticeFile('x', 'read\tRED\nlead\tHRED\nread\tRAOED\n')
    expect(list.items).toEqual([
      { prompt: 'read', outlines: ['RED', 'RAOED'] },
      { prompt: 'lead', outlines: ['HRED'] },
    ])
  })

  it('stores a repeated outline once', () => {
    const list = parsePracticeFile('x', 'read\tRED\nread\tRED\n')
    expect(list.items).toEqual([{ prompt: 'read', outlines: ['RED'] }])
  })

  it('skips blank lines', () => {
    const list = parsePracticeFile('x', '\ncar\tKAR\n\n  \nrad\tRAD\n\n')
    expect(list.items.map((i) => i.prompt)).toEqual(['car', 'rad'])
  })

  it('names the id and 1-based line number when a line has no tab', () => {
    expect(() => parsePracticeFile('5-cvc', 'car\tKAR\n\nbroken line\n')).toThrow(/5-cvc.*line 3/)
  })

  it('names the id, line and outline when an outline does not parse', () => {
    expect(() => parsePracticeFile('5-cvc', 'car\tKAR\nx\tQQ\n')).toThrow(/5-cvc.*line 2.*QQ/)
  })
})
