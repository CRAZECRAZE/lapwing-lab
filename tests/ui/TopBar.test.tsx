// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DockProvider, useDock } from '../../src/state/dock.tsx'
import type { Dock } from '../../src/state/dock.tsx'
import { TourProvider, useTourOptional } from '../../src/state/tour.tsx'
import { TopBar } from '../../src/ui/TopBar.tsx'

beforeEach(() => history.replaceState(null, '', '/'))
afterEach(cleanup)

describe('TopBar', () => {
  it('lists the six tabs as links, Progress between Days and Journal', () => {
    render(<TopBar current="book" />)
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    const links = Array.from(nav.querySelectorAll('a'))
    expect(links.map((a) => a.textContent)).toEqual(['Book', 'Practice', 'History', 'Days', 'Progress', 'Journal'])
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/',
      '/practice',
      '/history',
      '/days',
      '/progress',
      '/journal',
    ])
  })

  it('marks only the current tab', () => {
    render(<TopBar current="history" />)
    expect(screen.getByRole('link', { name: 'History' }).getAttribute('aria-current')).toBe('page')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })

  it('marks Progress as current on the progress tab', () => {
    render(<TopBar current="progress" />)
    expect(screen.getByRole('link', { name: 'Progress' }).getAttribute('aria-current')).toBe('page')
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

describe('TopBar tool buttons', () => {
  const tools = (): HTMLButtonElement[] =>
    Array.from(screen.getByRole('group', { name: 'Tools' }).querySelectorAll('button'))

  it('are not there without a DockProvider', () => {
    render(<TopBar current="book" />)
    expect(screen.queryByRole('group', { name: 'Tools' })).toBeNull()
  })

  it('shows four buttons with their key hints and the Alt form in the title', () => {
    render(
      <DockProvider>
        <TopBar current="book" />
      </DockProvider>,
    )
    expect(tools().map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Lookup',
      'Key chart',
      'Briefs',
      'Notes',
    ])
    expect(tools().map((b) => b.querySelector('kbd')?.textContent)).toEqual(['/', 'K', 'B', 'N'])
    expect(tools()[0].title).toBe('Lookup (/ — Alt+/ while drilling)')
    expect(tools()[1].title).toBe('Key chart (K — Alt+K while drilling)')
    expect(tools().every((b) => b.type === 'button' && b.getAttribute('aria-pressed') === 'false')).toBe(true)
    // the tabs are unchanged
    expect(Array.from(document.querySelectorAll('.topbar__tabs a')).map((a) => a.textContent)).toEqual([
      'Book',
      'Practice',
      'History',
      'Days',
      'Progress',
      'Journal',
    ])
  })

  it('toggle their tool on click and show which one is open', () => {
    let dock: Dock | undefined
    function Probe(): null {
      dock = useDock()
      return null
    }
    render(
      <DockProvider>
        <Probe />
        <TopBar current="practice" />
      </DockProvider>,
    )
    const [lookup, chart] = [screen.getByRole('button', { name: 'Lookup' }), screen.getByRole('button', { name: 'Key chart' })]
    fireEvent.click(lookup)
    expect(dock!.tool).toBe('lookup')
    expect(lookup.getAttribute('aria-pressed')).toBe('true')
    expect(chart.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chart)
    expect(dock!.tool).toBe('chart')
    expect(lookup.getAttribute('aria-pressed')).toBe('false')
    expect(chart.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chart)
    expect(dock!.tool).toBeNull()
    expect(chart.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(dock!.tool).toBe('notes')
    fireEvent.click(screen.getByRole('button', { name: 'Briefs' }))
    expect(dock!.tool).toBe('briefs')
  })
})

describe('TopBar Tour button', () => {
  const tourButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Tour' }) as HTMLButtonElement

  it('is not there without a TourProvider', () => {
    render(
      <DockProvider>
        <TopBar current="book" />
      </DockProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Tour' })).toBeNull()
  })

  it('comes last in the tools group, with the key in its title and no key chip', () => {
    render(
      <DockProvider>
        <TourProvider disabled={false}>
          <TopBar current="book" />
        </TourProvider>
      </DockProvider>,
    )
    const group = screen.getByRole('group', { name: 'Tools' })
    const buttons = Array.from(group.querySelectorAll('button'))
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Lookup',
      'Key chart',
      'Briefs',
      'Notes',
      'Tour',
    ])
    expect(buttons[4]).toBe(tourButton())
    expect(tourButton().type).toBe('button')
    expect(tourButton().title).toBe('Quick tour (Ctrl+Shift+T)')
    expect(tourButton().getAttribute('aria-keyshortcuts')).toBe('Control+Shift+T')
    expect(tourButton().querySelector('kbd')).toBeNull()
    expect(tourButton().disabled).toBe(false)
  })

  it('opens the tour on click', () => {
    let open = false
    function Probe(): null {
      open = useTourOptional()!.open
      return null
    }
    render(
      <TourProvider disabled={false}>
        <Probe />
        <TopBar current="book" />
      </TourProvider>,
    )
    expect(open).toBe(false)
    fireEvent.click(tourButton())
    expect(open).toBe(true)
  })

  it('is disabled, and does nothing, while a run is on screen', () => {
    let open = false
    function Probe(): null {
      open = useTourOptional()!.open
      return null
    }
    render(
      <TourProvider disabled>
        <Probe />
        <TopBar current="practice" />
      </TourProvider>,
    )
    expect(tourButton().disabled).toBe(true)
    expect(tourButton().title).toBe('Quick tour (not during a run)')
    fireEvent.click(tourButton())
    expect(open).toBe(false)
  })
})
