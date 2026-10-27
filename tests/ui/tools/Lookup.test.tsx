// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import type { JSX } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo } from '../../../scripts/build-content.ts'
import type { LookupEntry } from '../../../scripts/lib/lookup.ts'
import { chapterStates } from '../../../src/core/progress.ts'
import type { ResultsByMode } from '../../../src/core/progress.ts'
import { DockProvider, useDock } from '../../../src/state/dock.tsx'
import type { Dock } from '../../../src/state/dock.tsx'
import type { Progress } from '../../../src/state/progress.tsx'
import { DockHost } from '../../../src/ui/DockHost.tsx'
import { Lookup, __resetLookupCacheForTests } from '../../../src/ui/tools/Lookup.tsx'

// Lookup reads the chapter limit through `useProgress`; each test hands it a fake value.
const fake = vi.hoisted(() => ({ value: null as Progress | null }))
vi.mock('../../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => fake.value ?? actual.useProgress() }
})

const chapter = (n: number): ChapterInfo => ({ chapter: n, pageId: `ch${n}`, title: `Chapter ${n}`, gate: 'read', listIds: [] })
/** Chapters 4..26, so a "taught so far" limit between 4 and 26 can be made with overrides. */
const CHAPTERS: ChapterInfo[] = Array.from({ length: 23 }, (_, i) => chapter(i + 4))

/** Progress whose taught-so-far chapter is `limit`: every chapter below it is cleared by an override mark. */
function progress(status: Progress['status'], limit = 26): Progress {
  const marks = CHAPTERS.filter((c) => c.chapter < limit).map((c) => ({ chapter: c.chapter, kind: 'override' as const, at: 1 }))
  const results: ResultsByMode = { stage0: [], section: [], 'chapter-test': [] }
  return {
    status,
    chapters: CHAPTERS,
    index: [],
    results,
    marks,
    states: status === 'ready' ? chapterStates(CHAPTERS, results, marks) : new Map(),
    reload: async () => {},
    setMark: async () => {},
    setMarks: async () => {},
    clearMark: async () => {},
  }
}
/** Ready progress where nothing has been cleared yet: taught so far = chapter 4. */
const READY_AT = (limit: number): Progress => progress('ready', limit)

const INDEX: LookupEntry[] = [
  { word: 'cat', hits: [{ outline: 'KAT', chapter: 5, source: 'practice' }] },
  { word: 'scat', hits: [{ outline: 'SKAT', chapter: 6, source: 'practice' }] },
  { word: 'catch', hits: [{ outline: 'KAFP', chapter: 7, source: 'practice' }] },
  {
    word: 'are',
    hits: [
      { outline: 'R', chapter: 5, source: 'brief', note: 'the short form' },
      { outline: '-R', chapter: 5, source: 'brief', note: 'the short form' },
      { outline: 'AR', chapter: 16, source: 'practice' },
    ],
  },
  {
    word: 'dad',
    hits: [
      { outline: 'TKAD', chapter: 5, source: 'practice' },
      { outline: 'TKAD', chapter: 5, source: 'example' },
    ],
  },
  {
    word: 'mad',
    hits: [
      { outline: 'PHAD', chapter: 5, source: 'example' },
      { outline: 'PHAD', chapter: 5, source: 'brief' },
      { outline: 'PHAD', chapter: 5, source: 'practice' },
      { outline: 'PHAD', chapter: 5, source: 'practice' },
    ],
  },
  { word: 'how ever', hits: [{ outline: 'HOU/EFR', chapter: 20, source: 'example' }] },
  { word: 'centre', hits: [{ outline: 'SEPB/TER/#TPH', chapter: 21, source: 'example' }] },
  { word: 'do', hits: [{ outline: 'TKO', chapter: 5, source: 'brief' }] },
]

const MANY: LookupEntry[] = Array.from({ length: 40 }, (_, i) => ({
  word: `a${String(i).padStart(2, '0')}x`,
  hits: [{ outline: 'A', chapter: 5, source: 'practice' as const }],
}))

/** Each fetch gets the next reply (the last one repeats): an index, or 'fail'. */
function stubFetch(...replies: Array<LookupEntry[] | 'fail'>) {
  let n = 0
  const fn = vi.fn(async (url: string) => {
    const next = replies[Math.min(n++, replies.length - 1)]
    if (url !== '/content/lookup.json' || next === 'fail') return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => next }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  fake.value = progress('ready')
  __resetLookupCacheForTests()
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  fake.value = null
  __resetLookupCacheForTests()
  vi.unstubAllGlobals()
})

const input = (): HTMLInputElement => screen.getByLabelText('Look up a word or a stroke') as HTMLInputElement

/** Opens the tool and waits for the index. */
async function open(): Promise<void> {
  render(<Lookup />)
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
}
async function type(text: string): Promise<void> {
  await open()
  fireEvent.input(input(), { target: { value: text } })
}
const words = (): string[] => [...document.querySelectorAll('.lookup__word')].map((e) => e.textContent ?? '')
const rows = (word: string): HTMLElement[] => {
  const item = [...document.querySelectorAll<HTMLElement>('.lookup__result')].find((e) => e.querySelector('.lookup__word')?.textContent === word)
  return item ? [...item.querySelectorAll<HTMLElement>('.lookup__hit')] : []
}
const keys = (...levers: string[]): string[] => [...levers].sort()
const lit = (): string[] =>
  [...document.querySelectorAll('.lookup__preview .key--target')].map((e) => e.getAttribute('data-lever') ?? '').sort()

describe('Lookup loading and the cache', () => {
  it('shows Loading… and then the search box', async () => {
    stubFetch(INDEX)
    render(<Lookup />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    await screen.findByText('Start typing to look something up.')
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it('fetches once: a second open (unmount, mount) reuses the cache', async () => {
    const fetchFn = stubFetch(INDEX)
    const first = render(<Lookup />)
    await screen.findByText('Start typing to look something up.')
    first.unmount()
    render(<Lookup />)
    await screen.findByText('Start typing to look something up.')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('a failed fetch shows the message, is not cached, and Try again refetches', async () => {
    const fetchFn = stubFetch('fail', INDEX)
    render(<Lookup />)
    expect(await screen.findByText("Couldn't load the lookup index.")).toBeTruthy()
    expect(screen.queryByText('Start typing to look something up.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Start typing to look something up.')
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(screen.queryByText("Couldn't load the lookup index.")).toBeNull()
  })

  it('a failure is not cached for the next open either', async () => {
    const fetchFn = stubFetch('fail', INDEX)
    const first = render(<Lookup />)
    await screen.findByText("Couldn't load the lookup index.")
    first.unmount()
    render(<Lookup />)
    await screen.findByText('Start typing to look something up.')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe('Lookup searching', () => {
  beforeEach(() => stubFetch(INDEX))

  it('shows the start message for an empty or whitespace-only query', async () => {
    await open()
    expect(screen.getByText('Start typing to look something up.')).toBeTruthy()
    fireEvent.input(input(), { target: { value: '   ' } })
    expect(screen.getByText('Start typing to look something up.')).toBeTruthy()
    expect(words()).toEqual([])
    expect(document.querySelector('.lookup__preview')).toBeNull()
  })

  it('puts the exact word before its prefix and substring matches', async () => {
    await type('cat')
    expect(words()).toEqual(['cat', 'catch', 'scat'])
  })

  it('finds a word by an outline query', async () => {
    await type('TKAD')
    expect(words()).toEqual(['dad'])
  })

  it('merges a hit repeated with several sources into one row', async () => {
    await type('dad')
    const dad = rows('dad')
    expect(dad).toHaveLength(1)
    expect(dad[0].textContent).toContain('Chapter 5')
    expect(dad[0].querySelector('.lookup__sources')?.textContent).toBe('practice list, example')
  })

  it('lists the merged sources once each, in the order practice list, brief, example', async () => {
    await type('mad')
    expect(rows('mad')).toHaveLength(1)
    expect(rows('mad')[0].querySelector('.lookup__sources')?.textContent).toBe('practice list, brief, example')
  })

  it('shows a brief note on its row', async () => {
    await type('are')
    const are = rows('are')
    expect(are).toHaveLength(3)
    expect(are[0].textContent).toContain('the short form')
    expect(are[0].querySelector('.lookup__sources')?.textContent).toBe('brief')
    expect(are[2].textContent).not.toContain('the short form')
    expect(are[2].textContent).toContain('Chapter 16')
  })

  it('draws one chip per stroke of a multi-stroke outline, with a separator between them', async () => {
    await type('centre')
    const chips = [...rows('centre')[0].querySelectorAll('code.stroke')]
    expect(chips.map((c) => c.getAttribute('data-stroke'))).toEqual(['SEPB', 'TER', '#TPH'])
    expect(chips.map((c) => c.textContent)).toEqual(['SEPB', 'TER', '#TPH'])
    expect(rows('centre')[0].querySelectorAll('.lookup__slash')).toHaveLength(2)
    expect(chips.every((c) => c.getAttribute('tabindex') === '0')).toBe(true)
  })

  it('names the count, singular and plural, in a polite live region', async () => {
    await type('dad')
    const one = screen.getByText('1 result')
    expect(one.getAttribute('aria-live')).toBe('polite')
    fireEvent.input(input(), { target: { value: 'cat' } })
    expect(screen.getByText('3 results')).toBeTruthy()
    expect(document.querySelector('.lookup__results')?.hasAttribute('aria-live')).toBe(false)
  })

  it('says Nothing found. when nothing matches and nothing is limited', async () => {
    await type('zzzz')
    const note = screen.getByText('Nothing found.')
    expect(note.getAttribute('aria-live')).toBe('polite')
    expect(screen.queryByRole('button', { name: 'Include later chapters' })).toBeNull()
  })

  it('caps the results at 30', async () => {
    __resetLookupCacheForTests()
    stubFetch(MANY)
    await type('a')
    expect(document.querySelectorAll('.lookup__result')).toHaveLength(30)
    expect(screen.getByText('30 results')).toBeTruthy()
  })
})

describe('Lookup and the chapters taught so far', () => {
  beforeEach(() => stubFetch(INDEX))
  const box = (): HTMLInputElement => screen.getByLabelText(/Include later chapters/) as HTMLInputElement

  it('has no checkbox while progress is loading or failed, and then nothing is limited', async () => {
    for (const status of ['loading', 'error'] as const) {
      __resetLookupCacheForTests()
      fake.value = progress(status)
      await type('centre')
      expect(screen.queryByRole('checkbox')).toBeNull()
      expect(words()).toEqual(['centre'])
      cleanup()
    }
  })

  it('is not limited by a stale state while progress is not ready', async () => {
    fake.value = { ...READY_AT(6), status: 'error' }
    await type('centre')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(words()).toEqual(['centre'])
  })

  it('has no checkbox when the limit is 26 (nothing is hidden)', async () => {
    fake.value = progress('ready', 26)
    await type('centre')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(words()).toEqual(['centre'])
  })

  it('offers the checkbox, off, with the limit in its label', async () => {
    fake.value = READY_AT(6)
    await open()
    expect(box().checked).toBe(false)
    expect(screen.getByLabelText('Include later chapters (now: Chapters up to 6)')).toBe(box())
  })

  it('hides later chapters, with a button that checks the box; the hit is then labelled later in the book', async () => {
    fake.value = READY_AT(6)
    await type('centre')
    expect(words()).toEqual([])
    expect(screen.getByText('Nothing found in Chapters up to 6.').closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite')
    fireEvent.click(screen.getByRole('button', { name: 'Include later chapters' }))
    expect(box().checked).toBe(true)
    expect(words()).toEqual(['centre'])
    expect(rows('centre')[0].textContent).toContain('later in the book')
    expect(rows('centre')[0].textContent).toContain('Chapter 21')
    // With the box on, nothing found no longer offers the button.
    fireEvent.input(input(), { target: { value: 'zzzz' } })
    expect(screen.getByText('Nothing found.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Include later chapters' })).toBeNull()
  })

  it('unchecking hides the later hit again', async () => {
    fake.value = READY_AT(6)
    await type('centre')
    fireEvent.click(box())
    expect(words()).toEqual(['centre'])
    fireEvent.click(box())
    expect(words()).toEqual([])
  })

  it('labels only the hits past the limit, not the earlier ones of the same word', async () => {
    fake.value = READY_AT(6)
    await type('are')
    expect(rows('are')).toHaveLength(2) // the chapter 16 hit is hidden
    fireEvent.click(box())
    const are = rows('are')
    expect(are).toHaveLength(3)
    expect(are.map((r) => r.textContent?.includes('later in the book'))).toEqual([false, false, true])
  })
})

describe('Lookup preview board', () => {
  beforeEach(() => stubFetch(INDEX))

  it('is hidden with no results', async () => {
    await type('zzzz')
    expect(document.querySelector('.lookup__preview')).toBeNull()
    expect(document.querySelector('.board')).toBeNull()
  })

  it('defaults to the first stroke of the first hit of the first result', async () => {
    await type('centre')
    expect(document.querySelectorAll('.lookup__preview .board')).toHaveLength(1)
    expect(lit()).toEqual(keys('S1-', 'S2-', '-E', '-P', '-B')) // SEPB
  })

  it('lights the keys of the hovered chip and keeps them after the pointer leaves', async () => {
    await type('TKAD')
    expect(lit()).toEqual(keys('T-', 'K-', 'A-', '-D'))
    fireEvent.input(input(), { target: { value: 'centre' } })
    const ter = document.querySelector('code.stroke[data-stroke="TER"]')!
    fireEvent.mouseOver(ter)
    expect(lit()).toEqual(keys('T-', '-E', '-R'))
    fireEvent.mouseOut(ter)
    expect(lit()).toEqual(keys('T-', '-E', '-R'))
  })

  it('lights the keys of a focused chip', async () => {
    await type('cat')
    const chip = document.querySelector('code.stroke[data-stroke="SKAT"]') as HTMLElement
    fireEvent.focus(chip)
    expect(lit()).toEqual(keys('S1-', 'S2-', 'K-', 'A-', '-T'))
    fireEvent.blur(chip)
    expect(lit()).toEqual(keys('S1-', 'S2-', 'K-', 'A-', '-T'))
  })

  it('goes back to the first result when the search changes', async () => {
    await type('cat')
    fireEvent.focus(document.querySelector('code.stroke[data-stroke="SKAT"]')!)
    fireEvent.input(input(), { target: { value: 'dad' } })
    expect(lit()).toEqual(keys('T-', 'K-', 'A-', '-D'))
  })
})

describe('Lookup preview stays in view', () => {
  it('carries the class the sticky rule is on', async () => {
    stubFetch(INDEX)
    await type('cat')
    expect(document.querySelector('.lookup__preview .board')).not.toBeNull()
  })

  // jsdom does not lay anything out, so the only way to guard that the preview sticks to the top of the scrolling
  // drawer body (and does not let rows show through) is to read the rule itself.
  it('is sticky at the top of the scrolling body, with a solid background, below the drawer header', () => {
    const css = readFileSync('src/ui/tools/lookup.css', 'utf8') // vitest runs from the project root
    const rule = /\.lookup__preview\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/position:\s*sticky/)
    expect(rule).toMatch(/top:\s*0\s*;/)
    expect(rule).toMatch(/background:\s*var\(--bg\)/)
    expect(rule).toMatch(/z-index:\s*1\s*;/)
  })
})

describe('Lookup in the dock drawer', () => {
  let dock: Dock
  function Probe(): JSX.Element {
    dock = useDock()
    return <span />
  }
  function mount() {
    return render(
      <DockProvider>
        <Probe />
        <DockHost />
      </DockProvider>,
    )
  }

  it('has the focus in the search box when the tool opens', async () => {
    stubFetch(INDEX)
    mount()
    act(() => dock.open('lookup'))
    const box = await screen.findByLabelText('Look up a word or a stroke')
    await waitFor(() => expect(document.activeElement).toBe(box))
    expect(box.hasAttribute('data-autofocus')).toBe(true)
    expect((box as HTMLInputElement).type).toBe('search')
  })
})
