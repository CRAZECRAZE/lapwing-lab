// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/ui/App.tsx'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/tests' || url.startsWith('/api/tests?')) return new Response('[]', { status: 200 })
      if (url.startsWith('/api/days')) return new Response('[]', { status: 200 })
      if (url === '/api/journal') return new Response('[]', { status: 200 })
      if (url.startsWith('/api/journal/')) {
        return new Response(JSON.stringify({ date: url.slice('/api/journal/'.length), text: 'Kept words.' }), { status: 200 })
      }
      if (url.startsWith('/api/tests/last')) return new Response('null', { status: 200 })
      if (url.startsWith('/api/tests/')) return new Response('{}', { status: 404 })
      if (url === '/api/settings') return new Response('{"boardVisibility":"always","hints":"miss"}', { status: 200 })
      if (url === '/content/chapters.json') return new Response('[]', { status: 200 })
      if (url.startsWith('/api/results')) return new Response('[]', { status: 200 })
      if (url === '/api/progress') return new Response('[]', { status: 200 })
      if (url === '/content/practice-index.json') return new Response('[{"id":"8-x","chapter":8,"items":1}]', { status: 200 })
      if (url === '/content/practice/8-x.json') {
        return new Response('{"id":"8-x","items":[{"prompt":"sap","outlines":["SAP"]}]}', { status: 200 })
      }
      return new Response(JSON.stringify({ commit: 'abc', pages: [] }), { status: 200 })
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('App shell', () => {
  it('shows the chapter nav on the Book tab only', async () => {
    history.replaceState(null, '', '/page/home')
    const { container } = render(<App />)
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Book pages' })).toBeTruthy()
    expect(container.querySelector('.app--wide')).toBeNull()
    cleanup()

    history.replaceState(null, '', '/history')
    const wide = render(<App />)
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Book pages' })).toBeNull()
    expect(wide.container.querySelector('.app--wide')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'History' }).getAttribute('aria-current')).toBe('page')
  })

  it('shows the Practice tab at /practice', async () => {
    history.replaceState(null, '', '/practice')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Practice', level: 1 })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Free type' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Chapter 4 drills' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Practice' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('option', { name: 'Chapters 5–8 word lists' })).toBeTruthy()
  })

  it('runs free type at /practice/free/:source/:mode, under the Practice tab', async () => {
    history.replaceState(null, '', '/practice/free/ch-8/time-60')
    render(<App />)
    expect(await screen.findByRole('region', { name: 'Free type · Chapters 5–8 word lists · 60 seconds' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Practice' }).getAttribute('aria-current')).toBe('page')
  })

  it('shows the month calendar at /days, under the Days tab', async () => {
    history.replaceState(null, '', '/days')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: /^[A-Z][a-z]+ \d{4}$/ })).toBeTruthy()
    expect(await screen.findByText('0 days practiced · <1 min · 0 tests')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Days' }).getAttribute('aria-current')).toBe('page')
  })

  it('shows one day at /days/:date, and resets when going back to the month', async () => {
    history.replaceState(null, '', '/days/2026-10-26')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Mon 26 Oct 2026', level: 1 })).toBeTruthy()
    expect(await screen.findByText('Kept words.')).toBeTruthy()
    expect(await screen.findByText('No practice recorded this day.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Days' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('link', { name: 'Back to month' }))
    expect(await screen.findByText('0 days practiced · <1 min · 0 tests')).toBeTruthy()
    expect(screen.queryByText('Kept words.')).toBeNull()
  })

  it('reloads the status line streak when the route changes', async () => {
    const dayCalls = (): number => vi.mocked(fetch).mock.calls.filter(([u]) => String(u).startsWith('/api/days')).length
    history.replaceState(null, '', '/history')
    render(<App />)
    await screen.findByRole('heading', { name: 'History' })
    const before = dayCalls()
    fireEvent.click(screen.getByRole('link', { name: 'Practice' }))
    await screen.findByRole('heading', { name: 'Practice', level: 1 })
    await waitFor(() => expect(dayCalls()).toBeGreaterThan(before))
  })

  it('shows the Journal for a day at /journal/:date, under the Journal tab', async () => {
    history.replaceState(null, '', '/journal/2026-10-26')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Mon 26 Oct 2026', level: 1 })).toBeTruthy()
    const box = (await screen.findByDisplayValue('Kept words.')) as HTMLTextAreaElement
    expect(box.getAttribute('aria-label')).toBe('Journal for Mon 26 Oct 2026')
    expect(box.readOnly).toBe(false)
    expect(await screen.findByText('No practice recorded this day.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Journal' }).getAttribute('aria-current')).toBe('page')
  })

  it('shows one test at /history/:id, and its tab stays current', async () => {
    history.replaceState(null, '', '/history/12')
    render(<App />)
    expect(await screen.findByText('No such test.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'History' }).getAttribute('aria-current')).toBe('page')
  })
})
