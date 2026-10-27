import { describe, expect, it } from 'vitest'
import { SLOTS, parseStroke, slotMask } from '../../src/core/steno.ts'
import {
  ChordAccumulator,
  LEVERS,
  UNI_GRID,
  UNI_REPORT_ID,
  UNI_USAGE,
  UNI_USAGE_PAGE,
  decodeUniReport,
  leverSlot,
  leversToMask,
} from '../../src/core/uni.ts'
import type { Lever } from '../../src/core/uni.ts'

const payload = (...bytes: number[]): DataView => {
  const buffer = new Uint8Array(8)
  buffer.set(bytes)
  return new DataView(buffer.buffer)
}

describe('constants', () => {
  it('exposes the HID identifiers', () => {
    expect(UNI_USAGE_PAGE).toBe(0xff50)
    expect(UNI_USAGE).toBe(0x4c56)
    expect(UNI_REPORT_ID).toBe(0x50)
  })
})

describe('layout', () => {
  it('has 28 levers in Plover chart order', () => {
    expect(LEVERS).toHaveLength(28)
    expect(LEVERS[0]).toBe('S1-')
    expect(LEVERS[27]).toBe('#2')
  })

  it('places every lever exactly once in a 3 x 11 grid', () => {
    expect(UNI_GRID).toHaveLength(3)
    for (const row of UNI_GRID) expect(row).toHaveLength(11)
    const placed = UNI_GRID.flat().filter((l): l is Lever => l !== null)
    expect(placed).toHaveLength(28)
    expect([...placed].sort()).toEqual([...LEVERS].sort())
  })

  it('matches the design-doc grid', () => {
    const text = UNI_GRID.map((row) => row.map((l) => l ?? '.').join(' '))
    expect(text).toEqual([
      'S1- T- P- H- *1 *3 -F -P -L -T -D',
      'S2- K- W- R- *2 *4 -R -B -G -S -Z',
      '. . #1 A- O- -E -U #2 . . .',
    ])
  })

  it('maps aliased levers onto one slot', () => {
    expect(leverSlot('S1-')).toBe('S-')
    expect(leverSlot('S2-')).toBe('S-')
    for (const l of ['*1', '*2', '*3', '*4'] as const) expect(leverSlot(l)).toBe('*')
    expect(leverSlot('#1')).toBe('#')
    expect(leverSlot('#2')).toBe('#')
    expect(leverSlot('-Z')).toBe('-Z')
    expect(leverSlot('A-')).toBe('A-')
  })

  it('reaches each of the 23 slots from some lever', () => {
    const reached = new Set(LEVERS.map(leverSlot))
    expect([...reached].sort()).toEqual([...SLOTS].sort())
    expect(reached.size).toBe(23)
  })

  it('folds aliases when building a mask', () => {
    expect(leversToMask(['S2-', '*3'])).toBe(slotMask('S-', '*'))
    expect(leversToMask(['S1-', 'S2-'])).toBe(slotMask('S-'))
    expect(leversToMask([])).toBe(0)
  })
})

describe('decodeUniReport', () => {
  it('reads the first chart entry from bit 63', () => {
    expect(decodeUniReport(0x50, payload(0x80))).toEqual(['S1-'])
  })

  it('reads several levers in chart order', () => {
    expect(decodeUniReport(0x50, payload(0xc0))).toEqual(['S1-', 'T-'])
  })

  it('reads a lever from a later byte', () => {
    expect(decodeUniReport(0x50, payload(0, 0, 0x04))).toEqual(['-Z'])
    expect(decodeUniReport(0x50, payload(0, 0, 0, 0x10))).toEqual(['#2'])
  })

  it('decodes an all-zero report as no levers', () => {
    expect(decodeUniReport(0x50, payload())).toEqual([])
  })

  it('rejects another report id', () => {
    expect(decodeUniReport(0x51, payload(0x80))).toBeNull()
  })

  it('rejects a short payload', () => {
    expect(decodeUniReport(0x50, new DataView(new ArrayBuffer(4)))).toBeNull()
  })

  it('ignores chart entries beyond the 28 levers', () => {
    // chart entry 30 is bit 33: byte 3, mask 0x02
    expect(decodeUniReport(0x50, payload(0, 0, 0, 0x02))).toEqual([])
    expect(decodeUniReport(0x50, payload(0x80, 0, 0, 0x02))).toEqual(['S1-'])
  })
})

describe('ChordAccumulator', () => {
  it('emits the OR of all reports once everything is released', () => {
    const acc = new ChordAccumulator()
    expect(acc.push(['S1-', 'A-'])).toBeNull()
    expect(acc.push(['S1-', 'A-', '-P'])).toBeNull()
    const stroke = acc.push([])
    expect(stroke?.levers).toEqual(['S1-', 'A-', '-P'])
    expect(stroke?.mask).toBe(parseStroke('SAP'))
  })

  it('keeps keys released mid-stroke', () => {
    const acc = new ChordAccumulator()
    acc.push(['S1-', 'T-'])
    acc.push(['S1-'])
    const stroke = acc.push([])
    expect(stroke?.mask).toBe(parseStroke('ST'))
  })

  it('does not fabricate a stroke from a stray empty report', () => {
    const acc = new ChordAccumulator()
    expect(acc.push([])).toBeNull()
  })

  it('starts empty after a stroke', () => {
    const acc = new ChordAccumulator()
    acc.push(['S1-'])
    acc.push([])
    acc.push(['T-'])
    const stroke = acc.push([])
    expect(stroke?.levers).toEqual(['T-'])
    expect(stroke?.mask).toBe(parseStroke('T'))
    expect(acc.push([])).toBeNull()
  })

  it('drops a pending chord on reset', () => {
    const acc = new ChordAccumulator()
    acc.push(['S1-'])
    acc.reset()
    expect(acc.push([])).toBeNull()
  })

  it('lists levers in chart order and without duplicates', () => {
    const acc = new ChordAccumulator()
    acc.push(['-Z'])
    acc.push(['S1-', '-Z'])
    expect(acc.push([])?.levers).toEqual(['S1-', '-Z'])
  })
})
