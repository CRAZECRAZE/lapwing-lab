// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayStat } from '../../server/archive.ts'
import { daysBetween } from '../../src/core/progressview.ts'
import { Reports } from '../../src/ui/Reports.tsx'

const TODAY = '2026-10-28'
const MIN = 60000
const day = (date: string, minutes: number, strokes: number): DayStat => ({ date, tests: 1, strokes, activeMs: minutes * MIN })

type Spec = { days?: () => unknown; reports?: () => unknown }

function stub(spec: Spec = {}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    const handler = url.pathname === '/api/days' ? (spec.days ?? (() => [])) : (spec.reports ?? (() => []))
    const body = await handler()
    return body instanceof Response ? body : new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const flush = (): Promise<void> => act(async () => new Promise<void>((done) => setTimeout(done, 0)))
const paramsOf = (fn: ReturnType<typeof vi.fn>, path: string): URLSearchParams[] =>
  fn.mock.calls.map(([u]) => new URL(String(u), 'http://localhost')).filter((u) => u.pathname === path).map((u) => u.searchParams)

async function mount(today: string = TODAY): Promise<void> {
  render(<Reports today={today} />)
  await flush()
}

beforeEach(() => history.replaceState(null, '', '/progress/reports'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('Reports month list', () => {
  const DAYS = [day('2026-08-03', 30, 1500), day('2026-08-04', 90, 4000), day('2026-10-26', 45, 2500)]

  it('has a Reports heading and a back link to Progress', async () => {
    stub()
    await mount()
    expect(screen.getByRole('heading', { name: 'Reports', level: 1 })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Progress/ }).getAttribute('href')).toBe('/progress')
  })

  it('lists practice months newest first, each a link with its time and strokes', async () => {
    stub({ days: () => DAYS })
    await mount()
    const links = within(screen.getByRole('list')).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/progress/reports/2026-10', '/progress/reports/2026-08'])
    expect(within(links[0]!).getByText('October 2026')).toBeTruthy()
    expect(within(links[0]!).getByText('45 min')).toBeTruthy()
    expect(within(links[0]!).getByText('2,500 strokes')).toBeTruthy()
    expect(within(links[1]!).getByText('August 2026')).toBeTruthy()
    expect(within(links[1]!).getByText('2 h 00 min')).toBeTruthy()
    expect(within(links[1]!).getByText('5,500 strokes')).toBeTruthy()
  })

  it('skips months with neither practice nor a note', async () => {
    stub({ days: () => DAYS })
    await mount()
    expect(screen.queryByText('September 2026')).toBeNull()
  })

  it('marks a month that has a note with the word note, and others not', async () => {
    stub({ days: () => DAYS, reports: () => [{ month: '2026-08', chars: 12 }] })
    await mount()
    const links = within(screen.getByRole('list')).getAllByRole('link')
    expect(within(links[1]!).getByText('note')).toBeTruthy()
    expect(within(links[0]!).queryByText('note')).toBeNull()
  })

  it('lists a month that has only a note', async () => {
    stub({ days: () => DAYS, reports: () => [{ month: '2026-09', chars: 5 }] })
    await mount()
    const links = within(screen.getByRole('list')).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/progress/reports/2026-10',
      '/progress/reports/2026-09',
      '/progress/reports/2026-08',
    ])
    expect(within(links[1]!).getByText('note')).toBeTruthy()
  })

  it('counts a day with only active time or only strokes as practice, and a zero day as none', async () => {
    stub({
      days: () => [
        { date: '2026-07-02', tests: 0, strokes: 0, activeMs: 0 },
        { date: '2026-09-02', tests: 0, strokes: 10, activeMs: 0 },
        { date: '2026-10-02', tests: 0, strokes: 0, activeMs: 5 * MIN },
      ],
    })
    await mount()
    expect(within(screen.getByRole('list')).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([
      '/progress/reports/2026-10',
      '/progress/reports/2026-09',
    ])
  })

  it('shows a plain empty state, not an error, with no practice and no notes', async () => {
    stub()
    await mount()
    expect(screen.getByText('No practice recorded yet.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('shows an error with a retry that fetches again', async () => {
    let fail = true
    const fn = stub({ days: () => (fail ? new Response('{}', { status: 500 }) : DAYS) })
    await mount()
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't load/)
    expect(screen.queryByRole('list')).toBeNull()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flush()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getAllByRole('link', { name: /October 2026/ })).toHaveLength(1)
    expect(paramsOf(fn, '/api/days')).toHaveLength(2)
  })

  it('shows an error when the notes list fails', async () => {
    stub({ reports: () => new Response('{}', { status: 500 }) })
    await mount()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('asks for the days once, from the first of a month and never over 1,100 days', async () => {
    const fn = stub()
    await mount()
    const days = paramsOf(fn, '/api/days')
    expect(days).toHaveLength(1)
    expect(paramsOf(fn, '/api/reports')).toHaveLength(1)
    expect(days[0]!.get('to')).toBe(TODAY)
    expect(days[0]!.get('from')).toBe('2023-11-01')
  })

  it.each(['2026-10-31', '2026-03-31', '2028-02-29', '2026-12-31', '2027-01-01'])(
    'keeps the request within the server limit on %s',
    async (today) => {
      const fn = stub()
      await mount(today)
      const p = paramsOf(fn, '/api/days')[0]!
      expect(p.get('from')!.endsWith('-01')).toBe(true)
      expect(daysBetween(p.get('from')!, p.get('to')!)).toBeLessThanOrEqual(1100)
      cleanup()
    },
  )

  it('defaults today to the local date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 28, 23, 30, 0))
    const fn = stub()
    render(<Reports />)
    await flush()
    vi.useRealTimers()
    expect(paramsOf(fn, '/api/days')[0]!.get('to')).toBe('2026-10-28')
  })

  it('navigates without a page load on a plain click', async () => {
    stub({ days: () => DAYS })
    await mount()
    fireEvent.click(screen.getByRole('link', { name: /August 2026/ }))
    expect(location.pathname).toBe('/progress/reports/2026-08')
  })
})
