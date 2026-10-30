// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DayStat } from '../../../server/archive.ts'
import { ReportBanner } from '../../../src/ui/progress/ReportBanner.tsx'

const MIN = 60000
const day = (date: string, strokes = 1000, activeMs = 10 * MIN): DayStat => ({ date, tests: 1, strokes, activeMs })

function stub(days: DayStat[] | 'fail', settings: unknown = {}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    if (url.pathname === '/api/days') {
      return days === 'fail' ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(days), { status: 200 })
    }
    return new Response(JSON.stringify(settings), { status: 200 })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const flush = (): Promise<void> => act(async () => new Promise<void>((done) => setTimeout(done, 0)))
async function mount(today: string): Promise<void> {
  render(<ReportBanner today={today} />)
  await flush()
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ReportBanner', () => {
  it('appears on the last day of a month with practice, linking to its report', async () => {
    stub([day('2026-10-12')])
    await mount('2026-10-31')
    expect(screen.getByText('October is done. Your report is ready.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /report/i }).getAttribute('href')).toBe('/progress/reports/2026-10')
  })

  it('is absent the day before the month ends', async () => {
    stub([day('2026-10-12')])
    await mount('2026-10-30')
    expect(screen.queryByText(/is done/)).toBeNull()
  })

  it('shows the previous month early in the next month', async () => {
    stub([day('2026-09-12'), day('2026-10-02')])
    await mount('2026-10-05')
    expect(screen.getByText('September is done. Your report is ready.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /report/i }).getAttribute('href')).toBe('/progress/reports/2026-09')
  })

  it('is absent for a month at or before reportSeen, present for a later one', async () => {
    stub([day('2026-10-12')], { reportSeen: '2026-10' })
    await mount('2026-10-31')
    expect(screen.queryByText(/is done/)).toBeNull()
    cleanup()
    stub([day('2026-10-12')], { reportSeen: '2026-11' })
    await mount('2026-11-02')
    expect(screen.queryByText(/is done/)).toBeNull()
    cleanup()
    stub([day('2026-10-12')], { reportSeen: '2026-09' })
    await mount('2026-10-31')
    expect(screen.getByText('October is done. Your report is ready.')).toBeTruthy()
  })

  it('is absent when the month has no practice', async () => {
    stub([day('2026-10-12', 0, 0)])
    await mount('2026-10-31')
    expect(screen.queryByText(/is done/)).toBeNull()
    cleanup()
    stub([])
    await mount('2026-10-31')
    expect(screen.queryByText(/is done/)).toBeNull()
  })

  it('shows the latest complete month when two qualify', async () => {
    stub([day('2026-09-12'), day('2026-10-12')])
    await mount('2026-10-31')
    expect(screen.getByText('October is done. Your report is ready.')).toBeTruthy()
    expect(screen.queryByText(/September/)).toBeNull()
  })

  it('falls back to the earlier month when the latest one has no practice', async () => {
    stub([day('2026-09-12')])
    await mount('2026-10-31')
    expect(screen.getByText('September is done. Your report is ready.')).toBeTruthy()
  })

  it('shows nothing while loading', () => {
    stub([day('2026-10-12')])
    render(<ReportBanner today="2026-10-31" />)
    expect(screen.queryByText(/is done/)).toBeNull()
  })

  it('shows nothing and no error when the days fail', async () => {
    stub('fail')
    await mount('2026-10-31')
    expect(screen.queryByText(/is done/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toBe('')
  })

  it('asks once for the last two months of days and for the settings', async () => {
    const fn = stub([])
    await mount('2026-10-31')
    const urls = fn.mock.calls.map(([u]) => String(u))
    expect(urls.filter((u) => u.startsWith('/api/days'))).toEqual(['/api/days?from=2026-09-01&to=2026-10-31'])
    expect(urls.filter((u) => u === '/api/settings')).toHaveLength(1)
  })
})
