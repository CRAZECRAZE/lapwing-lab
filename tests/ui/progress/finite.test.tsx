// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/preact'
import type { JSX } from 'preact'
import { afterEach, describe, expect, it } from 'vitest'
import type { DayQuality } from '../../../server/stats.ts'
import type { RangeId } from '../../../src/core/progressview.ts'
import { addDays } from '../../../src/core/days.ts'
import { AccuracyConsistency } from '../../../src/ui/progress/AccuracyConsistency.tsx'
import { WeeklyBars } from '../../../src/ui/progress/WeeklyBars.tsx'
import { WpmByDay } from '../../../src/ui/progress/WpmByDay.tsx'
import type { ReadyData } from '../../../src/ui/progress/Tiles.tsx'
import { badNumbers, q, ready, stat, TODAY } from './fixtures.ts'

afterEach(cleanup)

const PANELS: [string, (p: { data: ReadyData }) => JSX.Element][] = [
  ['WpmByDay', WpmByDay],
  ['AccuracyConsistency', AccuracyConsistency],
  ['WeeklyBars', WeeklyBars],
]

const manyDays = (n: number): DayQuality[] =>
  Array.from({ length: n }, (_, i) => q(addDays(TODAY, -i), 2, 50, 10 + (i % 7), 0.8 + (i % 10) / 100, 50 + (i % 40)))

type Fixture = { name: string; build: () => ReadyData }
const FIXTURES: Fixture[] = [
  { name: 'empty', build: () => ready() },
  { name: 'one day', build: () => ready({ days: [q(TODAY, 3, 90, 12, 0.9, 70)], stats: [stat(TODAY, 20, 800)] }) },
  {
    name: 'all equal',
    build: () =>
      ready({
        days: [q('2026-10-20', 3, 90, 12, 0.9, 70), q('2026-10-21', 3, 90, 12, 0.9, 70), q('2026-10-22', 3, 90, 12, 0.9, 70)],
        stats: [stat('2026-10-20', 30, 500), stat('2026-10-27', 30, 500)],
      }),
  },
  {
    name: 'all zero',
    build: () =>
      ready({
        days: [q('2026-10-20', 3, 90, 0, 0, 0), q('2026-10-21', 3, 90, 0, 0, 0), q('2026-10-22', 3, 90, 0, 0, 0)],
        stats: [stat('2026-10-20', 0, 0)],
      }),
  },
  {
    name: 'huge values',
    build: () =>
      ready({
        days: [
          q('2026-10-20', 3, 90, 1e308, 1, 1e308),
          q('2026-10-21', 3, 90, Number.MAX_VALUE, 1e300, 100),
          q('2026-10-22', 3, 90, 5e-324, 5e-324, 0),
        ],
        stats: [stat('2026-10-20', 1e300, 1e308), stat('2026-10-21', 1e300, 1e308)],
      }),
  },
  {
    name: 'negative and odd values',
    build: () =>
      ready({
        days: [q('2026-10-20', 3, 90, -5, -0.2, -3), q('2026-10-21', 3, 1e-9, 12, 3, 140), q('2026-10-22', 3, 90, 12, 0.5, 50)],
        stats: [stat('2026-10-20', -30, -5)],
      }),
  },
  {
    name: '158 weeks',
    build: () =>
      ready({
        days: manyDays(1100),
        stats: manyDays(1100).map((d, i) => stat(d.date, i % 50, i * 7)),
        range: 'all',
      }),
  },
  {
    name: 'a hundred days of 3 months',
    build: () => ready({ days: manyDays(91), stats: manyDays(91).map((d) => stat(d.date, 20, 400)), range: '3m' }),
  },
]

describe('no NaN or Infinity in anything drawn', () => {
  for (const [panel, Panel] of PANELS) {
    for (const fixture of FIXTURES) {
      it(`${panel}: ${fixture.name}`, () => {
        const { container } = render(<Panel data={fixture.build()} />)
        expect(badNumbers(container)).toEqual([])
        // the same after every dot and bar has been focused (tooltips drawn)
        for (const hit of Array.from(container.querySelectorAll('g.chart__hit')).slice(0, 12)) {
          fireEvent.focus(hit)
          expect(badNumbers(container)).toEqual([])
          fireEvent.blur(hit)
        }
      })
    }
  }

  it('checks every coordinate attribute is a finite number where a number belongs', () => {
    const { container } = render(<WpmByDay data={FIXTURES[2].build()} />)
    const numeric = ['cx', 'cy', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'width', 'height', 'r']
    for (const el of Array.from(container.querySelectorAll('svg *'))) {
      for (const name of numeric) {
        const v = el.getAttribute(name)
        if (v !== null) expect(Number.isFinite(Number(v)), `${el.tagName} ${name}="${v}"`).toBe(true)
      }
    }
  })

  it('draws for every range without throwing', () => {
    for (const range of ['4w', '3m', 'all'] as RangeId[]) {
      for (const [, Panel] of PANELS) {
        const { container } = render(<Panel data={ready({ days: manyDays(30), stats: [stat(TODAY, 10, 100)], range })} />)
        expect(badNumbers(container)).toEqual([])
        cleanup()
      }
    }
  })
})
