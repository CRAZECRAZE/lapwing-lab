import type { ComponentChildren, JSX } from 'preact'
import { useState } from 'preact/hooks'
import { addDays } from '../../core/days.ts'
import { daysBetween } from '../../core/progressview.ts'
import type { RangeId } from '../../core/progressview.ts'
import { dateTickOffsets, labelsThatFit, num, scaleLinear, shortDate, textWidth } from '../../core/chartmath.ts'

// The drawing is a fixed 560 by 240 box that the browser scales to the width of its container.
export const VIEW_W = 560
export const VIEW_H = 240

export type Margins = { l: number; r: number; t: number; b: number }
export type Box = { left: number; right: number; top: number; bottom: number }

export const MARGINS: Margins = { l: 46, r: 20, t: 16, b: 30 }

export function boxOf(m: Margins): Box {
  return { left: m.l, right: VIEW_W - m.r, top: m.t, bottom: VIEW_H - m.b }
}

/** A panel: its titled section, the muted scope beside the title, and the one line saying what it measures. */
export function Panel({
  id,
  title,
  scope,
  line,
  children,
}: {
  id: string
  title: string
  scope?: string
  line: string
  children: ComponentChildren
}): JSX.Element {
  return (
    <section class="panel" aria-labelledby={id}>
      <div class="panel__head">
        <h2 id={id} class="panel__title">
          {title}
        </h2>
        {scope && <span class="panel__scope">{scope}</span>}
      </div>
      <p class="panel__line">{line}</p>
      {children}
    </section>
  )
}

/** A figure that rests on too few runs: a dash and why. */
export function NotEnough(): JSX.Element {
  return (
    <>
      <p class="panel__value">—</p>
      <p class="panel__note">not enough data yet</p>
    </>
  )
}

/** The drawing: scales with its container. A group with a summary label, around the points a keyboard can reach. */
export function ChartSvg({
  label,
  children,
  width,
}: {
  label: string
  children: ComponentChildren
  /** A drawing wider than the standard one is shown at that many pixels (1 unit is 1 px), not scaled down to fit. */
  width?: number
}): JSX.Element {
  const wide = width !== undefined && width > VIEW_W
  return (
    <svg
      class="chart"
      viewBox={`0 0 ${wide ? num(width) : VIEW_W} ${VIEW_H}`}
      width={wide ? num(width) : '100%'}
      style={wide ? { maxWidth: 'none', marginInline: 0 } : undefined}
      role="group"
      aria-label={label}
    >
      {children}
    </svg>
  )
}

export type Tick = { value: number; y: number; text: string }

/** Horizontal gridlines with the labels of the left axis, and optionally those of a second axis on the right. */
export function Grid({ box, left, right }: { box: Box; left: Tick[]; right?: Tick[] }): JSX.Element {
  return (
    <g class="chart__axes">
      {left.map((t) => (
        <g key={t.value}>
          <line class="chart__grid" data-value={t.value} x1={box.left} x2={box.right} y1={num(t.y)} y2={num(t.y)} />
          <text class="chart__tick chart__tick-y" x={box.left - 6} y={num(t.y + 4)} text-anchor="end">
            {t.text}
          </text>
        </g>
      ))}
      {right?.map((t) => (
        <text key={t.value} class="chart__tick chart__tick-y2" x={box.right + 6} y={num(t.y + 4)} text-anchor="start">
          {t.text}
        </text>
      ))}
    </g>
  )
}

/** The labels along the bottom axis. */
export function XLabels({ labels, y }: { labels: { x: number; text: string }[]; y: number }): JSX.Element {
  return (
    <g class="chart__axes">
      {labels.map((l, i) => (
        <text key={i} class="chart__tick chart__tick-x" x={num(l.x)} y={num(y)} text-anchor="middle">
          {l.text}
        </text>
      ))}
    </g>
  )
}

/** A hover and focus note for a dot or bar: two short lines in a box near the point, kept inside the drawing. */
export function Tip({ x, y, lines, width = VIEW_W }: { x: number; y: number; lines: string[]; width?: number }): JSX.Element {
  const longest = Math.max(...lines.map((l) => l.length))
  const w = longest * 7.4 + 16
  const h = lines.length * 18 + 8
  const left = Math.min(Math.max(num(x) - w / 2, 2), width - w - 2)
  const above = num(y) - h - 10
  const top = above >= 2 ? above : num(y) + 12
  return (
    <g class="chart__tip" aria-hidden="true">
      <rect x={num(left)} y={num(top)} width={num(w)} height={num(h)} rx="4" />
      {lines.map((l, i) => (
        <text key={i} x={num(left + 8)} y={num(top + 18 + i * 18)}>
          {l}
        </text>
      ))}
    </g>
  )
}

type PointProps = {
  tabindex: number
  onFocus: () => void
  onBlur: () => void
  onClick: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onKeyDown: (e: KeyboardEvent) => void
}

/**
 * The reachable points of one chart (dots, columns or bars) with a roving tabindex: the chart is one tab stop (the
 * point whose index is `stop` has tabindex 0, the others -1), the arrow keys move along the points (clamped, no wrap),
 * Home and End go to the first and last, and a point that is clicked or focused becomes the stop.
 * `active` is the point to show a tooltip for: the hovered or focused one.
 */
export function useChartPoints(count: number): { active: number | null; stop: number; props: (index: number) => PointProps } {
  const [active, setActive] = useState<number | null>(null)
  const [stopped, setStop] = useState(0)
  const stop = Math.min(stopped, Math.max(0, count - 1))
  const props = (index: number): PointProps => ({
    tabindex: index === stop ? 0 : -1,
    onFocus: () => {
      setActive(index)
      setStop(index)
    },
    onBlur: () => setActive((a) => (a === index ? null : a)),
    onClick: () => setStop(index),
    onMouseEnter: () => setActive(index),
    onMouseLeave: () => setActive((a) => (a === index ? null : a)),
    onKeyDown: (e) => {
      const target =
        e.key === 'ArrowRight' ? index + 1 : e.key === 'ArrowLeft' ? index - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : null
      if (target === null) return
      e.preventDefault()
      const next = Math.min(Math.max(target, 0), count - 1)
      if (next === index) return
      const points = (e.currentTarget as Element).closest('svg')?.querySelectorAll<SVGElement>('g.chart__hit')
      setStop(next)
      points?.[next]?.focus()
    },
  })
  return { active, stop, props }
}

/** The numbers behind a chart, in a table under a `Show the numbers` summary. The first column heads each row. */
export function DataTable({
  caption,
  head,
  rows,
  foot,
  lazy = false,
}: {
  caption: string
  head: string[]
  rows: { key: string; cells: string[] }[]
  foot?: string
  /** Builds the table only once the summary has been opened (for hundreds of rows). */
  lazy?: boolean
}): JSX.Element {
  const [opened, setOpened] = useState(false)
  const table = (): JSX.Element => (
    <table class="chart__table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            {r.cells.map((c, i) =>
              i === 0 ? (
                <th key={i} scope="row">
                  {c}
                </th>
              ) : (
                <td key={i}>{c}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
      {foot !== undefined && (
        <tfoot>
          <tr>
            <td colSpan={head.length}>{foot}</td>
          </tr>
        </tfoot>
      )}
    </table>
  )
  return (
    <details class="chart__numbers" onToggle={lazy ? (e) => setOpened((e.currentTarget as HTMLDetailsElement).open) : undefined}>
      <summary>Show the numbers</summary>
      {(!lazy || opened) && table()}
    </details>
  )
}

/** True when the dates are not all in one calendar year, so a short date needs its year. */
export function spansYears(dates: readonly string[]): boolean {
  return dates.length > 0 && dates[0].slice(0, 4) !== dates[dates.length - 1].slice(0, 4)
}

/**
 * The calendar the day charts are drawn on: the range for 4 weeks and 3 months (so gaps show), and for all time
 * from the first day with data (not 1,100 days of nothing). It always holds every date it is given.
 */
export function dayDomain(range: RangeId, from: string, to: string, dates: readonly string[]): { start: string; end: string } {
  const sorted = [...dates].sort()
  const first = sorted[0] ?? to
  const last = sorted[sorted.length - 1] ?? to
  const start = range === 'all' ? first : from
  return { start: start < first ? start : first, end: to > last ? to : last }
}

/** Places dates along the bottom of the box (with a little room at both ends) and picks at most 6 labels. */
export function dayAxis(
  start: string,
  end: string,
  box: Box,
  manyYears: boolean,
): { span: number; xOf: (date: string) => number; labels: { x: number; text: string }[]; step: number } {
  const span = Math.max(0, daysBetween(start, end))
  const pad = 10
  const scale = scaleLinear([0, span], [box.left + pad, box.right - pad])
  const xOf = (date: string): number => num(scale(daysBetween(start, date)))
  // at most 6 labels, fewer when a long label (with its year) would run into the next one
  const most = labelsThatFit(box.right - box.left, textWidth(manyYears ? 'Oct 23 2026' : 'Oct 23'), 6)
  const labels = dateTickOffsets(span, most).map((o) => {
    const d = addDays(start, o)
    return { x: xOf(d), text: shortDate(d, manyYears) }
  })
  return { span, xOf, labels, step: span === 0 ? box.right - box.left : (box.right - box.left - 2 * pad) / span }
}
