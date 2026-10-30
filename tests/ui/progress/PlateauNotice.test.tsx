// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../../server/settings.ts'
import type { DayQuality, StatsResponse } from '../../../server/stats.ts'
import { addDays } from '../../../src/core/days.ts'
import type { Plateau } from '../../../src/core/plateau.ts'
import { PlateauNotice } from '../../../src/ui/progress/PlateauNotice.tsx'
import { usePlateau } from '../../../src/ui/progress/usePlateau.ts'

const api = vi.hoisted(() => ({
  getStats: vi.fn(),
  getSettings: vi.fn(),
  putSettings: vi.fn(),
}))
vi.mock('../../../src/api.ts', () => api)

const TODAY = '2026-10-28'
const SETTINGS: Settings = { boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null, ghost: 'best' }

/** Two free-type runs spread over one day of a week `ago` days back. */
const dayOf = (ago: number, wpm: number, accuracy: number, steadiness: number): DayQuality => ({
  date: addDays(TODAY, -ago),
  runs: 2,
  words: 100,
  wpm,
  accuracy,
  steadiness,
})

/** 41.4 wpm this week, 42 and 40 the two weeks before; steadiness 44 -> 53, accuracy 91% -> 94%. */
const FLAT: DayQuality[] = [dayOf(1, 41.4, 0.94, 53), dayOf(8, 42, 0.92, 48), dayOf(15, 40, 0.91, 44)]
/** The same speeds with nothing improving. */
const FLAT_ONLY: DayQuality[] = [dayOf(1, 41.4, 0.9, 50), dayOf(8, 42, 0.9, 50), dayOf(15, 40, 0.9, 50)]

const statsOf = (days: DayQuality[]): StatsResponse => ({
  from: '',
  to: '',
  mode: 'free',
  days,
  keys: [],
  mixups: [],
  allTimeStrokes: 1000,
})

const flush = (): Promise<void> => act(async () => new Promise<void>((done) => setTimeout(done, 0)))

beforeEach(() => {
  history.replaceState(null, '', '/progress')
  api.getStats.mockReset().mockResolvedValue(statsOf(FLAT))
  api.getSettings.mockReset().mockResolvedValue({ ...SETTINGS })
  api.putSettings.mockReset().mockResolvedValue({ ...SETTINGS })
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  history.replaceState(null, '', '/')
})

const PLATEAU: Plateau = {
  weeks: 3,
  thisWeek: 41.4,
  others: [42.2, 39.8],
  meanwhile: { steadiness: { from: 44, to: 53 }, accuracy: { from: 91, to: 94 } },
}
const noop = (): void => undefined

describe('PlateauNotice, panel variant', () => {
  it('shows the title, the numbers, the reassurance and the meanwhile line', () => {
    render(<PlateauNotice plateau={PLATEAU} onSnooze={noop} variant="panel" />)
    expect(screen.getByText('Your speed has been flat for 3 weeks')).toBeTruthy()
    expect(screen.getByText(/Free-type wpm: 41 this week, 42 and 40 the weeks before\./)).toBeTruthy()
    expect(screen.getByText(/Plateaus like this are common while learning steno\./)).toBeTruthy()
    expect(
      screen.getByText('Meanwhile your steadiness rose from 44 to 53 and your accuracy from 91% to 94%.'),
    ).toBeTruthy()
  })

  it('names one other week in the singular', () => {
    render(<PlateauNotice plateau={{ ...PLATEAU, others: [42] }} onSnooze={noop} variant="panel" />)
    expect(screen.getByText(/41 this week, 42 the week before\./)).toBeTruthy()
  })

  it('names only the metrics that rose', () => {
    const { unmount } = render(
      <PlateauNotice
        plateau={{ ...PLATEAU, meanwhile: { accuracy: { from: 91.2, to: 94.4 } } }}
        onSnooze={noop}
        variant="panel"
      />,
    )
    expect(screen.getByText('Meanwhile your accuracy rose from 91% to 94%.')).toBeTruthy()
    unmount()
    render(
      <PlateauNotice plateau={{ ...PLATEAU, meanwhile: { steadiness: { from: 44, to: 53 } } }} onSnooze={noop} variant="panel" />,
    )
    expect(screen.getByText('Meanwhile your steadiness rose from 44 to 53.')).toBeTruthy()
  })

  it('has no meanwhile line when nothing rose', () => {
    render(<PlateauNotice plateau={{ ...PLATEAU, meanwhile: {} }} onSnooze={noop} variant="panel" />)
    expect(screen.queryByText(/Meanwhile/)).toBeNull()
  })

  it('rounds the speeds for display', () => {
    render(<PlateauNotice plateau={{ ...PLATEAU, thisWeek: 41.6, others: [40.4, 43.5] }} onSnooze={noop} variant="panel" />)
    expect(screen.getByText(/42 this week, 40 and 44 the weeks before\./)).toBeTruthy()
  })

  it('scrolls to the Weakest keys and Mix-ups panels', () => {
    const weak = document.createElement('section')
    weak.id = 'progress-weak'
    const mix = document.createElement('section')
    mix.id = 'progress-mixups'
    document.body.append(weak, mix)
    const weakScroll = vi.fn()
    const mixScroll = vi.fn()
    weak.scrollIntoView = weakScroll
    mix.scrollIntoView = mixScroll
    render(<PlateauNotice plateau={PLATEAU} onSnooze={noop} variant="panel" />)
    fireEvent.click(screen.getByRole('link', { name: 'Weakest keys' }))
    expect(weakScroll).toHaveBeenCalledTimes(1)
    expect(mixScroll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Mix-ups' }))
    expect(mixScroll).toHaveBeenCalledTimes(1)
    expect(location.pathname).toBe('/progress')
  })

  it('does nothing when the panel it links to is not on the page', () => {
    render(<PlateauNotice plateau={PLATEAU} onSnooze={noop} variant="panel" />)
    expect(() => fireEvent.click(screen.getByRole('link', { name: 'Weakest keys' }))).not.toThrow()
  })

  it('calls onSnooze from Not now (14 days)', () => {
    const onSnooze = vi.fn()
    render(<PlateauNotice plateau={PLATEAU} onSnooze={onSnooze} variant="panel" />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now (14 days)' }))
    expect(onSnooze).toHaveBeenCalledTimes(1)
  })

  it('gives no advice, instruction or scolding', () => {
    const { container } = render(<PlateauNotice plateau={PLATEAU} onSnooze={noop} variant="panel" />)
    expect(container.textContent).not.toMatch(
      /\b(should|must|try|need to|have to|ought|you could|consider|practice more|work on|focus|don't|stop|lazy|slack)\b/i,
    )
  })
})

describe('PlateauNotice, line variant', () => {
  it('is one line with a link to Progress', () => {
    history.replaceState(null, '', '/page/ch05')
    const { container } = render(<PlateauNotice plateau={PLATEAU} onSnooze={noop} variant="line" />)
    expect(container.textContent).toBe('Speed flat for 3 weeks, see Progress')
    const link = screen.getByRole('link', { name: 'see Progress' })
    expect(link.getAttribute('href')).toBe('/progress')
    expect(screen.queryByRole('button')).toBeNull()
    fireEvent.click(link)
    expect(location.pathname).toBe('/progress')
  })
})

/** Both variants behind one hook, as the two pages use it. */
function Harness({ today = TODAY }: { today?: string }) {
  const { plateau, snooze } = usePlateau(today)
  if (plateau === null) return <p>nothing</p>
  return (
    <>
      <PlateauNotice plateau={plateau} onSnooze={() => void snooze()} variant="panel" />
      <PlateauNotice plateau={plateau} onSnooze={() => void snooze()} variant="line" />
    </>
  )
}
const shown = (): boolean => screen.queryByText('Your speed has been flat for 3 weeks') !== null
const lineShown = (): boolean => screen.queryByText('see Progress') !== null

describe('usePlateau', () => {
  it('asks once for the 56 free-type days ending today, and shows the notice when the speed is flat', async () => {
    render(<Harness />)
    expect(shown()).toBe(false) // pending
    await flush()
    expect(api.getStats).toHaveBeenCalledTimes(1)
    expect(api.getStats).toHaveBeenCalledWith('2026-09-03', TODAY, 'free')
    expect(api.getSettings).toHaveBeenCalledTimes(1)
    expect(shown()).toBe(true)
    expect(lineShown()).toBe(true)
    expect(screen.getByText(/41 this week, 42 and 40 the weeks before\./)).toBeTruthy()
  })

  it('shows nothing while the answer is pending', async () => {
    api.getStats.mockReturnValue(new Promise(() => undefined))
    render(<Harness />)
    await flush()
    expect(shown()).toBe(false)
    expect(lineShown()).toBe(false)
  })

  it('shows nothing, and no error, when the stats fail', async () => {
    api.getStats.mockRejectedValue(new Error('offline'))
    const { container } = render(<Harness />)
    await flush()
    expect(container.textContent).toBe('nothing')
  })

  it('shows nothing for an empty history or a changing speed', async () => {
    api.getStats.mockResolvedValue(statsOf([]))
    const { container, unmount } = render(<Harness />)
    await flush()
    expect(container.textContent).toBe('nothing')
    unmount()
    api.getStats.mockResolvedValue(statsOf([dayOf(1, 60, 0.9, 50), dayOf(8, 40, 0.9, 50), dayOf(15, 20, 0.9, 50)]))
    const again = render(<Harness />)
    await flush()
    expect(again.container.textContent).toBe('nothing')
  })

  it('does not fetch again when it re-renders', async () => {
    const { rerender } = render(<Harness />)
    await flush()
    rerender(<Harness />)
    await flush()
    expect(api.getStats).toHaveBeenCalledTimes(1)
  })

  it('drops an answer that arrives after unmount', async () => {
    let resolve!: (s: StatsResponse) => void
    api.getStats.mockReturnValue(new Promise<StatsResponse>((r) => (resolve = r)))
    const { unmount } = render(<Harness />)
    unmount()
    await act(async () => resolve(statsOf(FLAT)))
    expect(shown()).toBe(false)
  })

  it('hides the notice only while the snooze date is after today', async () => {
    const snoozed = async (date: string | null): Promise<void> => {
      api.getSettings.mockResolvedValue({ ...SETTINGS, plateauSnoozedUntil: date })
      render(<Harness />)
      await flush()
    }
    await snoozed('2026-10-20') // in the past
    expect(shown()).toBe(true)
    cleanup()
    await snoozed(TODAY) // ends today
    expect(shown()).toBe(true)
    cleanup()
    await snoozed('2026-10-29') // tomorrow
    expect(shown()).toBe(false)
    expect(lineShown()).toBe(false)
    cleanup()
    await snoozed('2026-11-11')
    expect(shown()).toBe(false)
  })

  it('stores today plus 14 days when snoozed and hides both places', async () => {
    render(<Harness />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Not now (14 days)' }))
    await flush()
    expect(api.putSettings).toHaveBeenCalledTimes(1)
    expect(api.putSettings).toHaveBeenCalledWith({ plateauSnoozedUntil: '2026-11-11' })
    expect(shown()).toBe(false)
    expect(lineShown()).toBe(false)
  })

  it('keeps the notice, without a crash, when the snooze cannot be stored', async () => {
    api.putSettings.mockRejectedValue(new Error('offline'))
    render(<Harness />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Not now (14 days)' }))
    await flush()
    expect(shown()).toBe(true)
    expect(lineShown()).toBe(true)
  })

  it('shows no meanwhile line for a flat history that did not improve', async () => {
    api.getStats.mockResolvedValue(statsOf(FLAT_ONLY))
    render(<Harness />)
    await flush()
    expect(shown()).toBe(true)
    expect(screen.queryByText(/Meanwhile/)).toBeNull()
  })

  it('shows the meanwhile line for a flat history that improved', async () => {
    render(<Harness />)
    await flush()
    expect(screen.getByText(/Meanwhile your steadiness rose from 44 to 53/)).toBeTruthy()
  })
})
