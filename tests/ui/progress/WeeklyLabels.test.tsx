// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { textWidth } from '../../../src/core/chartmath.ts'
import { addDays } from '../../../src/core/days.ts'
import { weekStart } from '../../../src/core/progressview.ts'
import { WeeklyBars } from '../../../src/ui/progress/WeeklyBars.tsx'
import { ready, stat, TODAY } from './fixtures.ts'

afterEach(cleanup)

/** `n` weeks of practice ending this week, with stroke counts from 3 to 5 digits (29,800 and 3,000 and 842). */
function weeksFixture(n: number, today: string = TODAY) {
  const first = addDays(weekStart(today), -7 * (n - 1))
  const sizes = [29800, 3000, 842, 15120, 4210, 99, 12044, 7777]
  return Array.from({ length: n }, (_, i) => stat(addDays(first, i * 7 + 1), 20 + (i % 9) * 10, sizes[i % sizes.length]))
}

/** The extents [x - width / 2, x + width / 2] of the drawn labels, left to right. */
function extents(container: Element, selector: string): { from: number; to: number; text: string }[] {
  return Array.from(container.querySelectorAll(selector))
    .map((t) => {
      const x = Number(t.getAttribute('x'))
      const w = textWidth(t.textContent ?? '')
      return { from: x - w / 2, to: x + w / 2, text: t.textContent ?? '' }
    })
    .sort((a, b) => a.from - b.from)
}

function overlaps(list: { from: number; to: number }[]): number[] {
  const bad: number[] = []
  for (let i = 1; i < list.length; i++) if (list[i].from < list[i - 1].to) bad.push(i)
  return bad
}

describe('WeeklyBars labels never overlap', () => {
  for (const n of [5, 6, 12, 14, 17, 20, 24, 26, 27, 60, 158]) {
    it(`${n} bars: the strokes under the bars and the week labels keep clear of each other`, () => {
      const { container } = render(<WeeklyBars data={ready({ stats: weeksFixture(n), range: 'all' })} />)
      expect(container.querySelectorAll('g.chart__hit')).toHaveLength(n)
      const strokes = extents(container, 'text.chart__strokes')
      expect(overlaps(strokes), strokes.map((s) => s.text).join(' ')).toEqual([])
      if (n <= 26) expect(strokes.length).toBeGreaterThanOrEqual(1)
      const dates = extents(container, 'text.chart__tick-x')
      expect(overlaps(dates), dates.map((s) => s.text).join(' ')).toEqual([])
      // the numbers are all in the table whatever was drawn
      expect(container.querySelectorAll('tbody tr')).toHaveLength(n)
    })
  }

  it('labels the latest week when strokes are thinned', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: weeksFixture(20), range: 'all' })} />)
    const texts = Array.from(container.querySelectorAll('text.chart__strokes'))
    expect(texts.length).toBeLessThan(20)
    const last = texts[texts.length - 1]
    const lastBar = Array.from(container.querySelectorAll('g.chart__hit')).pop()!.querySelector('rect.chart__bar')!
    const barMid = Number(lastBar.getAttribute('x')) + Number(lastBar.getAttribute('width')) / 2
    expect(Number(last.getAttribute('x'))).toBeCloseTo(barMid, 0)
  })

  it('keeps 6 week labels clear when they carry a year (weeks over a year end, slots narrower than a label)', () => {
    const today = '2027-01-13'
    const { container } = render(<WeeklyBars data={ready({ stats: weeksFixture(6, today), range: 'all', today })} />)
    const dates = extents(container, 'text.chart__tick-x')
    expect(dates.some((d) => /2026$/.test(d.text)) || dates.some((d) => /2027$/.test(d.text))).toBe(true)
    expect(overlaps(dates), dates.map((d) => d.text).join(' ')).toEqual([])
  })

  it('keeps the week labels clear when the weeks run over a year end (labels carry the year)', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: weeksFixture(60), range: 'all' })} />)
    expect(Array.from(container.querySelectorAll('text.chart__tick-x')).some((t) => /20\d\d$/.test(t.textContent ?? ''))).toBe(true)
  })
})
