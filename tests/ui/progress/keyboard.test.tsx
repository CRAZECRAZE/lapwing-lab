// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/preact'
import type { JSX } from 'preact'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReadyData } from '../../../src/ui/progress/Tiles.tsx'
import { AccuracyConsistency } from '../../../src/ui/progress/AccuracyConsistency.tsx'
import { WeeklyBars } from '../../../src/ui/progress/WeeklyBars.tsx'
import { WpmByDay } from '../../../src/ui/progress/WpmByDay.tsx'
import { q, ready, stat } from './fixtures.ts'

afterEach(cleanup)

const DAYS = ['2026-10-14', '2026-10-17', '2026-10-20', '2026-10-23', '2026-10-26'].map((d, i) =>
  q(d, 2, 60, 10 + i, 0.9 + i / 100, 60 + i),
)
const WEEKS = [stat('2026-10-06', 20, 100), stat('2026-10-13', 30, 200), stat('2026-10-20', 40, 300), stat('2026-10-27', 50, 400)]

const CHARTS: [string, (p: { data: ReadyData }) => JSX.Element, ReadyData, number][] = [
  ['wpm dots', WpmByDay, ready({ days: DAYS }), 5],
  ['accuracy columns', AccuracyConsistency, ready({ days: DAYS }), 5],
  ['weekly bars', WeeklyBars, ready({ stats: WEEKS }), 5],
]

const points = (c: Element): HTMLElement[] => Array.from(c.querySelectorAll<HTMLElement>('g.chart__hit'))
const stops = (c: Element): number[] =>
  points(c).flatMap((p, i) => (p.getAttribute('tabindex') === '0' ? [i] : []))
const key = (el: Element, k: string): void => {
  fireEvent.keyDown(el, { key: k })
}

for (const [name, Chart, data, count] of CHARTS) {
  describe(`${name}: one tab stop and the arrow keys`, () => {
    it('has one tabindex 0 and the others -1', () => {
      const { container } = render(<Chart data={data} />)
      expect(points(container)).toHaveLength(count)
      expect(points(container).map((p) => p.getAttribute('tabindex'))).toEqual(['0', ...Array(count - 1).fill('-1')])
    })

    it('moves focus and the tab stop with ArrowRight and ArrowLeft, and stops at the ends', () => {
      const { container } = render(<Chart data={data} />)
      points(container)[0].focus()
      expect(document.activeElement).toBe(points(container)[0])
      key(points(container)[0], 'ArrowLeft') // clamped at the first
      expect(document.activeElement).toBe(points(container)[0])
      expect(stops(container)).toEqual([0])
      key(document.activeElement!, 'ArrowRight')
      expect(document.activeElement).toBe(points(container)[1])
      expect(stops(container)).toEqual([1])
      key(document.activeElement!, 'ArrowRight')
      expect(stops(container)).toEqual([2])
      key(document.activeElement!, 'ArrowLeft')
      expect(document.activeElement).toBe(points(container)[1])
      expect(stops(container)).toEqual([1])
    })

    it('goes to the last and first with End and Home, and does not wrap past the last', () => {
      const { container } = render(<Chart data={data} />)
      points(container)[0].focus()
      key(document.activeElement!, 'End')
      expect(document.activeElement).toBe(points(container)[count - 1])
      expect(stops(container)).toEqual([count - 1])
      key(document.activeElement!, 'ArrowRight')
      expect(document.activeElement).toBe(points(container)[count - 1])
      key(document.activeElement!, 'Home')
      expect(document.activeElement).toBe(points(container)[0])
      expect(stops(container)).toEqual([0])
    })

    it('shows the tooltip of the point focused with the keyboard, and the label stays the same', () => {
      const { container } = render(<Chart data={data} />)
      points(container)[0].focus()
      key(document.activeElement!, 'ArrowRight')
      const tip = container.querySelector('.chart__tip')
      expect(tip).not.toBeNull()
      expect(tip!.textContent).toContain(points(container)[1].getAttribute('aria-label')!.split(':')[0])
      expect(points(container)[1].getAttribute('aria-label')).toBeTruthy()
    })

    it('makes a clicked or focused point the tab stop', () => {
      const { container } = render(<Chart data={data} />)
      fireEvent.click(points(container)[3])
      expect(stops(container)).toEqual([3])
      fireEvent.focus(points(container)[2])
      expect(stops(container)).toEqual([2])
    })

    it('hovering shows the tooltip without moving the tab stop', () => {
      const { container } = render(<Chart data={data} />)
      fireEvent.mouseEnter(points(container)[2])
      expect(container.querySelector('.chart__tip')).not.toBeNull()
      expect(stops(container)).toEqual([0])
    })

    it('ignores other keys', () => {
      const { container } = render(<Chart data={data} />)
      points(container)[0].focus()
      key(document.activeElement!, 'a')
      key(document.activeElement!, 'Tab')
      expect(document.activeElement).toBe(points(container)[0])
      expect(stops(container)).toEqual([0])
    })

    it('leaves the Show the numbers summary as the next stop after the chart', () => {
      const { container } = render(<Chart data={data} />)
      const svg = container.querySelector('svg')!
      const summary = container.querySelector('details > summary')!
      expect(svg.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      // in document order after the chart's one stop, the next element that Tab reaches is the summary
      const tabbable = Array.from(container.querySelectorAll('[tabindex="0"], summary, a[href], button'))
      const at = tabbable.findIndex((el) => svg.contains(el))
      expect(tabbable.filter((el) => svg.contains(el))).toHaveLength(1)
      expect(tabbable[at + 1]).toBe(summary)
    })
  })
}

describe('a chart whose data shrinks', () => {
  it('keeps one tab stop when the point that was the stop is gone', () => {
    const { container, rerender } = render(<WpmByDay data={ready({ days: DAYS })} />)
    fireEvent.click(points(container)[4])
    rerender(<WpmByDay data={ready({ days: DAYS.slice(0, 3) })} />)
    expect(stops(container)).toHaveLength(1)
  })
})
