import type { JSX } from 'preact'
import type { StatsMode } from '../../../server/stats.ts'
import { linePath, num, scaleLinear, shortDate } from '../../core/chartmath.ts'
import { addDays, dayLabel } from '../../core/days.ts'
import { enough, rangeBounds } from '../../core/progressview.ts'
import {
  boxOf,
  ChartSvg,
  DataTable,
  dayAxis,
  dayDomain,
  Grid,
  NotEnough,
  Panel,
  spansYears,
  Tip,
  useChartPoints,
  XLabels,
} from './Chart.tsx'
import type { Margins } from './Chart.tsx'
import type { ReadyData } from './Tiles.tsx'

const SCOPES: Record<StatsMode, string> = { free: 'free type', drills: 'drills and tests', all: 'all modes' }
const TITLE = 'Accuracy and consistency'
const LINE = 'Line: first-try accuracy per day. Bars: how steady your stroke timing was (taller is steadier).'

// Room on the right for the steadiness axis.
const MARGINS: Margins = { l: 46, r: 40, t: 16, b: 30 }
/** The band needs this many days with a steadiness among the last BAND_DAYS days ending today. */
const BAND_DAYS = 14
const BAND_MIN = 5

type Day = { date: string; runs: number; accuracy: number | null; steadiness: number | null }

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const percent = (accuracy: number): string => `${(accuracy * 100).toFixed(1)}%`

/** Panel 3: the day's first-try accuracy as a line, its steadiness as bars, and the 14-day spread of the steadiness. */
export function AccuracyConsistency({ data }: { data: ReadyData }): JSX.Element {
  const { stats, mode } = data
  const head = { id: 'progress-accuracy', title: TITLE, scope: SCOPES[mode], line: LINE }
  if (stats.days.length === 0) {
    return (
      <Panel {...head}>
        <p class="progress__muted">No finished runs in this range yet.</p>
      </Panel>
    )
  }
  // A day has an accuracy when words stand behind it (the server gives null otherwise).
  const days: Day[] = stats.days
    .map((d) => ({
      date: d.date,
      runs: d.runs,
      accuracy: d.accuracy !== null && Number.isFinite(d.accuracy) && d.words > 0 ? d.accuracy : null,
      steadiness: d.steadiness !== null && Number.isFinite(d.steadiness) ? d.steadiness : null,
    }))
    .filter((d) => d.accuracy !== null || d.steadiness !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const runs = stats.days.reduce((sum, d) => sum + d.runs, 0)
  if (!enough(runs) || days.length === 0) {
    return (
      <Panel {...head}>
        <NotEnough />
      </Panel>
    )
  }
  return <Chart data={data} head={head} days={days} />
}

function Chart({
  data,
  head,
  days,
}: {
  data: ReadyData
  head: { id: string; title: string; scope: string; line: string }
  days: Day[]
}): JSX.Element {
  const { range, today } = data
  const { active, props: point } = useChartPoints(days.length)
  const { from, to } = rangeBounds(range, today)
  const box = boxOf(MARGINS)
  const dates = days.map((d) => d.date)
  const manyYears = spansYears(dates)
  const { start, end } = dayDomain(range, from, to, dates)
  const axis = dayAxis(start, end, box, manyYears)

  // The accuracy axis: 80% to 100% when every day is at 80% or better (a few points of difference would
  // be invisible on 0 to 100), otherwise 0% to 100%. The 80% axis is stated under the chart. The steadiness
  // axis is always 0 to 100 on the right, and both share four equal gridlines.
  const accuracies = days.flatMap((d) => (d.accuracy === null ? [] : [d.accuracy * 100]))
  const floor = accuracies.length > 0 && Math.min(...accuracies) >= 80 ? 80 : 0
  const yAcc = scaleLinear([floor, 100], [box.bottom, box.top])
  const ySteady = scaleLinear([0, 100], [box.bottom, box.top])
  const accY = (a: number): number => num(yAcc(clamp(a * 100, floor, 100)))
  const steadyY = (s: number): number => num(ySteady(clamp(s, 0, 100)))

  const gridSteps = [0, 25, 50, 75, 100]
  const left = gridSteps.map((s) => {
    const v = floor + ((100 - floor) * s) / 100
    return { value: s, y: ySteady(s), text: `${v}%` }
  })
  const right = gridSteps.map((s) => ({ value: s, y: ySteady(s), text: String(s) }))

  const barWidth = clamp(axis.step * 0.6, 1.5, 14)
  const accPoints = days.flatMap((d) => (d.accuracy === null ? [] : [{ x: axis.xOf(d.date), y: accY(d.accuracy) }]))

  // The day-to-day band: the lowest and highest daily steadiness over the 14 days ending today.
  const windowFrom = addDays(today, -(BAND_DAYS - 1))
  const recent = days.flatMap((d) => (d.steadiness !== null && d.date >= windowFrom && d.date <= today ? [d.steadiness] : []))
  const band =
    recent.length >= BAND_MIN ? { min: Math.round(Math.min(...recent)), max: Math.round(Math.max(...recent)), low: Math.min(...recent), high: Math.max(...recent) } : null
  const bandStart = windowFrom > start ? windowFrom : start
  const bandX0 = axis.xOf(bandStart) - barWidth / 2
  const bandX1 = axis.xOf(today > end ? end : today) + barWidth / 2
  const bandText = band === null ? null : `Over the last ${BAND_DAYS} days your steadiness ranged from ${band.min} to ${band.max}`

  const label = (d: Day): string => {
    const parts: string[] = []
    if (d.accuracy !== null) parts.push(`${percent(d.accuracy)} accuracy`)
    if (d.steadiness !== null) parts.push(`steadiness ${Math.round(d.steadiness)}`)
    return `${shortDate(d.date, manyYears)}: ${parts.join(', ')}`
  }
  const detail = (d: Day): string => label(d).slice(label(d).indexOf(': ') + 2)

  const rows = days.map((d) => ({
    key: d.date,
    cells: [
      dayLabel(d.date),
      d.accuracy === null ? '—' : percent(d.accuracy),
      d.steadiness === null ? '—' : String(Math.round(d.steadiness)),
      String(d.runs),
    ],
  }))

  const shown = active !== null ? days[active] : null
  const shownY = shown === null ? 0 : shown.accuracy !== null ? accY(shown.accuracy) : steadyY(shown.steadiness ?? 0)
  const accuracyRange = accuracies.length > 0 ? [Math.min(...accuracies), Math.max(...accuracies)] : null

  return (
    <Panel {...head}>
      <ChartSvg
        label={`Chart of accuracy and steadiness by day, ${plural(days.length, 'day')}${
          accuracyRange === null ? '' : `, accuracy from ${accuracyRange[0].toFixed(1)}% to ${accuracyRange[1].toFixed(1)}%`
        }`}
      >
        <Grid box={box} left={left} right={right} />
        <XLabels labels={axis.labels} y={box.bottom + 20} />
        {band !== null && (
          <rect
            class="chart__band"
            x={num(bandX0)}
            y={steadyY(band.high)}
            width={num(bandX1 - bandX0)}
            height={num(steadyY(band.low) - steadyY(band.high))}
          />
        )}
        {accPoints.length >= 2 && <path class="chart__line chart__line--ok" d={linePath(accPoints)} fill="none" />}
        {days.map((d, i) => {
          const x = axis.xOf(d.date)
          const top = d.steadiness === null ? box.bottom : steadyY(d.steadiness)
          return (
            <g key={d.date} class="chart__hit" role="img" aria-label={label(d)} {...point(i)}>
              <rect
                class="chart__column"
                x={num(x - Math.max(barWidth, 8) / 2)}
                y={box.top}
                width={num(Math.max(barWidth, 8))}
                height={box.bottom - box.top}
              />
              {d.steadiness !== null && (
                <rect class="chart__bar chart__bar--grey" x={num(x - barWidth / 2)} y={top} width={num(barWidth)} height={num(box.bottom - top)} />
              )}
              {d.accuracy !== null && <circle class="chart__dot chart__dot--ok" cx={x} cy={accY(d.accuracy)} r="3.5" />}
            </g>
          )
        })}
        {shown && <Tip x={axis.xOf(shown.date)} y={shownY} lines={[shortDate(shown.date, manyYears), detail(shown)]} />}
      </ChartSvg>
      {floor === 80 && <p class="panel__note">Accuracy axis: 80% to 100%.</p>}
      {bandText !== null && <p class="panel__note">{bandText}</p>}
      <DataTable
        caption={`${head.title}: first-try accuracy and steadiness for each day you finished runs.`}
        head={['Day', 'Accuracy', 'Steadiness', 'Runs']}
        rows={rows}
        foot={band === null ? undefined : `Last ${BAND_DAYS} days: steadiness from ${band.min} to ${band.max}`}
      />
    </Panel>
  )
}
