import { describe, expect, it } from 'vitest'
import { formatNoteBlock } from '../../src/core/journal.ts'

describe('formatNoteBlock', () => {
  const at = (h: number, m: number): Date => new Date(2026, 9, 27, h, m, 30)

  it('writes a heading with the local time, title and stats, then a blank line and the text', () => {
    expect(formatNoteBlock(at(18, 42), 'Row drill', { accuracy: 0.92, wpm: 41 }, 'Felt steady.')).toBe(
      '### 18:42 — Row drill · 92% · 41 wpm\n\nFelt steady.',
    )
  })

  it('rounds accuracy and speed', () => {
    expect(formatNoteBlock(at(18, 42), 'T', { accuracy: 0.9249, wpm: 40.5 }, 'x')).toBe('### 18:42 — T · 92% · 41 wpm\n\nx')
  })

  it('leaves the stats off when there are none', () => {
    expect(formatNoteBlock(at(18, 42), 'Free type', null, 'Note')).toBe('### 18:42 — Free type\n\nNote')
  })

  it('zero-pads the hour and minute', () => {
    expect(formatNoteBlock(at(9, 5), 'T', null, 'x')).toBe('### 09:05 — T\n\nx')
    expect(formatNoteBlock(at(0, 0), 'T', null, 'x')).toBe('### 00:00 — T\n\nx')
  })

  it('trims the text and adds no trailing newline', () => {
    expect(formatNoteBlock(at(9, 5), 'T', null, '  \n hello\nthere \n\n')).toBe('### 09:05 — T\n\nhello\nthere')
  })
})
