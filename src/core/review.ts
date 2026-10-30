import type { StrokeRecord, TestRow } from '../../server/archive.ts'
import { describeFree } from '../freetype/free.ts'
import { STAGE0_INFO } from '../stage0/lists.ts'
import { diffMasks } from './drill.ts'
import { FIXUP_MODE, TEXT_MODE } from './runmodes.ts'
import { formatStroke, parseOutline } from './steno.ts'
import type { Slot, SlotMask } from './steno.ts'

export type Miss = { prompt: string; expected: string; pressed: string; missing: Slot[]; extra: Slot[] }

function popcount(mask: number): number {
  let n = 0
  for (let m = mask; m !== 0; m &= m - 1) n++
  return n
}

/** The stroke of any accepted outline that differs from the pressed keys in the fewest keys, or null if none parse. */
export function nearestStroke(expected: readonly string[], pressed: SlotMask): SlotMask | null {
  let best: SlotMask | null = null
  let bestDistance = Infinity
  for (const outline of expected) {
    let strokes: SlotMask[]
    try {
      strokes = parseOutline(outline)
    } catch {
      continue
    }
    for (const stroke of strokes) {
      const distance = popcount(stroke ^ pressed)
      if (distance < bestDistance) {
        best = stroke
        bestDistance = distance
      }
    }
  }
  return best
}

/** One entry per wrong stroke, comparing the pressed keys with the nearest accepted stroke. */
export function misses(strokes: readonly StrokeRecord[]): Miss[] {
  return strokes
    .filter((s) => !s.correct)
    .map((s) => {
      const pressed = formatStroke(s.pressedMask)
      const best = nearestStroke(s.expected, s.pressedMask)
      if (best === null) return { prompt: s.prompt, expected: s.expected[0] ?? '', pressed, missing: [], extra: [] }
      const { missing, extra } = diffMasks(best, s.pressedMask)
      return { prompt: s.prompt, expected: formatStroke(best), pressed, missing, extra }
    })
}

/**
 * The slowest correct strokes, slowest first; equal times keep log order. The test's first logged
 * stroke is left out: its latency runs from when the drill opened, so it is mostly the time spent settling in.
 */
export function slowest(strokes: readonly StrokeRecord[], n: number): { prompt: string; latencyMs: number }[] {
  return strokes
    .slice(1)
    .filter((s) => s.correct)
    .map((s) => ({ prompt: s.prompt, latencyMs: s.latencyMs }))
    .sort((a, b) => b.latencyMs - a.latencyMs)
    .slice(0, n)
}

const TEXT_SECTION = /^text\/([^/]+)\/([1-9]\d*)$/

/**
 * A short name for a test: the Chapter 4 drill's title, the free-type source and mode, a real-text run's text and part
 * (`textNames` maps a saved text's id to its name; an id without one, and `pasted`, are shown as they are), or the
 * mode and section.
 */
export function describeTest(
  t: Pick<TestRow, 'mode' | 'section' | 'chapter'>,
  textNames?: ReadonlyMap<string, string>,
): string {
  if (t.mode === 'stage0') {
    const title = STAGE0_INFO.find((info) => info.id === t.section)?.title
    return `Chapter 4 · ${title ?? t.section ?? 'Stage 0'}`
  }
  if (t.mode === 'free') {
    if (t.section === null) return 'Free type'
    const name = describeFree(t.section)
    return name === t.section ? `Free type · ${t.section}` : name
  }
  if (t.mode === TEXT_MODE) {
    if (t.section === null) return 'Text'
    const found = TEXT_SECTION.exec(t.section)
    if (found) return `Text · ${textNames?.get(found[1]) ?? found[1]} · part ${found[2]}`
  }
  if (t.mode === FIXUP_MODE) return t.section === null ? 'Fix-up' : `Fix-up · ${t.section}`
  return t.section === null ? t.mode : `${t.mode} · ${t.section}`
}
