// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { RhythmView } from '../../../src/ui/progress/RhythmView.tsx'
import { even, strokesOf, testRow } from './rhythmFixtures.ts'
import { badNumbers } from './fixtures.ts'

afterEach(cleanup)

const view = (gaps: number[], test = testRow(), correct?: (i: number) => boolean) =>
  render(<RhythmView test={test} strokes={strokesOf(gaps, { correct })} />)

/** The text of the figure whose label is `name`. */
function figure(c: Element, name: string): string {
  const dt = Array.from(c.querySelectorAll('dt')).find((d) => d.textContent === name)
  expect(dt, `figure ${name}`).toBeTruthy()
  return dt!.parentElement!.textContent!.slice(name.length)
}
const strip = (c: Element): Element => c.querySelector('.rhythm__scroll svg')!
const hits = (c: Element): HTMLElement[] => Array.from(strip(c).querySelectorAll<HTMLElement>('g.chart__hit'))
const bars = (c: Element): Element[] => Array.from(strip(c).querySelectorAll('rect.rhythm__bar'))
const stallBars = (c: Element): Element[] => Array.from(strip(c).querySelectorAll('rect.rhythm__bar--stall'))
const breaks = (c: Element): Element[] => Array.from(strip(c).querySelectorAll('.rhythm__break'))
const tabStops = (c: Element): number[] => hits(c).flatMap((p, i) => (p.getAttribute('tabindex') === '0' ? [i] : []))
const openNumbers = (details: Element): void => {
  ;(details as HTMLDetailsElement).open = true
  fireEvent(details, new Event('toggle'))
}
const stripNumbers = (c: Element): Element => c.querySelector('.rhythm__strip details')!

const CHAPTER_NOTE =
  "A chapter test shows each word three times in a row. The pause before a word's first showing includes reading time, and the stalls and the steadiness count it, so compare this score with other chapter tests, not with free type."

describe('RhythmView: the chapter-test note', () => {
  it('explains the three showings under the four figures of a chapter test', () => {
    const { container } = view(even(60), testRow({ mode: 'chapter-test' }))
    const note = Array.from(container.querySelectorAll('p')).filter((p) => p.textContent === CHAPTER_NOTE)
    expect(note).toHaveLength(1)
    const figures = container.querySelector('.rhythm__figures')!
    expect(figures.compareDocumentPosition(note[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(note[0].compareDocumentPosition(container.querySelector('.rhythm__strip')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is not shown for a free run or any other mode', () => {
    for (const mode of ['free', 'section', 'stage0'] as const) {
      const { container, unmount } = view(even(60), testRow({ mode }))
      expect(container.textContent).not.toContain('shows each word three times')
      unmount()
    }
  })
})

describe('RhythmView: the four figures', () => {
  it('scores an even run as steady, with no stalls and a typical gap of 0.60 s', () => {
    const { container } = view(even(60))
    const steadiness = figure(container, 'Steadiness')
    expect(Number(/^(\d+) \/ 100/.exec(steadiness)![1])).toBeGreaterThanOrEqual(95)
    expect(steadiness).toContain('How evenly your strokes were spaced. Higher is steadier.')
    expect(figure(container, 'Stalls')).toMatch(/^0/)
    expect(figure(container, 'Stalls')).toContain('Pauses much longer than your usual (more than 2.5 times, and over 1 second).')
    expect(figure(container, 'Typical gap')).toMatch(/^0\.60 s/)
    expect(figure(container, 'Typical gap')).toContain('The middle of your pauses between strokes.')
    expect(figure(container, 'Start vs finish')).toContain('Last quarter against the first, estimated.')
  })

  it('counts one stall for one 4 s gap and does not count a break as a stall', () => {
    const stalled = view(even(60).map((g, i) => (i === 20 ? 4000 : g)))
    expect(figure(stalled.container, 'Stalls')).toMatch(/^1/)
    stalled.unmount()
    const broken = view(even(60).map((g, i) => (i === 20 ? 12_000 : g)))
    expect(figure(broken.container, 'Stalls')).toMatch(/^0/)
  })

  it('shows a dash and why when there are too few strokes to score', () => {
    const { container } = view(even(6))
    expect(figure(container, 'Steadiness')).toMatch(/^—/)
    expect(figure(container, 'Steadiness')).toContain('not enough strokes to score')
    expect(container.textContent).toContain('Rhythm needs at least 10 strokes to be scored.')
  })

  it('does not show the too-few note for a scored run', () => {
    const { container } = view(even(60))
    expect(container.textContent).not.toContain('Rhythm needs at least 10 strokes')
  })

  it('says why when a long enough run has no rhythm to score (all strokes at the same instant)', () => {
    const strokes = strokesOf(even(20)).map((s) => ({ ...s, tsMs: 5, latencyMs: 0 }))
    const { container } = render(<RhythmView test={testRow()} strokes={strokes} />)
    expect(container.textContent).not.toContain('Rhythm needs at least 10 strokes')
    expect(container.textContent).toContain('Rhythm could not be scored for this run.')
    expect(badNumbers(container)).toEqual([])
  })

  it('says there are no strokes for a run without any', () => {
    const { container } = view([])
    expect(container.textContent).toContain('No strokes recorded for this run.')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('shows start vs finish as a signed wpm difference, and a dash when a quarter is unknown', () => {
    const speedingUp = view([...even(30, 900), ...even(30, 450)], testRow({ meta: { elapsedMs: 40_000 }, wpm: 20 }))
    expect(figure(speedingUp.container, 'Start vs finish')).toMatch(/^\+\d+\.\d wpm/)
    speedingUp.unmount()
    const slowingDown = view([...even(30, 450), ...even(30, 900)], testRow({ meta: { elapsedMs: 40_000 }, wpm: 20 }))
    expect(figure(slowingDown.container, 'Start vs finish')).toMatch(/^-\d+\.\d wpm/)
    slowingDown.unmount()
    const short = view(even(3))
    expect(figure(short.container, 'Start vs finish')).toMatch(/^—/)
  })

  it('uses the stored words for the quarters (a run with no words shows a dash)', () => {
    const { container } = view([...even(30, 900), ...even(30, 450)], testRow({ meta: {}, wpm: 20 }))
    expect(figure(container, 'Start vs finish')).toMatch(/^—/)
  })
})

describe('RhythmView: the stroke strip', () => {
  it('draws one bar per stroke, none of them a stall, for an even run', () => {
    const { container } = view(even(60))
    expect(bars(container)).toHaveLength(60)
    expect(hits(container)).toHaveLength(60)
    expect(stallBars(container)).toHaveLength(0)
    expect(breaks(container)).toHaveLength(0)
    expect(hits(container)[1].getAttribute('aria-label')).toBe('Stroke 2: 0.6 s pause')
  })

  it('draws exactly one stall bar for one 4 s gap, with the word stall in its label', () => {
    const { container } = view(even(60).map((g, i) => (i === 13 ? 3200 : g)))
    expect(bars(container)).toHaveLength(60)
    expect(stallBars(container)).toHaveLength(1)
    const stalled = hits(container).filter((h) => h.querySelector('.rhythm__bar--stall'))
    expect(stalled).toHaveLength(1)
    expect(stalled[0].getAttribute('aria-label')).toBe('Stroke 14: 3.2 s pause, stall')
    expect(hits(container).filter((h) => /stall/.test(h.getAttribute('aria-label')!))).toHaveLength(1)
  })

  it('draws a break as a dotted marker, not a bar, labelled break', () => {
    const { container } = view(even(60).map((g, i) => (i === 29 ? 12_000 : g)))
    expect(breaks(container)).toHaveLength(1)
    expect(bars(container)).toHaveLength(59)
    expect(hits(container)).toHaveLength(60)
    expect(hits(container)[29].getAttribute('aria-label')).toBe('Stroke 30: 12 s pause, break')
    expect(hits(container)[29].querySelector('rect.rhythm__bar')).toBeNull()
    expect(hits(container)[29].querySelector('.rhythm__break')).not.toBeNull()
  })

  it('draws the break as a dotted line across the whole chart with the word break over it', () => {
    const { container } = view(even(120).map((g, i) => (i === 70 ? 15_000 : g)))
    const line = breaks(container)[0]
    const plot = Number(line.getAttribute('y1')) - Number(line.getAttribute('y2'))
    expect(plot).toBeGreaterThanOrEqual(180) // the whole height of the plot, not a stub
    expect(line.getAttribute('stroke-dasharray')).toBeTruthy()
    const words = Array.from(strip(container).querySelectorAll('.rhythm__breakword')).map((t) => t.textContent)
    expect(words).toEqual(['break'])
    // the tooltip and the label still say break
    fireEvent.focus(hits(container)[70])
    expect(strip(container).querySelector('.chart__tip')!.textContent).toContain('break')
  })

  it('writes the word break over a dotted line only when the previous word is not too close', () => {
    const { container } = view(even(120).map((g, i) => (i === 70 || i === 71 ? 15_000 : g)))
    expect(breaks(container)).toHaveLength(2)
    expect(strip(container).querySelectorAll('.rhythm__breakword')).toHaveLength(1)
  })

  it('draws the strip for a run with too few strokes to score', () => {
    const { container } = view(even(6))
    expect(bars(container)).toHaveLength(6)
  })

  it("reads the first stroke's gap from its own latency", () => {
    const { container } = view([4000, ...even(59)])
    expect(hits(container)[0].getAttribute('aria-label')).toBe('Stroke 1: 4.0 s pause, stall')
    expect(stallBars(container)).toHaveLength(1)
  })

  it('draws the dashed typical-gap line with its label, and y ticks in seconds', () => {
    const { container } = view(even(60, 620))
    const line = strip(container).querySelector('line.rhythm__typical')
    expect(line).not.toBeNull()
    expect(line!.getAttribute('stroke-dasharray') ?? '').not.toBe('')
    expect(container.querySelector('.rhythm__key')!.textContent).toContain('typical 0.62 s')
    const ticks = Array.from(container.querySelectorAll('.rhythm__stripbox .chart__tick-y')).map((t) => t.textContent)
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    expect(ticks.every((t) => / s$/.test(t!))).toBe(true)
  })

  it('has an x axis of stroke numbers, thinned', () => {
    const { container } = view(even(60))
    const labels = Array.from(strip(container).querySelectorAll('.chart__tick-x')).map((t) => t.textContent)
    expect(labels[0]).toBe('1')
    expect(labels.length).toBeGreaterThanOrEqual(2)
    expect(labels.length).toBeLessThan(20)
    expect(labels.every((t) => /^\d+$/.test(t!))).toBe(true)
  })

  it('explains the marks in words, not colour alone', () => {
    const { container } = view(even(60).map((g, i) => (i === 13 ? 3200 : i === 40 ? 12_000 : g)))
    const text = container.querySelector('.rhythm__strip')!.textContent!
    expect(text).toContain('1 stall')
    expect(text).toContain('1 break')
  })

  it('caps the drawn height so one huge gap does not flatten the other bars, and marks the capped bar', () => {
    const { container } = view(even(60).map((g, i) => (i === 30 ? 9000 : g)))
    const heights = bars(container).map((b) => Number(b.getAttribute('height')))
    const tallest = Math.max(...heights)
    const plot = 190 // the drawn height of the plot
    expect(tallest).toBeLessThanOrEqual(plot)
    const others = bars(container).filter((_, i) => i !== 30).map((b) => Number(b.getAttribute('height')))
    expect(Math.min(...others)).toBeGreaterThan(plot * 0.2)
    expect(strip(container).querySelectorAll('.rhythm__capmark')).toHaveLength(1)
    expect(hits(container)[30].querySelector('.rhythm__capmark')).not.toBeNull()
    expect(hits(container)[30].getAttribute('aria-label')).toBe('Stroke 31: 9.0 s pause, stall')
  })

  it('draws no cap marker when no bar is capped', () => {
    const { container } = view(even(60).map((g, i) => (i % 10 === 5 ? 3000 : g)))
    expect(stallBars(container)).toHaveLength(6)
    expect(strip(container).querySelectorAll('.rhythm__capmark')).toHaveLength(0)
  })

  it('is a group with ONE tab stop, moved with the arrow keys, Home and End', () => {
    const { container } = view(even(60).map((g, i) => (i === 13 ? 3200 : g)))
    expect(tabStops(container)).toEqual([0])
    hits(container)[0].focus()
    fireEvent.keyDown(hits(container)[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(hits(container)[1])
    expect(tabStops(container)).toEqual([1])
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(hits(container)[59])
    expect(tabStops(container)).toEqual([59])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(hits(container)[59])
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(tabStops(container)).toEqual([0])
    expect(container.querySelectorAll('.rhythm__strip [tabindex="0"]')).toHaveLength(1)
  })

  it('shows a note when a bar is focused, saying stall for a stall', () => {
    const { container } = view(even(60).map((g, i) => (i === 13 ? 3200 : g)))
    fireEvent.focus(hits(container)[13])
    const tip = strip(container).querySelector('.chart__tip')
    expect(tip).not.toBeNull()
    expect(tip!.textContent).toContain('Stroke 14')
    expect(tip!.textContent).toContain('stall')
  })

  it('has a table with one row per stroke (stroke, pause in seconds, kind), built when opened', () => {
    const { container } = view(even(60).map((g, i) => (i === 13 ? 3200 : i === 40 ? 12_000 : g)))
    const details = stripNumbers(container)
    expect(details.querySelector('table')).toBeNull()
    openNumbers(details)
    const rows = Array.from(details.querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(60)
    expect(Array.from(details.querySelectorAll('thead th')).map((h) => h.textContent)).toEqual(['Stroke', 'Pause (s)', 'Kind'])
    expect(Array.from(rows[13].children).map((c) => c.textContent)).toEqual(['14', '3.20', 'stall'])
    expect(Array.from(rows[40].children).map((c) => c.textContent)).toEqual(['41', '12.00', 'break'])
    expect(Array.from(rows[0].children).map((c) => c.textContent)).toEqual(['1', '0.60', 'normal'])
  })
})

const gapsOf = (n: number): number[] => Array.from({ length: n }, (_, i) => 400 + ((i * 37) % 500))
const stripBox = (c: Element): Element => c.querySelector('.rhythm__stripbox')!

describe('RhythmView: many strokes', () => {
  for (const n of [150, 300]) {
    it(`draws ${n} strokes, one bar each, scaled to the container, with no NaN or Infinity`, () => {
      const { container } = view(gapsOf(n))
      expect(bars(container)).toHaveLength(n)
      expect(hits(container)).toHaveLength(n)
      expect(tabStops(container)).toEqual([0])
      expect(badNumbers(container)).toEqual([])
      const svg = strip(container)
      expect((svg.parentElement as HTMLElement).style.overflowX).toBe('auto')
      expect(svg.getAttribute('width')).toBe('100%')
      expect(svg.getAttribute('viewBox')).toBe('0 0 560 240')
      expect(svg.getAttribute('style')).toBeNull() // nothing sets a pixel width: the container decides
      expect(svg.classList.contains('rhythm__plot--wide')).toBe(false)
      expect(stripBox(container).querySelector('.rhythm__yaxis')).toBeNull() // the axis is inside the drawing
      expect(svg.querySelectorAll('.chart__tick-y').length).toBeGreaterThanOrEqual(2)
    })
  }

  for (const n of [301, 800]) {
    it(`draws ${n} strokes at 3 units each in a scrolling box, with its own pixel width and a seconds axis beside it`, () => {
      const { container } = view(gapsOf(n))
      expect(bars(container)).toHaveLength(n)
      expect(hits(container)).toHaveLength(n)
      expect(tabStops(container)).toEqual([0])
      expect(badNumbers(container)).toEqual([])
      const svg = strip(container)
      const scroller = svg.parentElement as HTMLElement
      expect(scroller.classList.contains('rhythm__scroll')).toBe(true)
      expect(scroller.style.overflowX).toBe('auto')
      const width = Number(svg.getAttribute('width'))
      expect(width).toBe(6 + 12 + n * 3)
      expect(svg.getAttribute('viewBox')).toBe(`0 0 ${width} 240`)
      // the generic .chart rule says width: 100%, which beats the attribute: the drawing must say its width in style
      const style = (svg as HTMLElement).style
      expect(style.width).toBe(`${width}px`)
      expect(style.maxWidth).toBe('none')
      expect(svg.classList.contains('rhythm__plot--wide')).toBe(true)
      expect(Math.min(...bars(container).map((b) => Number(b.getAttribute('width'))))).toBeGreaterThanOrEqual(1.5)
      // the seconds axis is a drawing of its own beside the scrolling box, not inside it
      const axis = stripBox(container).querySelector('.rhythm__yaxis')!
      expect(axis).not.toBeNull()
      expect(axis.parentElement).toBe(stripBox(container))
      expect(scroller.contains(axis)).toBe(false)
      expect(Array.from(axis.querySelectorAll('.chart__tick-y')).every((t) => / s$/.test(t.textContent!))).toBe(true)
      expect(svg.querySelectorAll('.chart__tick-y')).toHaveLength(0)
      expect(svg.querySelectorAll('line.chart__grid').length).toBeGreaterThanOrEqual(2)
      // same vertical scale: the axis and the plot are both 240 tall
      expect(axis.getAttribute('viewBox')).toMatch(/ 240$/)
    })
  }

  it('moves on to the first stroke past the boundary at 301 and still has one tab stop', () => {
    const { container } = view(gapsOf(301))
    hits(container)[0].focus()
    fireEvent.keyDown(hits(container)[0], { key: 'End' })
    expect(document.activeElement).toBe(hits(container)[300])
    expect(tabStops(container)).toEqual([300])
  })

  it('keeps the tooltip of a far-right bar inside the drawing', () => {
    const gaps = Array.from({ length: 800 }, (_, i) => 400 + ((i * 37) % 500))
    const { container } = view(gaps)
    fireEvent.focus(hits(container)[799])
    const box = strip(container).querySelector('.chart__tip rect')!
    const right = Number(box.getAttribute('x')) + Number(box.getAttribute('width'))
    expect(right).toBeLessThanOrEqual(Number(strip(container).getAttribute('width')))
  })

  it('draws a run of nothing but breaks without numbers gone wrong', () => {
    const { container } = view(even(12, 30_000))
    expect(bars(container)).toHaveLength(0)
    expect(breaks(container)).toHaveLength(12)
    expect(badNumbers(container)).toEqual([])
  })

  it('stays finite for odd data (bad timestamps, no wpm, meta that is not an object)', () => {
    const strokes = strokesOf(even(30)).map((s, i) => ({ ...s, tsMs: i % 5 === 0 ? Number.NaN : s.tsMs, latencyMs: i % 7 === 0 ? -5 : s.latencyMs }))
    const { container } = render(<RhythmView test={testRow({ wpm: null, accuracy: null, meta: 'weird' })} strokes={strokes} />)
    expect(badNumbers(container)).toEqual([])
  })
})

describe('RhythmView: the quarters', () => {
  const quarterLabels = (c: Element): string[] => Array.from(c.querySelectorAll('.rhythm__quarters .chart__tick-x')).map((t) => t.textContent!)

  it('draws four labelled bars with value labels, from 0, titled as estimated wpm', () => {
    const { container } = view(even(60))
    const quarters = container.querySelector('.rhythm__quarters')!
    expect(quarters.textContent).toContain('Speed through the run (estimated wpm)')
    expect(quarterLabels(container)).toEqual(['1st', '2nd', '3rd', '4th'])
    expect(quarters.querySelectorAll('rect.rhythm__qbar')).toHaveLength(4)
    expect(Array.from(quarters.querySelectorAll('.rhythm__qvalue')).map((t) => t.textContent)).toEqual(['20.0', '20.0', '20.0', '20.0'])
    const zero = quarters.querySelector('.chart__grid[data-value="0"]')
    expect(zero).not.toBeNull()
    expect(Array.from(quarters.querySelectorAll('.chart__hit')).map((g) => g.getAttribute('aria-label'))[0]).toBe('1st quarter: 20.0 wpm, estimated')
  })

  it("shows the run's stored wpm beside them and the note that they are estimates", () => {
    const { container } = view(even(60), testRow({ wpm: 15.84, meta: { elapsedMs: 45_000 } }))
    const text = container.querySelector('.rhythm__quarters')!.textContent!
    expect(text).toContain('Whole run: 15.8 wpm (counted by the app)')
    expect(text).toContain("The quarters share the run's words across the run in proportion to your correct strokes, so they are estimates.")
  })

  it('says there are not enough strokes when the quarters are unknown or the run has no words', () => {
    const few = view(even(3))
    expect(few.container.querySelector('.rhythm__quarters')!.textContent).toContain('not enough strokes to show the quarters')
    expect(few.container.querySelector('rect.rhythm__qbar')).toBeNull()
    few.unmount()
    const noWords = view(even(60), testRow({ meta: {}, accuracy: null }))
    expect(noWords.container.querySelector('.rhythm__quarters')!.textContent).toContain('not enough strokes to show the quarters')
    expect(noWords.container.querySelector('rect.rhythm__qbar')).toBeNull()
  })

  it('has its own table with a row per quarter', () => {
    const { container } = view(even(60))
    const details = container.querySelector('.rhythm__quarters details')!
    openNumbers(details)
    const rows = Array.from(details.querySelectorAll('tbody tr')).map((r) => Array.from(r.children).map((c) => c.textContent))
    expect(rows).toHaveLength(4)
    expect(rows[0][0]).toBe('1st')
    expect(rows[0][1]).toBe('20.0')
  })

  it('the quarters chart has one tab stop of its own', () => {
    const { container } = view(even(60))
    expect(container.querySelectorAll('.rhythm__quarters [tabindex="0"]')).toHaveLength(1)
  })
})

describe('RhythmView: a quarter with no data', () => {
  it('shows a dash in its slot and in its label, not an empty slot', () => {
    // no correct stroke in the third quarter (strokes 30 to 44 of 60)
    const { container } = view(even(60), testRow(), (i) => !(i >= 30 && i <= 44))
    const quarters = container.querySelector('.rhythm__quarters')!
    const groups = Array.from(quarters.querySelectorAll('g.chart__hit'))
    expect(groups).toHaveLength(4)
    expect(groups[2].getAttribute('aria-label')).toBe('3rd quarter: — (not enough strokes)')
    expect(groups[2].querySelector('rect.rhythm__qbar')).toBeNull()
    expect(groups[2].querySelector('.rhythm__qnone')!.textContent).toBe('—')
    expect(groups[0].querySelector('rect.rhythm__qbar')).not.toBeNull()
    expect(groups[0].querySelector('.rhythm__qnone')).toBeNull()
    expect(quarters.querySelectorAll('rect.rhythm__qbar')).toHaveLength(3)
  })
})

// jsdom lays nothing out, so a stylesheet that squeezes the wide strip back to its container cannot be seen in the other
// tests (that is how the first version shipped: `.chart { width: 100% }` beat the svg's width attribute). These read the
// rules themselves; the measured widths in a real browser are in the task report.
describe('progress.css: the rules the long strip depends on', () => {
  const css = readFileSync('src/ui/progress.css', 'utf8') // vitest runs from the project root
  const body = (selector: string): string => {
    const at = css.indexOf(`${selector} {`)
    return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
  }

  it('releases the wide drawing from the generic .chart width, with a more specific selector placed after it', () => {
    const generic = body('.chart')
    expect(generic).toMatch(/width:\s*100%/) // the rule being overridden
    expect(generic).toMatch(/max-width:\s*40rem/)
    const wide = body('.rhythm__strip .chart.rhythm__plot--wide')
    expect(wide).toMatch(/max-width:\s*none/)
    expect(wide).toMatch(/margin-inline:\s*0/)
    // more specific than `.rhythm__strip .chart` (which caps the strip at a reading width) and written after it
    expect(css.indexOf('.rhythm__strip .chart.rhythm__plot--wide {')).toBeGreaterThan(css.indexOf('.rhythm__strip .chart {'))
    expect(css.indexOf('.rhythm__strip .chart {')).toBeGreaterThan(css.indexOf('\n.chart {'))
  })

  it('lets the strip use the width of the panel up to a reading width', () => {
    expect(body('.rhythm__strip .chart')).toMatch(/max-width:\s*44rem/)
  })

  it('keeps the scrolling box shrinkable beside the axis, in a row', () => {
    expect(body('.rhythm__stripbox')).toMatch(/display:\s*flex/)
    expect(body('.rhythm__scroll')).toMatch(/min-width:\s*0/)
    expect(body('.rhythm__yaxis')).toMatch(/flex:\s*none/)
  })

  it('draws stalls with the --stall token, defined once in :root of reader.css with the keyboard miss red', () => {
    const reader = readFileSync('src/ui/reader.css', 'utf8')
    const board = readFileSync('src/ui/board.css', 'utf8')
    const stall = /:root\s*\{[^}]*--stall:\s*(#[0-9a-f]{6})/.exec(reader)?.[1]
    expect(stall).toBeTruthy()
    expect(stall).toBe(/--miss:\s*(#[0-9a-f]{6})/.exec(board)?.[1])
    expect(body('.rhythm__bar--stall')).toMatch(/fill:\s*var\(--stall\)/)
    expect(css).not.toMatch(/--stall:/) // not redefined here
  })
})
