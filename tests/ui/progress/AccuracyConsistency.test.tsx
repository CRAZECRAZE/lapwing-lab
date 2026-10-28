// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { AccuracyConsistency } from '../../../src/ui/progress/AccuracyConsistency.tsx'
import { q, ready } from './fixtures.ts'

afterEach(cleanup)

// Accuracy in 0..1, steadiness 0..100.
const DAYS = [
  q('2026-10-20', 3, 90, 12, 0.925, 70),
  q('2026-10-22', 2, 60, 13, 0.946, 78),
  q('2026-10-23', 3, 90, 14, 0.952, 64),
]
const hits = (c: Element): HTMLElement[] => Array.from(c.querySelectorAll<HTMLElement>('g.chart__hit'))
const leftTicks = (c: Element): string[] =>
  Array.from(c.querySelectorAll('text.chart__tick-y')).map((t) => t.textContent ?? '')
const rightTicks = (c: Element): string[] =>
  Array.from(c.querySelectorAll('text.chart__tick-y2')).map((t) => t.textContent ?? '')

/** Fourteen days to the 28th, so five of them can carry a steadiness for the band. */
const run = (dates: string[], steadiness: number[]) =>
  dates.map((d, i) => q(d, 1, 30, 12, 0.9, steadiness[i]))

describe('AccuracyConsistency drawing', () => {
  it('draws an accuracy line, a bar for each day with a steadiness, and a dot for each day with an accuracy', () => {
    const days = [...DAYS, q('2026-10-24', 1, 30, 12, 0.9, null)]
    const { container } = render(<AccuracyConsistency data={ready({ days })} />)
    expect(container.querySelector('path.chart__line')).not.toBeNull()
    expect(container.querySelectorAll('rect.chart__bar')).toHaveLength(3)
    expect(container.querySelectorAll('circle.chart__dot')).toHaveLength(4)
  })

  it('draws no accuracy line for one day, and still a dot', () => {
    const { container } = render(
      <AccuracyConsistency data={ready({ days: [q('2026-10-23', 3, 90, 14, 0.95, 70)] })} />,
    )
    expect(container.querySelector('path.chart__line')).toBeNull()
    expect(container.querySelectorAll('circle.chart__dot')).toHaveLength(1)
  })

  it('scales the bars with the steadiness from a zero floor: double the steadiness, double the height', () => {
    const days = [q('2026-10-20', 3, 90, 12, 0.9, 40), q('2026-10-21', 3, 90, 12, 0.9, 80), q('2026-10-22', 3, 90, 12, 0.9, 20)]
    const { container } = render(<AccuracyConsistency data={ready({ days })} />)
    const h = Array.from(container.querySelectorAll('rect.chart__bar')).map((r) => Number(r.getAttribute('height')))
    expect(h[1]).toBeCloseTo(2 * h[0], 0)
    expect(h[0]).toBeCloseTo(2 * h[2], 0)
  })

  it('uses an 80 to 100 axis when every day is at 80% or better, and says so', () => {
    const { container } = render(<AccuracyConsistency data={ready({ days: DAYS })} />)
    expect(leftTicks(container)).toEqual(['80%', '85%', '90%', '95%', '100%'])
    expect(rightTicks(container)).toEqual(['0', '25', '50', '75', '100'])
    expect(screen.getByText('Accuracy axis: 80% to 100%.')).toBeTruthy()
  })

  it('uses the 80 axis for exactly 80% and the 0 axis for 79.9%', () => {
    const at = (accuracy: number) =>
      ready({ days: [q('2026-10-20', 3, 90, 12, 0.9, 70), q('2026-10-21', 3, 90, 12, accuracy, 70), q('2026-10-22', 3, 90, 12, 0.95, 70)] })
    const exact = render(<AccuracyConsistency data={at(0.8)} />)
    expect(leftTicks(exact.container)[0]).toBe('80%')
    cleanup()
    const below = render(<AccuracyConsistency data={at(0.799)} />)
    expect(leftTicks(below.container)[0]).toBe('0%')
  })

  it('uses a 0 to 100 axis when any day is below 80%', () => {
    const days = [...DAYS, q('2026-10-24', 3, 90, 12, 0.71, 60)]
    const { container } = render(<AccuracyConsistency data={ready({ days })} />)
    expect(leftTicks(container)).toEqual(['0%', '25%', '50%', '75%', '100%'])
    expect(screen.queryByText(/Accuracy axis/)).toBeNull()
  })

  it('puts a higher accuracy higher on the page', () => {
    const { container } = render(<AccuracyConsistency data={ready({ days: DAYS })} />)
    const ys = Array.from(container.querySelectorAll('circle.chart__dot')).map((c) => Number(c.getAttribute('cy')))
    expect(ys[2]).toBeLessThan(ys[1])
    expect(ys[1]).toBeLessThan(ys[0])
  })
})

describe('AccuracyConsistency day-to-day band', () => {
  const FIVE = run(['2026-10-16', '2026-10-18', '2026-10-21', '2026-10-24', '2026-10-27'], [60, 82, 71, 90, 75])

  it('shows the band and states its minimum and maximum with five days in the last 14', () => {
    const { container } = render(<AccuracyConsistency data={ready({ days: FIVE })} />)
    expect(container.querySelector('rect.chart__band')).not.toBeNull()
    expect(screen.getByText('Over the last 14 days your steadiness ranged from 60 to 90')).toBeTruthy()
    expect(container.querySelector('tfoot')!.textContent).toContain('60 to 90')
  })

  it('shows no band with four days', () => {
    const { container } = render(<AccuracyConsistency data={ready({ days: FIVE.slice(0, 4) })} />)
    expect(container.querySelector('rect.chart__band')).toBeNull()
    expect(screen.queryByText(/ranged from/)).toBeNull()
    expect(container.querySelector('tfoot')).toBeNull()
  })

  it('counts only the 14 days that end today (Oct 15 to Oct 28)', () => {
    const days = run(['2026-10-10', '2026-10-12', '2026-10-14', '2026-10-24', '2026-10-27'], [10, 20, 30, 80, 90])
    const { container } = render(<AccuracyConsistency data={ready({ days })} />)
    expect(container.querySelector('rect.chart__band')).toBeNull()
    // the 15th is the first day inside the window
    const edge = run(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-24', '2026-10-27'], [50, 60, 70, 80, 90])
    cleanup()
    const again = render(<AccuracyConsistency data={ready({ days: edge })} />)
    expect(again.container.querySelector('rect.chart__band')).not.toBeNull()
    expect(screen.getByText('Over the last 14 days your steadiness ranged from 50 to 90')).toBeTruthy()
  })

  it('leaves out a day just before the 14 days: 4 days inside and one on Oct 14 is no band', () => {
    const days = run(['2026-10-14', '2026-10-15', '2026-10-20', '2026-10-24', '2026-10-27'], [5, 50, 60, 70, 80])
    const { container } = render(<AccuracyConsistency data={ready({ days })} />)
    expect(container.querySelector('rect.chart__band')).toBeNull()
    expect(screen.queryByText(/ranged from/)).toBeNull()
  })

  it('draws the band from the 5 days inside the window and not the day before it', () => {
    const days = run(
      ['2026-10-14', '2026-10-15', '2026-10-18', '2026-10-21', '2026-10-24', '2026-10-27'],
      [5, 50, 60, 70, 80, 90],
    )
    const { container } = render(<AccuracyConsistency data={ready({ days })} />)
    expect(container.querySelector('rect.chart__band')).not.toBeNull()
    expect(screen.getByText('Over the last 14 days your steadiness ranged from 50 to 90')).toBeTruthy()
    expect(container.querySelector('tfoot')!.textContent).toContain('50 to 90')
  })

  it('draws the band between the lowest and the highest bar top', () => {
    const { container } = render(<AccuracyConsistency data={ready({ days: FIVE })} />)
    const tops = Array.from(container.querySelectorAll('rect.chart__bar')).map((r) => Number(r.getAttribute('y')))
    const band = container.querySelector('rect.chart__band')!
    const y = Number(band.getAttribute('y'))
    expect(y).toBeCloseTo(Math.min(...tops), 0)
    expect(y + Number(band.getAttribute('height'))).toBeCloseTo(Math.max(...tops), 0)
  })
})

describe('AccuracyConsistency labels and table', () => {
  it('makes every day focusable with a label of its accuracy and steadiness', () => {
    const { container } = render(<AccuracyConsistency data={ready({ days: DAYS })} />)
    expect(hits(container).map((h) => h.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']) // one tab stop
    expect(hits(container).map((h) => h.getAttribute('aria-label'))).toEqual([
      'Oct 20: 92.5% accuracy, steadiness 70',
      'Oct 22: 94.6% accuracy, steadiness 78',
      'Oct 23: 95.2% accuracy, steadiness 64',
    ])
    expect(screen.getByRole('img', { name: 'Oct 22: 94.6% accuracy, steadiness 78' })).toBeTruthy()
  })

  it('leaves out the part a day does not have', () => {
    const days = [q('2026-10-20', 3, 90, 12, 0.9, null), q('2026-10-21', 3, 90, 12, null, 66), ...DAYS.slice(1)]
    const { container } = render(<AccuracyConsistency data={ready({ days })} />)
    const labels = hits(container).map((h) => h.getAttribute('aria-label'))
    expect(labels[0]).toBe('Oct 20: 90.0% accuracy')
    expect(labels[1]).toBe('Oct 21: steadiness 66')
  })

  it('shows a tooltip on focus and hover', () => {
    const { container } = render(<AccuracyConsistency data={ready({ days: DAYS })} />)
    fireEvent.focus(hits(container)[0])
    expect(container.querySelector('.chart__tip')!.textContent).toContain('92.5% accuracy, steadiness 70')
    fireEvent.blur(hits(container)[0])
    expect(container.querySelector('.chart__tip')).toBeNull()
    fireEvent.mouseEnter(hits(container)[1])
    expect(container.querySelector('.chart__tip')!.textContent).toContain('Oct 22')
  })

  it('has a table with the same days in the same order and the same numbers', () => {
    const { container } = render(<AccuracyConsistency data={ready({ days: [DAYS[2], DAYS[0], DAYS[1]] })} />)
    const rows = Array.from(container.querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(hits(container).length)
    rows.forEach((row, i) => {
      const cells = Array.from(row.querySelectorAll('td')).map((c) => c.textContent)
      const label = hits(container)[i].getAttribute('aria-label')!
      expect(label).toContain(cells[0]) // accuracy
      expect(label).toContain(`steadiness ${cells[1]}`)
    })
    expect(rows.map((r) => r.querySelector('td')!.textContent)).toEqual(['92.5%', '94.6%', '95.2%'])
  })

  it('summarises the drawing', () => {
    const { container } = render(<AccuracyConsistency data={ready({ days: DAYS })} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('role')).toBe('group')
    expect(svg.getAttribute('aria-label')).toBe(
      'Chart of accuracy and steadiness by day, 3 days, accuracy from 92.5% to 95.2%',
    )
  })
})

describe('AccuracyConsistency title, explanation and empty states', () => {
  it('has the title, with a muted suffix that follows the mode', () => {
    const scope = { free: 'free type', drills: 'drills and tests', all: 'all modes' } as const
    for (const mode of ['free', 'drills', 'all'] as const) {
      const { container } = render(<AccuracyConsistency data={ready({ days: DAYS, mode })} />)
      const heading = screen.getByRole('heading', { level: 2, name: 'Accuracy and consistency' })
      expect(container.querySelector('section')!.getAttribute('aria-labelledby')).toBe(heading.id)
      expect(container.querySelector('.panel__scope')!.textContent).toBe(scope[mode])
      cleanup()
    }
  })

  it('says under the chart that chapter tests read lower, in drills and everything modes only', () => {
    const text = 'Chapter tests show each word three times, so their steadiness reads lower than free type. Compare like with like.'
    for (const mode of ['drills', 'all'] as const) {
      const { container } = render(<AccuracyConsistency data={ready({ days: DAYS, mode })} />)
      const notes = Array.from(container.querySelectorAll('p')).filter((p) => p.textContent === text)
      expect(notes, mode).toHaveLength(1)
      expect(notes[0].classList.contains('panel__note')).toBe(true)
      expect(container.querySelector('svg')!.compareDocumentPosition(notes[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      cleanup()
    }
    const free = render(<AccuracyConsistency data={ready({ days: DAYS, mode: 'free' })} />)
    expect(free.container.textContent).not.toContain('Chapter tests show each word three times')
  })

  it('explains the line and the bars in one plain line', () => {
    render(<AccuracyConsistency data={ready({ days: DAYS })} />)
    expect(
      screen.getByText(
        'Line: first-try accuracy per day. Bars: how steady your stroke timing was (taller is steadier).',
      ),
    ).toBeTruthy()
  })

  it('shows a dash and not enough data yet under 3 runs', () => {
    const days = [q('2026-10-20', 1, 30, 12, 0.9, 70), q('2026-10-21', 1, 30, 12, 0.9, 70)]
    const { container } = render(<AccuracyConsistency data={ready({ days })} />)
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText('not enough data yet')).toBeTruthy()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('says there are no finished runs when there are no days', () => {
    render(<AccuracyConsistency data={ready({ days: [] })} />)
    expect(screen.getByText('No finished runs in this range yet.')).toBeTruthy()
  })
})
