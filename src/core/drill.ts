import { formatStroke, maskToSlots, parseOutline, slotMask } from './steno.ts'
import type { Slot, SlotMask } from './steno.ts'
import type { RawStroke } from './uni.ts'

export type DrillItem = { prompt: string; outlines: string[] }
export type Diff = { missing: Slot[]; extra: Slot[] }

export type StrokeResult =
  | { kind: 'partial'; item: DrillItem }
  | { kind: 'correct'; item: DrillItem; firstTry: boolean }
  | { kind: 'miss'; item: DrillItem; diff: Diff; expected: string }
  | { kind: 'undo' }
  | { kind: 'ignored' }

export type DrillStats = {
  completed: number
  firstTryCorrect: number
  accuracy: number
  elapsedMs: number
  wpm: number
}

export function diffMasks(expected: SlotMask, pressed: SlotMask): Diff {
  return {
    missing: maskToSlots(expected & ~pressed),
    extra: maskToSlots(pressed & ~expected),
  }
}

const STAR = slotMask('*')

function popcount(mask: number): number {
  let n = 0
  for (let m = mask; m !== 0; m &= m - 1) n++
  return n
}

export class DrillSession {
  readonly total: number
  private readonly items: readonly DrillItem[]
  private readonly parsed: SlotMask[][][]
  private readonly clock: () => number
  private position = 0
  private entered: SlotMask[] = []
  private missed = false
  private completed = 0
  private firstTryCorrect = 0
  private startedAt: number | null = null
  private lastCompletionAt: number | null = null

  constructor(items: readonly DrillItem[], clock: () => number = Date.now) {
    this.items = items
    this.clock = clock
    this.total = items.length
    this.parsed = items.map((it) => {
      if (it.outlines.length === 0) {
        throw new Error(`Drill item ${JSON.stringify(it.prompt)} has no outlines`)
      }
      return it.outlines.map((outline) => {
        try {
          return parseOutline(outline)
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e)
          throw new Error(`Drill item ${JSON.stringify(it.prompt)} has an invalid outline: ${reason}`)
        }
      })
    })
  }

  get index(): number {
    return this.position
  }

  get current(): DrillItem | undefined {
    return this.items[this.position]
  }

  get finished(): boolean {
    return this.position >= this.total
  }

  submit(stroke: RawStroke): StrokeResult {
    const item = this.current
    if (item === undefined) return { kind: 'ignored' }
    const now = this.clock()
    if (this.startedAt === null) this.startedAt = now

    const at = this.entered.length
    const alive = this.parsed[this.position].filter((outline) =>
      this.entered.every((mask, i) => outline[i] === mask),
    )

    if (stroke.mask === STAR && !alive.some((outline) => outline[at] === STAR)) {
      if (at === 0) return { kind: 'ignored' }
      this.entered.pop()
      return { kind: 'undo' }
    }

    const matching = alive.filter((outline) => outline[at] === stroke.mask)
    if (matching.length === 0) {
      let best = alive[0][at]
      let bestCost = popcount(best ^ stroke.mask)
      for (const outline of alive) {
        const cost = popcount(outline[at] ^ stroke.mask)
        if (cost < bestCost) {
          best = outline[at]
          bestCost = cost
        }
      }
      this.entered = []
      this.missed = true
      return { kind: 'miss', item, diff: diffMasks(best, stroke.mask), expected: formatStroke(best) }
    }

    this.entered.push(stroke.mask)
    if (!matching.some((outline) => outline.length === at + 1)) return { kind: 'partial', item }

    const firstTry = !this.missed
    this.completed++
    if (firstTry) this.firstTryCorrect++
    this.lastCompletionAt = now
    this.position++
    this.entered = []
    this.missed = false
    return { kind: 'correct', item, firstTry }
  }

  stats(): DrillStats {
    const elapsedMs =
      this.startedAt === null || this.lastCompletionAt === null ? 0 : this.lastCompletionAt - this.startedAt
    return {
      completed: this.completed,
      firstTryCorrect: this.firstTryCorrect,
      accuracy: this.completed === 0 ? 0 : this.firstTryCorrect / this.completed,
      elapsedMs,
      wpm: elapsedMs === 0 ? 0 : this.completed / (elapsedMs / 60000),
    }
  }
}
