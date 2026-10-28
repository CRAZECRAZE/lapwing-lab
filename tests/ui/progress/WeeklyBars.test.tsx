// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { WeeklyBars } from '../../../src/ui/progress/WeeklyBars.tsx'
import { ready, stat } from './fixtures.ts'

afterEach(cleanup)

// Today is Wed 2026-10-28; the week of Oct 19 has 3 h 11 min and 10,080 strokes, this week 4 h 36 min and 11,284.
const DAYS = [stat('2026-10-20', 191, 10080), stat('2026-10-26', 120, 5000), stat('2026-10-27', 156, 6284)]
const hits = (c: Element): HTMLElement[] => Array.from(c.querySelectorAll<HTMLElement>('g.chart__hit'))
const barHeight = (g: Element): number => Number(g.querySelector('rect.chart__bar')!.getAttribute('height'))
const leftTicks = (c: Element): string[] =>
  Array.from(c.querySelectorAll('text.chart__tick-y')).map((t) => t.textContent ?? '')

describe('WeeklyBars weeks and bars', () => {
  it('draws a bar for each Monday-week of a 4 week range, 5 weeks, zero-filled', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: DAYS })} />)
    expect(hits(container)).toHaveLength(5)
    expect(hits(container).map((h) => h.getAttribute('aria-label')!.slice(0, 14))).toEqual([
      'Week of Sep 28',
      'Week of Oct 5:',
      'Week of Oct 12',
      'Week of Oct 19',
      'Week of Oct 26',
    ])
    expect(screen.getByRole('img', { name: 'Week of Oct 5: 0 min, 0 strokes' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Week of Oct 19: 3 h 11 min, 10,080 strokes' })).toBeTruthy()
  })

  it('covers the whole range: 14 weeks for 3 months', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: DAYS, range: '3m' })} />)
    expect(hits(container)).toHaveLength(14)
    expect(hits(container)[0].getAttribute('aria-label')).toMatch(/^Week of Jul 27/)
    expect(hits(container)[13].getAttribute('aria-label')).toMatch(/^Week of Oct 26/)
  })

  it('draws an empty slot with 0 min for a week without practice', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: DAYS })} />)
    const empty = hits(container)[1]
    expect(empty.getAttribute('tabindex')).toBe('0')
    expect(empty.getAttribute('aria-label')).toBe('Week of Oct 5: 0 min, 0 strokes')
    expect(empty.querySelector('rect.chart__slot')).not.toBeNull()
    expect(barHeight(empty)).toBe(0)
  })

  it('starts the y-axis at 0 and scales bar heights with time: double the time, double the height', () => {
    const days = [stat('2026-10-06', 60, 100), stat('2026-10-13', 120, 200), stat('2026-10-20', 30, 50)]
    const { container } = render(<WeeklyBars data={ready({ stats: days })} />)
    expect(leftTicks(container)[0]).toBe('0 min')
    const h = hits(container).map(barHeight)
    expect(h[2]).toBeCloseTo(2 * h[1], 0)
    expect(h[1]).toBeCloseTo(2 * h[3], 0)
    expect(h[3]).toBeGreaterThan(0)
  })

  it('does not let an outlier week hide the others: the axis tops at the data maximum rounded up', () => {
    const days = [stat('2026-10-06', 20, 100), stat('2026-10-13', 30, 200), stat('2026-10-20', 600, 5000)]
    const { container } = render(<WeeklyBars data={ready({ stats: days })} />)
    const ticks = leftTicks(container)
    expect(ticks[ticks.length - 1]).toBe('10 h')
    const h = hits(container).map(barHeight)
    expect(h[1]).toBeCloseTo((h[3] * 20) / 600, 0) // still in proportion, and not on the floor
    expect(h[1]).toBeGreaterThan(3)
  })

  it('names strokes under each bar for a short range', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: DAYS })} />)
    const texts = Array.from(container.querySelectorAll('text.chart__strokes')).map((t) => t.textContent)
    expect(texts).toEqual(['0', '0', '0', '10,080', '11,284'])
  })

  it('shortens the strokes under 14 bars and leaves them out beyond 26 bars (the table keeps them)', () => {
    const three = render(<WeeklyBars data={ready({ stats: DAYS, range: '3m' })} />)
    const short = Array.from(three.container.querySelectorAll('text.chart__strokes')).map((t) => t.textContent)
    expect(short).toHaveLength(14)
    expect(short.slice(-2)).toEqual(['10.1k', '11.3k'])
    cleanup()
    const all = render(<WeeklyBars data={ready({ stats: [stat('2025-09-02', 30, 400), ...DAYS], range: 'all' })} />)
    expect(hits(all.container).length).toBeGreaterThan(26)
    expect(all.container.querySelectorAll('text.chart__strokes')).toHaveLength(0)
    expect(all.container.querySelectorAll('tbody tr')).toHaveLength(hits(all.container).length)
  })

  it('shows at most 6 week labels on the axis so nothing overlaps', () => {
    for (const range of ['4w', '3m', 'all'] as const) {
      const { container } = render(<WeeklyBars data={ready({ stats: DAYS, range })} />)
      expect(container.querySelectorAll('text.chart__tick-x').length).toBeLessThanOrEqual(6)
      expect(container.querySelectorAll('text.chart__tick-x').length).toBeGreaterThanOrEqual(1)
      cleanup()
    }
  })
})

describe('WeeklyBars all time', () => {
  it('starts at the first week with practice instead of three years of empty weeks', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: DAYS, range: 'all' })} />)
    expect(hits(container).map((h) => h.getAttribute('aria-label')!.slice(0, 14))).toEqual(['Week of Oct 19', 'Week of Oct 26'])
  })

  it('keeps the weeks after the first practice zero-filled', () => {
    const days = [stat('2026-09-15', 30, 400), stat('2026-10-20', 10, 50)]
    const { container } = render(<WeeklyBars data={ready({ stats: days, range: 'all' })} />)
    const labels = hits(container).map((h) => h.getAttribute('aria-label')!.slice(0, 14))
    expect(labels[0]).toBe('Week of Sep 14')
    expect(labels).toHaveLength(7)
    expect(hits(container)[3].getAttribute('aria-label')).toBe('Week of Oct 5: 0 min, 0 strokes')
  })
})

describe('WeeklyBars the current week', () => {
  it('draws the week that contains today lighter and labels it so far', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: DAYS })} />)
    const now = hits(container)[4]
    expect(now.querySelector('rect.chart__bar')!.getAttribute('class')).toContain('chart__bar--now')
    expect(now.getAttribute('aria-label')).toBe('Week of Oct 26: 4 h 36 min, 11,284 strokes, so far')
    expect(screen.getByText('so far')).toBeTruthy()
    // no other bar is marked
    expect(container.querySelectorAll('.chart__bar--now')).toHaveLength(1)
    expect(hits(container)[3].getAttribute('aria-label')).not.toContain('so far')
  })

  it('marks the current week when it is a Sunday too (it is still the week of that Monday)', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: DAYS, today: '2026-11-01' })} />)
    const all = hits(container)
    expect(all[all.length - 1].getAttribute('aria-label')).toMatch(/^Week of Oct 26.*so far$/)
  })

  it('notes a first week that starts before the range', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: DAYS })} />)
    expect(hits(container)[0].getAttribute('aria-label')).toBe('Week of Sep 28, from Oct 1: 0 min, 0 strokes')
  })
})

describe('WeeklyBars labels, tooltip and table', () => {
  it('makes every bar focusable and shows a tooltip on focus and hover', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: DAYS })} />)
    for (const h of hits(container)) expect(h.getAttribute('tabindex')).toBe('0')
    expect(container.querySelector('.chart__tip')).toBeNull()
    fireEvent.focus(hits(container)[3])
    expect(container.querySelector('.chart__tip')!.textContent).toContain('3 h 11 min, 10,080 strokes')
    fireEvent.blur(hits(container)[3])
    expect(container.querySelector('.chart__tip')).toBeNull()
    fireEvent.mouseEnter(hits(container)[4])
    expect(container.querySelector('.chart__tip')!.textContent).toContain('Week of Oct 26')
  })

  it('has a table of the same weeks in the same order with the same numbers', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: DAYS })} />)
    const rows = Array.from(container.querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(hits(container).length)
    rows.forEach((row, i) => {
      const cells = Array.from(row.querySelectorAll('td')).map((c) => c.textContent)
      const label = hits(container)[i].getAttribute('aria-label')!
      expect(label).toContain(cells[0]) // time
      expect(label).toContain(`${cells[1]} strokes`)
    })
    expect(rows.map((r) => r.querySelectorAll('td')[0].textContent)).toEqual([
      '0 min',
      '0 min',
      '0 min',
      '3 h 11 min',
      '4 h 36 min',
    ])
    expect(container.querySelector('table caption')!.textContent).toBeTruthy()
    expect(container.querySelector('details > summary')!.textContent).toBe('Show the numbers')
  })

  it('summarises the drawing', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: DAYS })} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Bar chart of practice time per week, 5 weeks, from 0 min to 4 h 36 min')
  })
})

describe('WeeklyBars title and empty state', () => {
  it('has the title, the all modes suffix and a one-line explanation', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: DAYS })} />)
    const heading = screen.getByRole('heading', { level: 2, name: 'Practice time per week' })
    expect(container.querySelector('section')!.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(container.querySelector('.panel__scope')!.textContent).toBe('all modes')
    expect(
      screen.getByText('Time practiced each week (Monday to Sunday), with the strokes under each bar.'),
    ).toBeTruthy()
  })

  it('says so when nothing was practiced in the range', () => {
    const { container } = render(<WeeklyBars data={ready({ stats: [] })} />)
    expect(screen.getByText('No practice in this range yet.')).toBeTruthy()
    expect(container.querySelector('svg')).toBeNull()
  })
})
