import type { JSX } from 'preact'
import { bestPoint, cap, linePath, niceMax, num, scaleLinear, shortDate, ticks } from '../../core/chartmath.ts'
import { dayLabel } from '../../core/days.ts'
import { enough, movingAverage, rangeBounds } from '../../core/progressview.ts'
import {
  boxOf,
  ChartSvg,
  DataTable,
  dayAxis,
  dayDomain,
  Grid,
  MARGINS,
  NotEnough,
  Panel,
  spansYears,
  Tip,
  useChartPoints,
  XLabels,
} from './Chart.tsx'
import { MODE_SCOPES } from './Tiles.tsx'
import type { ReadyData } from './Tiles.tsx'

const TITLE = 'Wpm by day'

const LINE = 'The average wpm of the runs you finished each day, weighted by words.'
/** A trend needs this many practiced days; it is a moving average over this many calendar days. */
const TREND_DAYS = 3
const TREND_WINDOW = 7

/** The first and last day of the axis, inclusive. */
export type Domain = { from: string; to: string }

type PanelHead = { id: string; title: string; scope: string; line: string }
type Dot = { date: string; value: number; runs: number; words: number }

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * Panel 2: one dot per day practiced (the day's wpm), a line through them, and a dashed 7-day trend from 3 days.
 * The axis runs over the range ending today, unless `domain` gives its first and last day (a month report draws one month).
 */
export function WpmByDay({ data, domain }: { data: ReadyData; domain?: Domain }): JSX.Element {
  const { stats, mode } = data
  const head = { id: 'progress-wpm', title: TITLE, scope: MODE_SCOPES[mode], line: LINE }
  const runs = stats.days.reduce((sum, d) => sum + d.runs, 0)
  if (stats.days.length === 0) {
    return (
      <Panel {...head}>
        <p class="progress__muted">No finished runs in this range yet.</p>
      </Panel>
    )
  }

  // A day is a dot when it has a wpm and words behind it, in date order.
  const dots: Dot[] = stats.days
    .filter((d) => d.wpm !== null && Number.isFinite(d.wpm) && d.words > 0)
    .map((d) => ({ date: d.date, value: d.wpm as number, runs: d.runs, words: d.words }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  if (!enough(runs) || dots.length === 0) {
    return (
      <Panel {...head}>
        <NotEnough />
      </Panel>
    )
  }
  return <Chart data={data} head={head} dots={dots} domain={domain} />
}

function Chart({ data, head, dots, domain }: { data: ReadyData; head: PanelHead; dots: Dot[]; domain?: Domain }): JSX.Element {
  const { range, today } = data
  const { active, props: point } = useChartPoints(dots.length)
  const { from, to } = domain ?? rangeBounds(range, today)
  const box = boxOf(MARGINS)
  const dates = dots.map((d) => d.date)
  const manyYears = spansYears(dates)
  // a given domain is a fixed window: the axis starts on its first day, as for a fixed range, not on the first dot as for all time
  const { start, end } = dayDomain(domain ? '4w' : range, from, to, dates)
  const axis = dayAxis(start, end, box, manyYears)

  // The axis starts at 0 and ends on the highest wpm rounded up, so a dot twice as fast is twice as high
  // and one lucky day cannot flatten the others (it just makes the axis taller, honestly).
  const yMax = niceMax(Math.max(...dots.map((d) => d.value)))
  const y = scaleLinear([0, yMax], [box.bottom, box.top])
  const pointOf = (p: { date: string; value: number }): { x: number; y: number } => ({
    x: axis.xOf(p.date),
    y: num(y(p.value)),
  })

  // A mean of huge values can overflow; `cap` keeps what is drawn and written finite.
  const trend = (dots.length >= TREND_DAYS ? movingAverage(dots, TREND_WINDOW) : []).map((t) => ({ ...t, value: cap(t.value) }))
  const best = bestPoint(dots)!
  const label = (d: Dot): string => `${shortDate(d.date, manyYears)}: ${d.value.toFixed(1)} wpm over ${plural(d.runs, 'run')}`
  const slowest = Math.min(...dots.map((d) => d.value))

  const trendOn = new Map(trend.map((t) => [t.date, t.value]))
  const rows = dots.map((d) => ({
    key: d.date,
    cells: [
      dayLabel(d.date),
      d.value.toFixed(1),
      String(d.runs),
      String(d.words),
      ...(trend.length > 0 ? [(trendOn.get(d.date) ?? d.value).toFixed(1)] : []),
    ],
  }))

  const shown = active !== null ? dots[active] : null
  return (
    <Panel {...head}>
      <p class="panel__best">{`Best day: ${shortDate(best.date, manyYears)}, ${best.value.toFixed(1)} wpm`}</p>
      <ChartSvg
        label={`Line chart of wpm by day, ${plural(dots.length, 'day')}, from ${slowest.toFixed(1)} to ${best.value.toFixed(1)}`}
      >
        <Grid box={box} left={ticks(yMax).map((v) => ({ value: v, y: y(v), text: String(v) }))} />
        <XLabels labels={axis.labels} y={box.bottom + 20} />
        {trend.length > 0 && (
          <path class="chart__trend" d={linePath(trend.map(pointOf))} fill="none" stroke-dasharray="6 4" />
        )}
        {dots.length >= 2 && <path class="chart__line" d={linePath(dots.map(pointOf))} fill="none" />}
        {dots.map((d, i) => {
          const p = pointOf(d)
          return (
            <g key={d.date} class="chart__hit" role="img" aria-label={label(d)} {...point(i)}>
              <circle class="chart__ring" cx={p.x} cy={p.y} r="9" />
              <circle class="chart__dot" cx={p.x} cy={p.y} r="4" />
            </g>
          )
        })}
        {shown && (
          <Tip
            x={pointOf(shown).x}
            y={pointOf(shown).y}
            lines={[shortDate(shown.date, manyYears), `${shown.value.toFixed(1)} wpm over ${plural(shown.runs, 'run')}`]}
          />
        )}
      </ChartSvg>
      {trend.length > 0 && <p class="panel__note">Dashed line: the 7-day average of the daily values (each day counts once).</p>}
      <DataTable
        caption={`${head.title}: the days you finished runs, with their speed, runs and words${trend.length > 0 ? ' and the 7-day average' : ''}.`}
        head={['Day', 'Wpm', 'Runs', 'Words', ...(trend.length > 0 ? ['Trend (7-day average)'] : [])]}
        rows={rows}
      />
    </Panel>
  )
}
