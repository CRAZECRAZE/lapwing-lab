import type { JSX } from 'preact'
import { MIN_MIXUP_COUNT } from '../../core/keystats.ts'
import { periodText } from '../../core/progressview.ts'
import { DataTable, Panel } from './Chart.tsx'
import type { ReadyData } from './Tiles.tsx'
import { thousands } from './Tiles.tsx'

/** How many pairs the list names. */
const LISTED = 8

const LINE = 'A mix-up is a miss where you pressed one wrong key in place of the one you needed.'

const times = (n: number): string => `${thousands(n)} ${n === 1 ? 'time' : 'times'}`

/** Panel 7: the one-key-for-another misses you repeat, most often first. All modes. */
export function Mixups({ data }: { data: ReadyData }): JSX.Element {
  const seen = data.stats.mixups.filter((m) => Number.isFinite(m.count) && m.count >= MIN_MIXUP_COUNT)
  return (
    <Panel id="progress-mixups" title="Mix-ups" scope={`all modes, ${periodText(data.range)}`} line={LINE}>
      {seen.length === 0 ? (
        <p class="panel__note">no repeated mix-ups yet</p>
      ) : (
        <>
          <ul class="mixups__list">
            {seen.slice(0, LISTED).map((m) => (
              <li key={`${m.pressed}|${m.needed}`}>
                <code>{m.pressed}</code> instead of <code>{m.needed}</code> · {times(m.count)}
              </li>
            ))}
          </ul>
          <p class="panel__note">{`Only pairs seen at least ${MIN_MIXUP_COUNT} times are listed.`}</p>
          <DataTable
            caption={`Mix-ups seen at least ${MIN_MIXUP_COUNT} times, most often first, all modes.`}
            head={['Pressed', 'Needed', 'Times']}
            rows={seen.map((m) => ({ key: `${m.pressed}|${m.needed}`, cells: [m.pressed, m.needed, thousands(m.count)] }))}
          />
        </>
      )}
    </Panel>
  )
}
