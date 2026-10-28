import type { JSX } from 'preact'
import { MIN_KEY_PRESSES } from '../../core/keystats.ts'
import type { KeyStat } from '../../core/keystats.ts'
import { SLOTS } from '../../core/steno.ts'
import type { Slot } from '../../core/steno.ts'
import { Board } from '../Board.tsx'
import { DataTable, Panel } from './Chart.tsx'
import type { ReadyData } from './Tiles.tsx'
import { thousands } from './Tiles.tsx'

/** How many keys the list names. */
const LISTED = 5

const LINE = 'The keys you miss most often, among the keys pressed at least 30 times. The redder a key, the more it is missed.'

type Ranked = KeyStat & { rate: number }

/** A rate of missed presses, or null when the counts make none (so no NaN reaches the board or the words). */
function rateOf(key: KeyStat): number | null {
  const rate = key.missed / key.required
  return Number.isFinite(key.required) && Number.isFinite(key.missed) && Number.isFinite(rate) && rate >= 0 ? rate : null
}

/** A count with thousands separators; a dash for one that is not a finite number. */
const count = (n: number): string => (Number.isFinite(n) ? thousands(n) : '—')

/** `21%`, or `<1%` for a rate that would round to nothing. */
function percent(rate: number): string {
  return rate > 0 && rate < 0.005 ? '<1%' : `${Math.round(rate * 100)}%`
}

/** Panel 6: the board with the often-missed keys in red, and the worst five in words. All modes. */
export function WeakKeys({ data }: { data: ReadyData }): JSX.Element {
  const keys = data.stats.keys
  const ranked: Ranked[] = []
  for (const key of keys) {
    if (!(key.required >= MIN_KEY_PRESSES)) continue
    const rate = rateOf(key)
    if (rate !== null) ranked.push({ ...key, rate })
  }
  // Each key is shaded against the worst one, so the worst is fully hot; a key that is never missed is not shaded.
  const worst = Math.max(0, ...ranked.map((k) => k.rate))
  const heat: Partial<Record<Slot, number>> = {}
  for (const key of ranked) if (key.rate > 0 && worst > 0) heat[key.slot] = key.rate / worst

  const order = (slot: Slot): number => SLOTS.indexOf(slot)
  const listed = ranked
    .filter((k) => k.missed > 0)
    .sort((a, b) => b.rate - a.rate || b.required - a.required || order(a.slot) - order(b.slot))
    .slice(0, LISTED)

  const rows = keys
    .filter((k) => k.required > 0)
    .map((k) => {
      const rate = rateOf(k)
      return {
        key: k.slot,
        cells: [
          k.slot,
          count(k.required),
          count(k.missed),
          k.required >= MIN_KEY_PRESSES && rate !== null ? percent(rate) : 'too few',
        ],
      }
    })

  return (
    <Panel id="progress-weak" title="Weakest keys, all modes" line={LINE}>
      <div class="weak">
        <Board size={22} heat={heat} />
        <div class="weak__side">
          {ranked.length === 0 ? (
            <p class="panel__note">not enough data yet</p>
          ) : listed.length === 0 ? (
            <p class="panel__note">Nothing missed on any key with enough presses.</p>
          ) : (
            <ol class="weak__list">
              {listed.map((k) => (
                <li key={k.slot}>
                  <code>{k.slot}</code> <span>{percent(k.rate)} missed</span>{' '}
                  <span class="weak__counts">{`(${thousands(k.missed)} of ${thousands(k.required)})`}</span>
                </li>
              ))}
            </ol>
          )}
          <p class="panel__note">{`A key needs ${MIN_KEY_PRESSES} presses to be ranked.`}</p>
        </div>
      </div>
      <p class="panel__note">For words with several strokes, a miss is matched to the closest stroke of the word.</p>
      <DataTable
        caption="Weakest keys: how often each key was needed and missed, all modes."
        head={['Key', 'Needed', 'Missed', 'Rate']}
        rows={rows}
      />
    </Panel>
  )
}
