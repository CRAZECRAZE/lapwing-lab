import type { JSX } from 'preact'
import {
  cap,
  compactCount,
  dateTickOffsets,
  durationText,
  labelsThatFit,
  labelStep,
  num,
  scaleLinear,
  shortDate,
  textWidth,
  tickDuration,
  timeAxis,
} from '../../core/chartmath.ts'
import { addDays } from '../../core/days.ts'
import { rangeBounds, weeksOf, weekStart } from '../../core/progressview.ts'
import { boxOf, ChartSvg, DataTable, Grid, Panel, spansYears, Tip, useChartPoints, VIEW_W, XLabels } from './Chart.tsx'
import type { Margins } from './Chart.tsx'
import type { ReadyData } from './Tiles.tsx'
import { thousands } from './Tiles.tsx'

const TITLE = 'Practice time per week'
const LINE = 'Time practiced each week (Monday to Sunday), with the strokes under each bar.'

// Room under the bars for the week labels, the strokes and `so far`.
const MARGINS: Margins = { l: 72, r: 20, t: 16, b: 62 }
/** Beyond this many bars the strokes are not written under the bars at all (the table keeps them). */
const STROKES_UNTIL = 26

/** Panel 5: practice time for each Monday-week of the range, strokes under each bar, this week lighter. */
export function WeeklyBars({ data }: { data: ReadyData }): JSX.Element {
  const { days, range, today } = data
  const { from, to } = rangeBounds(range, today)
  // Sums of huge values can overflow; `cap` keeps what is drawn and written finite.
  const all = weeksOf(days, from, to).map((w) => ({ ...w, activeMs: cap(w.activeMs), strokes: cap(w.strokes) }))
  // All time reaches 1,100 days back: it starts at the first week with practice, not at 3 years of nothing.
  const first = range === 'all' ? all.findIndex((w) => w.activeMs > 0 || w.strokes > 0) : 0
  const weeks = first > 0 ? all.slice(first) : all
  const { active, props: point } = useChartPoints(weeks.length)
  const head = { id: 'progress-weekly', title: TITLE, scope: 'all modes', line: LINE }
  if (!weeks.some((w) => w.activeMs > 0 || w.strokes > 0)) {
    return (
      <Panel {...head}>
        <p class="progress__muted">No practice in this range yet.</p>
      </Panel>
    )
  }

  const box = boxOf(MARGINS)
  const manyYears = spansYears(weeks.map((w) => w.start))
  const thisWeek = weekStart(today)
  const axis = timeAxis(Math.max(...weeks.map((w) => w.activeMs)))
  const y = scaleLinear([0, axis.max], [box.bottom, box.top])
  const slot = (box.right - box.left) / weeks.length
  const barWidth = Math.max(1, slot * 0.7)
  const centre = (i: number): number => num(box.left + slot * (i + 0.5))

  const name = (start: string): string => {
    const partial = start < from ? `, from ${shortDate(from, manyYears)}` : ''
    return `Week of ${shortDate(start, manyYears)}${partial}`
  }
  const label = (i: number): string => {
    const w = weeks[i]
    const soFar = w.start === thisWeek ? ', so far' : ''
    return `${name(w.start)}: ${durationText(w.activeMs)}, ${thousands(w.strokes)} strokes${soFar}`
  }
  // Strokes under the bars: the exact counts when every slot can hold one, else the short form (11.3k), else
  // every Nth of the short form (counted back from the latest week) so that no two labels touch.
  const exact = weeks.map((w) => thousands(w.strokes))
  const short = weeks.map((w) => compactCount(w.strokes))
  const widest = (texts: string[]): number => Math.max(...texts.map(textWidth))
  const exactFits = labelStep(widest(exact), slot) === 1
  const strokeTexts = exactFits ? exact : short
  const strokeStep = exactFits ? 1 : labelStep(widest(short), slot)
  const strokesShown = (i: number): boolean => (weeks.length - 1 - i) % strokeStep === 0
  const most = labelsThatFit(box.right - box.left, textWidth(manyYears ? 'Oct 23 2026' : 'Oct 23'), 6)
  const labelled = dateTickOffsets(weeks.length - 1, most).map((i) => ({ x: centre(i), text: shortDate(weeks[i].start, manyYears) }))
  const times = weeks.map((w) => w.activeMs)

  const rows = weeks.map((w) => ({
    key: w.start,
    cells: [
      `${shortDate(w.start, true)}${w.start === thisWeek ? ' (so far)' : ''}${w.start < from ? ` (from ${shortDate(from, true)})` : ''}`,
      durationText(w.activeMs),
      thousands(w.strokes),
    ],
  }))

  const shown = active !== null ? active : null
  return (
    <Panel {...head}>
      <ChartSvg
        label={`Bar chart of practice time per week, ${weeks.length} weeks, from ${durationText(Math.min(...times))} to ${durationText(Math.max(...times))}`}
      >
        <Grid box={box} left={axis.ticks.map((t) => ({ value: t, y: y(t), text: tickDuration(t) }))} />
        <XLabels labels={labelled} y={box.bottom + 20} />
        {weeks.map((w, i) => {
          const top = num(y(w.activeMs))
          const now = w.start === thisWeek
          return (
            <g key={w.start} class="chart__hit" role="img" aria-label={label(i)} {...point(i)}>
              <rect class="chart__slot" x={num(box.left + slot * i)} y={box.top} width={num(slot)} height={box.bottom - box.top} />
              <rect
                class={now ? 'chart__bar chart__bar--now' : 'chart__bar'}
                x={num(centre(i) - barWidth / 2)}
                y={top}
                width={num(barWidth)}
                height={num(box.bottom - top)}
              />
            </g>
          )
        })}
        {weeks.length <= STROKES_UNTIL &&
          weeks.map(
            (w, i) =>
              strokesShown(i) && (
                <text key={w.start} class="chart__strokes" x={centre(i)} y={box.bottom + 38} text-anchor="middle">
                  {strokeTexts[i]}
                </text>
              ),
          )}
        {weeks.map(
          (w, i) =>
            w.start === thisWeek && (
              <text
                key="sofar"
                class="chart__sofar"
                x={centre(i)}
                y={box.bottom + (weeks.length <= STROKES_UNTIL ? 55 : 38)}
                text-anchor={weeks.length <= STROKES_UNTIL ? 'middle' : 'end'}
              >
                so far
              </text>
            ),
        )}
        {shown !== null && (
          <Tip
            x={Math.min(centre(shown), VIEW_W - 60)}
            y={num(y(weeks[shown].activeMs))}
            lines={[
              name(weeks[shown].start),
              `${durationText(weeks[shown].activeMs)}, ${thousands(weeks[shown].strokes)} strokes${weeks[shown].start === thisWeek ? ', so far' : ''}`,
            ]}
          />
        )}
      </ChartSvg>
      {weeks[0].start < from && (
        <p class="panel__note">{`The first week starts on ${shortDate(from, manyYears)} (the start of the range).`}</p>
      )}
      <DataTable
        caption={`${TITLE}: time practiced and strokes for each Monday-week, all modes.`}
        head={['Week of', 'Time', 'Strokes']}
        rows={rows}
      />
    </Panel>
  )
}
