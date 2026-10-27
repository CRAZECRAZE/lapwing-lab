// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/ui/App.tsx'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/tests') return new Response('[]', { status: 200 })
      if (url.startsWith('/api/tests/last')) return new Response('null', { status: 200 })
      if (url.startsWith('/api/tests/')) return new Response('{}', { status: 404 })
      if (url === '/api/settings') return new Response('{"boardVisibility":"always"}', { status: 200 })
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

  it.each([
    ['/days', 'Days'],
    ['/journal/2026-10-27', 'Journal'],
  ])('shows the placeholder at %s', (path, name) => {
    history.replaceState(null, '', path)
    render(<App />)
    expect(screen.getByText(`The ${name} tab is coming in this milestone.`)).toBeTruthy()
    expect(screen.getByRole('link', { name }).getAttribute('aria-current')).toBe('page')
  })

  it('shows one test at /history/:id, and its tab stays current', async () => {
    history.replaceState(null, '', '/history/12')
    render(<App />)
    expect(await screen.findByText('No such test.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'History' }).getAttribute('aria-current')).toBe('page')
  })
})
