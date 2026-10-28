// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { WpmByDay } from '../../../src/ui/progress/WpmByDay.tsx'
import { badNumbers, q, ready } from './fixtures.ts'

afterEach(cleanup)

const THREE = [q('2026-10-14', 3, 90, 17), q('2026-10-20', 2, 60, 8), q('2026-10-23', 3, 90, 14)]

const dotsOf = (c: Element): HTMLElement[] => Array.from(c.querySelectorAll<HTMLElement>('g.chart__hit'))
const cy = (g: Element): number => Number(g.querySelector('circle.chart__dot')!.getAttribute('cy'))
const cx = (g: Element): number => Number(g.querySelector('circle.chart__dot')!.getAttribute('cx'))
const baseline = (c: Element): number => Number(c.querySelector('line[data-value="0"]')!.getAttribute('y1'))
const lineOf = (c: Element): SVGPathElement | null => c.querySelector('path.chart__line')
const trendOf = (c: Element): SVGPathElement | null => c.querySelector('path.chart__trend')
const tickTexts = (c: Element): string[] =>
  Array.from(c.querySelectorAll('text.chart__tick-y')).map((t) => t.textContent ?? '')

describe('WpmByDay dots, line and trend', () => {
  it('draws one dot per practiced day and a line and a trend for three days', () => {
    const { container } = render(<WpmByDay data={ready({ days: THREE })} />)
    expect(dotsOf(container)).toHaveLength(3)
    expect(lineOf(container)).not.toBeNull()
    const trend = trendOf(container)!
    expect(trend).not.toBeNull()
    expect(trend.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(trend.getAttribute('d')!.match(/[ML]/g)).toHaveLength(3)
  })

  it('draws one dot and no line and no trend for a single practiced day', () => {
    const { container } = render(<WpmByDay data={ready({ days: [q('2026-10-23', 3, 90, 14)] })} />)
    expect(dotsOf(container)).toHaveLength(1)
    expect(lineOf(container)).toBeNull()
    expect(trendOf(container)).toBeNull()
  })

  it('draws a line but no trend for two practiced days', () => {
    const { container } = render(<WpmByDay data={ready({ days: THREE.slice(0, 2) })} />)
    expect(dotsOf(container)).toHaveLength(2)
    expect(lineOf(container)).not.toBeNull()
    expect(trendOf(container)).toBeNull()
  })

  it('counts only days with a wpm and words: null and zero-word days are skipped (and so is their trend)', () => {
    const days = [
      q('2026-10-14', 3, 90, 17),
      q('2026-10-15', 1, 0, 12),
      q('2026-10-16', 1, 30, null),
      q('2026-10-20', 2, 60, 8),
    ]
    const { container } = render(<WpmByDay data={ready({ days })} />)
    expect(dotsOf(container)).toHaveLength(2)
    expect(trendOf(container)).toBeNull()
    expect(within(container as HTMLElement).queryByRole('img', { name: /Oct 15|Oct 16/ })).toBeNull()
  })

  it('puts the dots in date order from left to right, whatever the order of the data', () => {
    const { container } = render(<WpmByDay data={ready({ days: [THREE[2], THREE[0], THREE[1]] })} />)
    const xs = dotsOf(container).map(cx)
    expect(xs[0]).toBeLessThan(xs[1])
    expect(xs[1]).toBeLessThan(xs[2])
    expect(dotsOf(container).map((g) => g.getAttribute('aria-label')!.slice(0, 6))).toEqual(['Oct 14', 'Oct 20', 'Oct 23'])
  })

  it('starts the y-axis at 0: a dot with double the wpm is at half the height, from the zero line', () => {
    const days = [q('2026-10-20', 3, 90, 8), q('2026-10-21', 3, 90, 16), q('2026-10-22', 3, 90, 4)]
    const { container } = render(<WpmByDay data={ready({ days })} />)
    const [d8, d16, d4] = dotsOf(container)
    const zero = baseline(container)
    expect(tickTexts(container)[0]).toBe('0')
    // the zero line is the floor of the drawing: just above the day labels, below every dot and inside the box
    const labelY = Number(container.querySelector('text.chart__tick-x')!.getAttribute('y'))
    expect(labelY - zero).toBeGreaterThan(5)
    expect(labelY - zero).toBeLessThan(30)
    for (const g of [d8, d16, d4]) expect(cy(g)).toBeLessThan(zero)
    expect(zero - cy(d16)).toBeCloseTo(2 * (zero - cy(d8)), 0)
    expect(zero - cy(d8)).toBeCloseTo(2 * (zero - cy(d4)), 0)
  })

  it('sets the top of the axis to the data maximum rounded up, so an outlier does not squash the rest', () => {
    const days = [q('2026-10-20', 3, 90, 10), q('2026-10-21', 3, 90, 12), q('2026-10-22', 3, 90, 90)]
    const { container } = render(<WpmByDay data={ready({ days })} />)
    const ticks = tickTexts(container).map(Number)
    expect(Math.max(...ticks)).toBe(100)
    const [low, , high] = dotsOf(container)
    const zero = baseline(container)
    expect(zero - cy(high)).toBeCloseTo(9 * (zero - cy(low)), -0.5) // 90 against 10, still in proportion
    expect(zero - cy(low)).toBeGreaterThan(5) // and the low dots are not on the floor
  })

  it('draws a flat line with finite coordinates when every day has the same wpm', () => {
    const days = [q('2026-10-20', 3, 90, 12), q('2026-10-21', 3, 90, 12), q('2026-10-22', 3, 90, 12)]
    const { container } = render(<WpmByDay data={ready({ days })} />)
    const ys = Array.from(lineOf(container)!.getAttribute('d')!.matchAll(/[ML][\d.]+ ([\d.]+)/g)).map((m) => m[1])
    expect(ys).toHaveLength(3)
    expect(new Set(ys).size).toBe(1)
    expect(badNumbers(container)).toEqual([])
  })
})

describe('WpmByDay words, labels and tooltips', () => {
  it('names the best day in text', () => {
    render(<WpmByDay data={ready({ days: THREE })} />)
    expect(screen.getByText('Best day: Oct 14, 17.0 wpm')).toBeTruthy()
  })

  it('names the best day when it is not the first or the last', () => {
    const days = [q('2026-10-14', 3, 90, 10), q('2026-10-20', 2, 60, 19.25), q('2026-10-23', 3, 90, 14)]
    render(<WpmByDay data={ready({ days })} />)
    expect(screen.getByText('Best day: Oct 20, 19.3 wpm')).toBeTruthy()
  })

  it('makes every dot focusable with a label of the day, the wpm and the runs', () => {
    const { container } = render(<WpmByDay data={ready({ days: THREE })} />)
    const dots = dotsOf(container)
    expect(dots.map((d) => d.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']) // one tab stop, arrows for the rest
    for (const d of dots) expect(d.getAttribute('role')).toBe('img')
    expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual([
      'Oct 14: 17.0 wpm over 3 runs',
      'Oct 20: 8.0 wpm over 2 runs',
      'Oct 23: 14.0 wpm over 3 runs',
    ])
    expect(screen.getByRole('img', { name: 'Oct 23: 14.0 wpm over 3 runs' })).toBeTruthy()
  })

  it('says 1 run for one run', () => {
    const days = [q('2026-10-14', 1, 30, 11), q('2026-10-15', 2, 60, 12)]
    const { container } = render(<WpmByDay data={ready({ days })} />)
    expect(dotsOf(container)[0].getAttribute('aria-label')).toBe('Oct 14: 11.0 wpm over 1 run')
  })

  it('shows a tooltip for the focused or hovered dot and hides it again', () => {
    const { container } = render(<WpmByDay data={ready({ days: THREE })} />)
    const [first, second] = dotsOf(container)
    expect(container.querySelector('.chart__tip')).toBeNull()
    fireEvent.focus(first)
    expect(container.querySelector('.chart__tip')!.textContent).toContain('Oct 14')
    expect(container.querySelector('.chart__tip')!.textContent).toContain('17.0 wpm over 3 runs')
    fireEvent.blur(first)
    expect(container.querySelector('.chart__tip')).toBeNull()
    fireEvent.mouseEnter(second)
    expect(container.querySelector('.chart__tip')!.textContent).toContain('8.0 wpm over 2 runs')
    fireEvent.mouseLeave(second)
    expect(container.querySelector('.chart__tip')).toBeNull()
  })

  it('summarises the chart in the label of the drawing', () => {
    const { container } = render(<WpmByDay data={ready({ days: THREE })} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('role')).toBe('group')
    expect(svg.getAttribute('aria-label')).toBe('Line chart of wpm by day, 3 days, from 8.0 to 17.0')
    expect(svg.getAttribute('viewBox')).toBeTruthy()
  })
})

describe('WpmByDay numbers table', () => {
  it('lists the same days, in the same order, with the same numbers as the dots', () => {
    const { container } = render(<WpmByDay data={ready({ days: [THREE[2], THREE[0], THREE[1]] })} />)
    const dots = dotsOf(container)
    const rows = Array.from(container.querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(dots.length)
    rows.forEach((row, i) => {
      const cells = Array.from(row.querySelectorAll('th, td')).map((c) => c.textContent)
      const label = dots[i].getAttribute('aria-label')!
      expect(label).toContain(cells[1]) // wpm
      expect(label).toContain(`over ${cells[2]} run`)
    })
    const rowsWpm = rows.map((r) => r.querySelectorAll('td')[0].textContent)
    expect(rowsWpm).toEqual(['17.0', '8.0', '14.0'])
    expect(container.querySelector('table caption')!.textContent).toBeTruthy()
  })

  it('adds the 7-day average column only when the trend is drawn', () => {
    const three = render(<WpmByDay data={ready({ days: THREE })} />)
    expect(three.container.querySelectorAll('thead th')).toHaveLength(5)
    cleanup()
    const two = render(<WpmByDay data={ready({ days: THREE.slice(0, 2) })} />)
    expect(two.container.querySelectorAll('thead th')).toHaveLength(4)
  })

  it('is behind a Show the numbers summary', () => {
    const { container } = render(<WpmByDay data={ready({ days: THREE })} />)
    expect(container.querySelector('details > summary')!.textContent).toBe('Show the numbers')
  })
})

describe('WpmByDay title, explanation and empty states', () => {
  it('is a labelled section with an h2 whose title follows the mode', () => {
    const titles = { free: 'Free-type wpm by day', drills: 'Drills and tests wpm by day', all: 'Wpm by day' } as const
    for (const mode of ['free', 'drills', 'all'] as const) {
      const { container } = render(<WpmByDay data={ready({ days: THREE, mode })} />)
      const heading = screen.getByRole('heading', { level: 2, name: titles[mode] })
      const section = container.querySelector('section')!
      expect(section.getAttribute('aria-labelledby')).toBe(heading.id)
      cleanup()
    }
  })

  it('explains in one plain line what it measures', () => {
    render(<WpmByDay data={ready({ days: THREE })} />)
    expect(screen.getByText('The average wpm of the runs you finished each day, weighted by words.')).toBeTruthy()
  })

  it('shows a dash and not enough data yet, and no chart, under 3 runs in the whole range', () => {
    const days = [q('2026-10-20', 1, 30, 12), q('2026-10-21', 1, 30, 14)]
    const { container } = render(<WpmByDay data={ready({ days })} />)
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText('not enough data yet')).toBeTruthy()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('table')).toBeNull()
  })

  it('draws the chart at exactly 3 runs spread over days', () => {
    const days = [q('2026-10-20', 1, 30, 12), q('2026-10-21', 1, 30, 14), q('2026-10-22', 1, 30, 13)]
    const { container } = render(<WpmByDay data={ready({ days })} />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(screen.queryByText('not enough data yet')).toBeNull()
  })

  it('says there are no finished runs when there are no days', () => {
    const { container } = render(<WpmByDay data={ready({ days: [] })} />)
    expect(screen.getByText('No finished runs in this range yet.')).toBeTruthy()
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('WpmByDay trend values', () => {
  // Days with gaps; the trend of a day is the plain mean of the daily wpm of the practiced days in the 7 calendar
  // days ending on it (the day and the 6 before), each day counting once.
  const GAPS = [
    q('2026-10-01', 1, 30, 10),
    q('2026-10-02', 1, 30, 12),
    q('2026-10-05', 1, 30, 8),
    q('2026-10-09', 1, 30, 14),
    q('2026-10-10', 1, 30, 16),
  ]
  const EXPECTED = [10, 11, (10 + 12 + 8) / 3, (8 + 14) / 2, (8 + 14 + 16) / 3]

  it('lists the 7-day trailing mean of the practiced days in the table', () => {
    const { container } = render(<WpmByDay data={ready({ days: GAPS })} />)
    const cells = Array.from(container.querySelectorAll('tbody tr')).map((r) => r.querySelectorAll('td')[3].textContent)
    expect(cells).toEqual(EXPECTED.map((v) => v.toFixed(1)))
    expect(container.querySelectorAll('thead th')[4].textContent).toBe('Trend (7-day average)')
  })

  it('draws the dashed path at those values, on the same axis as the dots', () => {
    const { container } = render(<WpmByDay data={ready({ days: GAPS })} />)
    const zero = baseline(container)
    const top = Number(container.querySelector('line[data-value="20"]')!.getAttribute('y1')) // the axis tops at 20
    const ys = Array.from(trendOf(container)!.getAttribute('d')!.matchAll(/[ML][\d.]+ ([\d.]+)/g)).map((m) => Number(m[1]))
    expect(ys).toHaveLength(5)
    ys.forEach((y, i) => expect(zero - y).toBeCloseTo(((zero - top) * EXPECTED[i]) / 20, 1))
  })

  it('says under the chart that the dashed line counts each day once', () => {
    render(<WpmByDay data={ready({ days: GAPS })} />)
    expect(screen.getByText('Dashed line: the 7-day average of the daily values (each day counts once).')).toBeTruthy()
  })
})

describe('WpmByDay date labels', () => {
  it('keep clear of each other when they carry a year (days over a year end, all time)', () => {
    const today = '2027-01-20'
    const days = ['2026-12-20', '2026-12-28', '2027-01-03', '2027-01-12', '2027-01-19'].map((d) => q(d, 2, 60, 12))
    const { container } = render(<WpmByDay data={ready({ days, range: 'all', today })} />)
    const labels = Array.from(container.querySelectorAll('text.chart__tick-x')).map((t) => ({
      x: Number(t.getAttribute('x')),
      w: (t.textContent ?? '').length * 8,
      text: t.textContent ?? '',
    }))
    expect(labels.some((l) => /20\d\d$/.test(l.text))).toBe(true)
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i].x - labels[i].w / 2, labels.map((l) => l.text).join(' ')).toBeGreaterThanOrEqual(labels[i - 1].x + labels[i - 1].w / 2)
    }
  })
})
