import type { ComponentChildren, JSX } from 'preact'
import { useState } from 'preact/hooks'
import { addDays } from '../../core/days.ts'
import { daysBetween } from '../../core/progressview.ts'
import type { RangeId } from '../../core/progressview.ts'
import { dateTickOffsets, num, scaleLinear, shortDate } from '../../core/chartmath.ts'

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

/** The drawing: scales with its container, and is one picture with a summary for a screen reader. */
export function ChartSvg({ label, children }: { label: string; children: ComponentChildren }): JSX.Element {
  return (
    <svg class="chart" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" role="img" aria-label={label}>
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
export function Tip({ x, y, lines }: { x: number; y: number; lines: string[] }): JSX.Element {
  const longest = Math.max(...lines.map((l) => l.length))
  const w = longest * 7.4 + 16
  const h = lines.length * 18 + 8
  const left = Math.min(Math.max(num(x) - w / 2, 2), VIEW_W - w - 2)
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

type Handlers = { onFocus: () => void; onBlur: () => void; onMouseEnter: () => void; onMouseLeave: () => void }

/** Which dot or bar is hovered or focused, and the handlers to give each one. */
export function useActive(): [number | null, (index: number) => Handlers] {
  const [active, setActive] = useState<number | null>(null)
  const bind = (index: number): Handlers => ({
    onFocus: () => setActive(index),
    onBlur: () => setActive((a) => (a === index ? null : a)),
    onMouseEnter: () => setActive(index),
    onMouseLeave: () => setActive((a) => (a === index ? null : a)),
  })
  return [active, bind]
}

/** The numbers behind a chart, in a table under a `Show the numbers` summary. The first column heads each row. */
export function DataTable({
  caption,
  head,
  rows,
  foot,
}: {
  caption: string
  head: string[]
  rows: { key: string; cells: string[] }[]
  foot?: string
}): JSX.Element {
  return (
    <details class="chart__numbers">
      <summary>Show the numbers</summary>
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
  const labels = dateTickOffsets(span, 6).map((o) => {
    const d = addDays(start, o)
    return { x: xOf(d), text: shortDate(d, manyYears) }
  })
  return { span, xOf, labels, step: span === 0 ? box.right - box.left : (box.right - box.left - 2 * pad) / span }
}
