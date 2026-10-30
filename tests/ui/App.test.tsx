// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { navigate } from '../../src/router.ts'
import { App } from '../../src/ui/App.tsx'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/tests' || url.startsWith('/api/tests?')) return new Response('[]', { status: 200 })
      if (url.startsWith('/api/days')) return new Response('[]', { status: 200 })
      if (url.startsWith('/api/stats')) {
        return new Response(
          JSON.stringify({ from: '', to: '', mode: 'free', days: [], keys: [], mixups: [], allTimeStrokes: 0 }),
          { status: 200 },
        )
      }
      if (url.startsWith('/api/fixup')) {
        const word = (prompt: string) => ({ prompt, outlines: ['SAP'], kind: 'word', attempts: 9, misses: 3, rate: 0.3, lastTsMs: 1 })
        return new Response(JSON.stringify({ from: '', to: '', words: [word('one'), word('two')], patterns: [] }), { status: 200 })
      }
      if (url === '/api/reports') return new Response('[]', { status: 200 })
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

  it('runs a section drill at /drill/list/:id and a chapter test at /drill/test/:chapter', async () => {
    history.replaceState(null, '', '/drill/list/8-x')
    render(<App />)
    expect(await screen.findByRole('region', { name: 'Chapter 8 · 8-x' })).toBeTruthy()
    cleanup()
    // No chapters in this content: an unknown chapter, with a way home.
    history.replaceState(null, '', '/drill/test/8')
    render(<App />)
    expect(await screen.findByText(/No such chapter/)).toBeTruthy()
  })

  it('shows the month calendar at /days, under the Days tab', async () => {
    history.replaceState(null, '', '/days')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: /^[A-Z][a-z]+ \d{4}$/ })).toBeTruthy()
    expect(await screen.findByText('0 days practiced · <1 min · 0 tests')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Days' }).getAttribute('aria-current')).toBe('page')
  })

  it('shows the Progress page at /progress, under the Progress tab', async () => {
    history.replaceState(null, '', '/progress')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Progress', level: 1 })).toBeTruthy()
    expect(await screen.findByText('No practice recorded yet.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Progress' }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('navigation', { name: 'Book pages' })).toBeNull()
  })

  it('shows the reports list at /progress/reports, under the Progress tab', async () => {
    history.replaceState(null, '', '/progress/reports')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Reports', level: 1 })).toBeTruthy()
    expect(await screen.findByText('No practice recorded yet.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Progress' }).getAttribute('aria-current')).toBe('page')
  })

  it('shows a report at /progress/reports/:month, under the Progress tab', async () => {
    history.replaceState(null, '', '/progress/reports/2026-10')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'October 2026', level: 1 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Progress' }).getAttribute('aria-current')).toBe('page')
  })

  it('says there is no such month for an invalid report month, under the Progress tab, with a way back', async () => {
    history.replaceState(null, '', '/progress/reports/2026-13')
    render(<App />)
    expect(screen.getByText('No such month.')).toBeTruthy()
    expect(screen.queryByText(/No such page/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Progress' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Practice' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: /Back to Reports/ }).getAttribute('href')).toBe('/progress/reports')
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

  it('opens the Lookup drawer on / in the Book tab, and Escape closes it', async () => {
    history.replaceState(null, '', '/page/home')
    render(<App />)
    expect(screen.getByRole('group', { name: 'Tools' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Lookup' })).toBeNull()
    const press = (key: string): KeyboardEvent => {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      act(() => {
        document.body.dispatchEvent(e)
      })
      return e
    }
    expect(press('/').defaultPrevented).toBe(true)
    expect(screen.getByRole('dialog', { name: 'Lookup' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Lookup' }).getAttribute('aria-pressed')).toBe('true')
    press('Escape')
    expect(screen.queryByRole('dialog', { name: 'Lookup' })).toBeNull()
  })

  it('shows one test at /history/:id, and its tab stays current', async () => {
    history.replaceState(null, '', '/history/12')
    render(<App />)
    expect(await screen.findByText('No such test.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'History' }).getAttribute('aria-current')).toBe('page')
  })

  it('starts a fresh fix-up run when only the picks in the query change', async () => {
    history.replaceState(null, '', '/practice/fixup/run/words?pick=one')
    render(<App />)
    await waitFor(() => expect(document.querySelector('.drill__prompt')?.textContent).toBe('one'))
    act(() => navigate('/practice/fixup/run/words?pick=two'))
    await waitFor(() => expect(document.querySelector('.drill__prompt')?.textContent).toBe('two'))
  })
})
