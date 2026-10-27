import { slotMask } from './steno.ts'
import type { Slot, SlotMask } from './steno.ts'

/** The 28 levers of the Uni v4, in Plover's chart order. */
export const LEVERS = [
  'S1-', 'T-', 'K-', 'P-', 'W-', 'H-', 'R-', 'A-', 'O-', '*1',
  '-E', '-U', '-F', '-R', '-P', '-B', '-L', '-G', '-T', '-S', '-D', '-Z',
  '#1', 'S2-', '*2', '*3', '*4', '#2',
] as const

export type Lever = typeof LEVERS[number]

export const UNI_USAGE_PAGE = 0xff50
export const UNI_USAGE = 0x4c56
export const UNI_REPORT_ID = 0x50

const ALIASES: Partial<Record<Lever, Slot>> = {
  'S1-': 'S-', 'S2-': 'S-',
  '*1': '*', '*2': '*', '*3': '*', '*4': '*',
  '#1': '#', '#2': '#',
}

export function leverSlot(lever: Lever): Slot {
  return ALIASES[lever] ?? (lever as Slot)
}

export function leversToMask(levers: readonly Lever[]): SlotMask {
  return slotMask(...levers.map(leverSlot))
}

/** Physical layout: 3 rows x 11 columns, the split between columns 4 and 5. */
export const UNI_GRID: readonly (readonly (Lever | null)[])[] = [
  ['S1-', 'T-', 'P-', 'H-', '*1', '*3', '-F', '-P', '-L', '-T', '-D'],
  ['S2-', 'K-', 'W-', 'R-', '*2', '*4', '-R', '-B', '-G', '-S', '-Z'],
  [null, null, '#1', 'A-', 'O-', '-E', '-U', '#2', null, null, null],
]

/**
 * Decode one input report. WebHID strips the report id, so it arrives apart from
 * `data`, which holds only the 8-byte payload: a big-endian 64-bit mask where
 * bit 63 is chart entry 0. Bits for entries beyond the 28 levers are ignored.
 */
export function decodeUniReport(reportId: number, data: DataView): Lever[] | null {
  if (reportId !== UNI_REPORT_ID || data.byteLength < 8) return null
  const bits = data.getBigUint64(0, false)
  return LEVERS.filter((_, i) => (bits >> BigInt(63 - i)) & 1n)
}

export type RawStroke = { levers: Lever[]; mask: SlotMask }

/** ORs every non-empty report; the first all-released report ends the stroke. */
export class ChordAccumulator {
  private seen = new Set<Lever>()

  push(levers: readonly Lever[]): RawStroke | null {
    if (levers.length > 0) {
      for (const lever of levers) this.seen.add(lever)
      return null
    }
    if (this.seen.size === 0) return null
    const done = LEVERS.filter((lever) => this.seen.has(lever))
    this.seen.clear()
    return { levers: done, mask: leversToMask(done) }
  }

  reset(): void {
    this.seen.clear()
  }
}
