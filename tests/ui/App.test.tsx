// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/ui/App.tsx'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ commit: 'abc', pages: [] }), { status: 200 })),
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
    expect(screen.getByText('The History tab is coming in this milestone.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'History' }).getAttribute('aria-current')).toBe('page')
  })

  it.each([
    ['/practice', 'Practice'],
    ['/practice/free/ch-8/time-60', 'Practice'],
    ['/history/12', 'History'],
    ['/days', 'Days'],
    ['/journal/2026-10-27', 'Journal'],
  ])('shows the placeholder at %s', (path, name) => {
    history.replaceState(null, '', path)
    render(<App />)
    expect(screen.getByText(`The ${name} tab is coming in this milestone.`)).toBeTruthy()
    expect(screen.getByRole('link', { name }).getAttribute('aria-current')).toBe('page')
  })
})
