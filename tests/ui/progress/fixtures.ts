import type { DayStat } from '../../../server/archive.ts'
import type { DayQuality, StatsMode, StatsResponse } from '../../../server/stats.ts'
import type { KeyStat, Mixup } from '../../../src/core/keystats.ts'
import type { RangeId } from '../../../src/core/progressview.ts'
import type { ReadyData } from '../../../src/ui/progress/Tiles.tsx'

// 2026-10-28 is a Wednesday; this week began Monday 26 Oct.
export const TODAY = '2026-10-28'
export const MIN = 60000

export const q = (
  date: string,
  runs: number,
  words: number,
  wpm: number | null,
  accuracy: number | null = 0.9,
  steadiness: number | null = null,
): DayQuality => ({ date, runs, words, wpm, accuracy, steadiness })

export const stat = (date: string, minutes: number, strokes: number): DayStat => ({
  date,
  tests: 1,
  strokes,
  activeMs: minutes * MIN,
})

export function ready(
  over: {
    days?: DayQuality[]
    stats?: DayStat[]
    mode?: StatsMode
    range?: RangeId
    today?: string
    keys?: KeyStat[]
    mixups?: Mixup[]
  } = {},
): ReadyData {
  const mode = over.mode ?? 'free'
  const stats: StatsResponse = {
    from: '',
    to: '',
    mode,
    days: over.days ?? [],
    keys: over.keys ?? [],
    mixups: over.mixups ?? [],
    allTimeStrokes: 1000,
  }
  return {
    status: 'ready',
    stats,
    days: over.stats ?? [],
    today: over.today ?? TODAY,
    range: over.range ?? '4w',
    mode,
    retry: () => undefined,
  }
}

/** Every attribute value and the text of every element in a container, for a NaN / Infinity scan. */
export function badNumbers(root: Element): string[] {
  const bad: string[] = []
  const nodes = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const el of nodes) {
    for (const a of Array.from(el.attributes)) {
      if (/NaN|Infinity/.test(a.value)) bad.push(`${el.tagName} ${a.name}="${a.value}"`)
    }
  }
  if (/NaN|Infinity/.test(root.textContent ?? '')) bad.push(`text: ${root.textContent}`)
  return bad
}
