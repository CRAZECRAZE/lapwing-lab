// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TopBar } from '../../src/ui/TopBar.tsx'

beforeEach(() => history.replaceState(null, '', '/'))
afterEach(cleanup)

describe('TopBar', () => {
  it('lists the five tabs as links', () => {
    render(<TopBar current="book" />)
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    const links = Array.from(nav.querySelectorAll('a'))
    expect(links.map((a) => a.textContent)).toEqual(['Book', 'Practice', 'History', 'Days', 'Journal'])
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/', '/practice', '/history', '/days', '/journal'])
  })

  it('marks only the current tab', () => {
    render(<TopBar current="history" />)
    expect(screen.getByRole('link', { name: 'History' }).getAttribute('aria-current')).toBe('page')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })

  it('navigates on a plain click', () => {
    render(<TopBar current="book" />)
    const clicked = fireEvent.click(screen.getByRole('link', { name: 'Practice' }))
    expect(clicked).toBe(false) // default prevented: the app handles it
    expect(location.pathname).toBe('/practice')
  })

  it('leaves modified clicks to the browser', () => {
    render(<TopBar current="book" />)
    const claimed: boolean[] = []
    const swallow = (e: Event): void => {
      claimed.push(e.defaultPrevented) // did the app take the click? then stop jsdom following the link
      e.preventDefault()
    }
    document.addEventListener('click', swallow)
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      fireEvent.click(screen.getByRole('link', { name: 'Days' }), mod)
    }
    document.removeEventListener('click', swallow)
    expect(location.pathname).toBe('/')
    expect(claimed).toEqual([false, false, false, false, false])
  })
})
