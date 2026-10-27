// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeyChartEntry } from '../../../scripts/lib/keychart.ts'
import { SLOTS } from '../../../src/core/steno.ts'
import { DockProvider, useDock } from '../../../src/state/dock.tsx'
import type { Dock } from '../../../src/state/dock.tsx'
import { DockHost } from '../../../src/ui/DockHost.tsx'
import { KeyChart, __resetKeyChartCacheForTests } from '../../../src/ui/tools/KeyChart.tsx'

const LEFT = ['S-', 'T-', 'K-', 'P-', 'W-', 'H-', 'R-']
const VOWELS = ['A-', 'O-', '-E', '-U']
const SPECIAL = ['#', '*']

/** One entry per slot, in SLOTS order, with simple data; a few get the real-looking shapes the tests read. */
const CHART: KeyChartEntry[] = SLOTS.map((slot): KeyChartEntry => {
  const group = LEFT.includes(slot) ? 'left' : VOWELS.includes(slot) ? 'vowel' : SPECIAL.includes(slot) ? 'special' : 'right'
  const letter = slot.replace('-', '').toLowerCase()
  if (group === 'special') {
    return { slot, group, sounds: [`The ${slot} key does something special.`], examples: [], source: `About ${slot}` }
  }
  if (group === 'vowel') return { slot, group, sounds: [`/${letter}/`], examples: [`${letter}ab`, `${letter}ad`], source: `Short ${letter}` }
  return { slot, group, sounds: [letter], examples: [`${letter}ox`, `${letter}ip`], source: 'Consonant keys' }
})
const withEntry = (slot: string, patch: Partial<KeyChartEntry>): KeyChartEntry[] =>
  CHART.map((e) => (e.slot === slot ? { ...e, ...patch } : e))

/** Each fetch gets the next reply (the last one repeats): a chart, or 'fail'. */
function stubFetch(...replies: Array<KeyChartEntry[] | 'fail'>) {
  let n = 0
  const fn = vi.fn(async (url: string) => {
    const next = replies[Math.min(n++, replies.length - 1)]
    if (url !== '/content/keychart.json' || next === 'fail') return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => next }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  __resetKeyChartCacheForTests()
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  __resetKeyChartCacheForTests()
  vi.unstubAllGlobals()
})

/** Opens the tool and waits for the chart. */
async function open(): Promise<void> {
  render(<KeyChart />)
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
}
const row = (slot: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`.keychart__row[data-slot="${slot}"]`)
  if (!found) throw new Error(`no row for ${slot}`)
  return found
}
const lit = (): string[] => [...document.querySelectorAll('.board .key--target')].map((e) => e.getAttribute('data-lever') ?? '').sort()
const text = (el: Element, selector: string): string | undefined => el.querySelector(selector)?.textContent ?? undefined

describe('KeyChart loading and the cache', () => {
  it('shows Loading… and then the chart', async () => {
    stubFetch(CHART)
    render(<KeyChart />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    await screen.findByRole('heading', { name: 'Left hand' })
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it('fetches once: a second open (unmount, mount) reuses the cache', async () => {
    const fetchFn = stubFetch(CHART)
    const first = render(<KeyChart />)
    await screen.findByRole('heading', { name: 'Left hand' })
    first.unmount()
    render(<KeyChart />)
    await screen.findByRole('heading', { name: 'Left hand' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('a failed fetch shows the message, is not cached, and Try again refetches', async () => {
    const fetchFn = stubFetch('fail', CHART)
    render(<KeyChart />)
    expect(await screen.findByText("Couldn't load the key chart.")).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Left hand' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: 'Left hand' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(screen.queryByText("Couldn't load the key chart.")).toBeNull()
  })

  it('a failure is not cached for the next open either', async () => {
    const fetchFn = stubFetch('fail', CHART)
    const first = render(<KeyChart />)
    await screen.findByText("Couldn't load the key chart.")
    first.unmount()
    render(<KeyChart />)
    await screen.findByRole('heading', { name: 'Left hand' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('a body that is not a list is a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) })))
    render(<KeyChart />)
    expect(await screen.findByText("Couldn't load the key chart.")).toBeTruthy()
  })

  it('unmounting before the fetch settles leaves nothing behind and does not throw', async () => {
    stubFetch(CHART)
    const view = render(<KeyChart />)
    view.unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(document.querySelector('.keychart')).toBeNull()
  })
})

describe('KeyChart rows', () => {
  beforeEach(() => stubFetch(CHART))

  it('renders the four groups in order, each a list with the right rows', async () => {
    await open()
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Left hand', 'Vowels', 'Right hand', 'Special'])
    const counts = [...document.querySelectorAll('.keychart__group')].map((g) => g.querySelectorAll('ul > li').length)
    expect(counts).toEqual([7, 4, 10, 2])
    const slots = [...document.querySelectorAll('.keychart__group')].map((g) =>
      [...g.querySelectorAll('li')].map((li) => li.getAttribute('data-slot')),
    )
    expect(slots).toEqual([LEFT, VOWELS, ['-F', '-R', '-P', '-B', '-L', '-G', '-T', '-S', '-D', '-Z'], ['#', '*']])
  })

  it('shows each key name exactly as the board names its slot', async () => {
    await open()
    for (const slot of SLOTS) expect(text(row(slot), 'kbd')).toBe(slot)
  })

  it('a consonant row shows its spellings joined with a dot, then its examples and its source', async () => {
    stubFetch(withEntry('K-', { sounds: ['k', 'c'], examples: ['king', 'car'], source: 'Consonant keys' }))
    await open()
    const k = row('K-')
    expect(text(k, '.keychart__sounds')).toBe('k · c')
    expect(text(k, '.keychart__examples')).toBe('king, car')
    expect(text(k, '.keychart__source')).toBe('Consonant keys')
  })

  it('a vowel row shows its IPA and its examples', async () => {
    stubFetch(withEntry('-U', { sounds: ['/ʌ/', '/ʊ/'], examples: ['cup', 'hut'], source: 'Short u' }))
    await open()
    expect(text(row('-U'), '.keychart__sounds')).toBe('/ʌ/ · /ʊ/')
    expect(text(row('-U'), '.keychart__examples')).toBe('cup, hut')
    expect(text(row('-U'), '.keychart__source')).toBe('Short u')
  })

  it('a special row shows its sentence as text and no examples', async () => {
    const sentence = 'For this, press the asterisk key (*) and Plover will delete the last translation.'
    stubFetch(withEntry('*', { sounds: [sentence], examples: ['stray'], source: 'The backspace key' }))
    await open()
    const star = row('*')
    expect(text(star, '.keychart__sentence')).toBe(sentence)
    expect(star.querySelector('.keychart__sounds')).toBeNull()
    expect(star.querySelector('.keychart__examples')).toBeNull()
    expect(star.textContent).not.toContain('stray')
    expect(text(star, '.keychart__source')).toBe('The backspace key')
  })

  it('a row with empty sounds shows only its examples', async () => {
    stubFetch(withEntry('R-', { sounds: [], examples: ['red', 'ran'] }))
    await open()
    const r = row('R-')
    expect(r.querySelector('.keychart__sounds')).toBeNull()
    expect(text(r, '.keychart__examples')).toBe('red, ran')
    expect(r.textContent).not.toContain('—')
  })

  it('a row with neither sounds nor examples shows a dash', async () => {
    stubFetch(withEntry('H-', { sounds: [], examples: [] }))
    await open()
    const h = row('H-')
    expect(text(h, '.keychart__none')).toBe('—')
    expect(h.querySelector('.keychart__sounds')).toBeNull()
    expect(h.querySelector('.keychart__examples')).toBeNull()
    // the other rows do not show it
    expect(row('T-').querySelector('.keychart__none')).toBeNull()
  })

  it('a row with sounds but no examples shows the sounds only, without a dash', async () => {
    stubFetch(withEntry('T-', { sounds: ['t'], examples: [] }))
    await open()
    expect(text(row('T-'), '.keychart__sounds')).toBe('t')
    expect(row('T-').querySelector('.keychart__examples')).toBeNull()
    expect(row('T-').querySelector('.keychart__none')).toBeNull()
  })

  it('makes every row reachable by Tab', async () => {
    await open()
    const rows = [...document.querySelectorAll<HTMLElement>('.keychart__row')]
    expect(rows).toHaveLength(SLOTS.length)
    for (const r of rows) expect(r.tabIndex).toBe(0)
  })
})

describe('KeyChart board', () => {
  beforeEach(() => stubFetch(CHART))

  it('shows a larger board with nothing lit at first', async () => {
    await open()
    const board = document.querySelector<HTMLElement>('.keychart .board')
    expect(board).toBeTruthy()
    expect(board!.style.getPropertyValue('--s')).toBe('28px')
    expect(document.querySelectorAll('.board .key').length).toBe(28)
    expect(lit()).toEqual([])
  })

  it('hovering S- lights both S levers', async () => {
    await open()
    fireEvent.mouseEnter(row('S-'))
    expect(lit()).toEqual(['S1-', 'S2-'])
  })

  it('hovering -F lights only the right-hand F key', async () => {
    await open()
    fireEvent.mouseEnter(row('-F'))
    expect(lit()).toEqual(['-F'])
  })

  it('hovering T- lights T- and not -T', async () => {
    await open()
    fireEvent.mouseEnter(row('T-'))
    expect(lit()).toEqual(['T-'])
    fireEvent.mouseLeave(row('T-'))
    fireEvent.mouseEnter(row('-T'))
    expect(lit()).toEqual(['-T'])
  })

  it('hovering * lights all four star levers', async () => {
    await open()
    fireEvent.mouseEnter(row('*'))
    expect(lit()).toEqual(['*1', '*2', '*3', '*4'])
  })

  it('hovering # lights both number levers', async () => {
    await open()
    fireEvent.mouseEnter(row('#'))
    expect(lit()).toEqual(['#1', '#2'])
  })

  it('hovering a vowel lights that vowel', async () => {
    await open()
    fireEvent.mouseEnter(row('-E'))
    expect(lit()).toEqual(['-E'])
  })

  it('leaving the row clears the board', async () => {
    await open()
    fireEvent.mouseEnter(row('S-'))
    expect(lit()).not.toEqual([])
    fireEvent.mouseLeave(row('S-'))
    expect(lit()).toEqual([])
  })

  it('moving from one row to another follows the newer row', async () => {
    await open()
    fireEvent.mouseEnter(row('S-'))
    fireEvent.mouseLeave(row('S-'))
    fireEvent.mouseEnter(row('K-'))
    expect(lit()).toEqual(['K-'])
  })

  it('focusing a row lights the board as hovering does, and blurring clears it', async () => {
    await open()
    act(() => row('*').focus())
    expect(document.activeElement).toBe(row('*'))
    expect(lit()).toEqual(['*1', '*2', '*3', '*4'])
    act(() => row('*').blur())
    expect(lit()).toEqual([])
  })

  it('a row left by the mouse still lights the board while another way keeps it focused', async () => {
    await open()
    act(() => row('-R').focus())
    fireEvent.mouseEnter(row('S-'))
    expect(lit()).toEqual(['S1-', 'S2-'])
    fireEvent.mouseLeave(row('S-'))
    expect(lit()).toEqual(['-R'])
  })

  it('a slot the board does not know lights nothing', async () => {
    stubFetch([{ slot: 'Q-', group: 'left', sounds: ['q'], examples: ['quit'], source: 'Odd' }])
    await open()
    fireEvent.mouseEnter(row('Q-'))
    expect(lit()).toEqual([])
  })
})

let dock: Dock
function Probe(): null {
  dock = useDock()
  return null
}

describe('the chart inside the real DockHost', () => {
  it('opens as the Key chart drawer and loads the chart; the other tools keep their placeholder', async () => {
    const fetchFn = stubFetch(CHART)
    render(
      <DockProvider>
        <Probe />
        <DockHost />
      </DockProvider>,
    )
    act(() => dock.open('chart'))
    const box = screen.getByRole('dialog', { name: 'Key chart' })
    await screen.findByRole('heading', { name: 'Left hand' })
    expect(box.textContent).not.toContain('Coming in this milestone.')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    for (const tool of ['notes'] as const) {
      act(() => dock.open(tool))
      expect(document.querySelector('.dock-drawer')!.textContent).toContain('Coming in this milestone.')
      expect(document.querySelector('.keychart')).toBeNull()
    }
  })
})
