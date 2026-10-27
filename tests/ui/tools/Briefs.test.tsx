// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import type { JSX } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo } from '../../../scripts/build-content.ts'
import type { BriefRow } from '../../../scripts/lib/tables.ts'
import { chapterStates } from '../../../src/core/progress.ts'
import type { ResultsByMode } from '../../../src/core/progress.ts'
import { DockProvider, useDock } from '../../../src/state/dock.tsx'
import type { Dock } from '../../../src/state/dock.tsx'
import type { Progress } from '../../../src/state/progress.tsx'
import { DockHost } from '../../../src/ui/DockHost.tsx'
import { Briefs, __resetBriefsCacheForTests, loadBriefs } from '../../../src/ui/tools/Briefs.tsx'

// Briefs reads the chapter limit through `useProgress`; each test hands it a fake value.
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
const READY_AT = (limit: number): Progress => progress('ready', limit)

const row = (chapter: number, kind: BriefRow['kind'], translation: string, outlines: string[], explanation: string): BriefRow => ({
  chapter,
  kind,
  translation,
  outlines,
  explanation,
})

/** 14 rows; the file order is deliberately NOT ascending by chapter, so grouping has to do the sorting. */
const BRIEFS: BriefRow[] = [
  row(5, 'chapter', 'are', ['R', '-R'], 'Sounds like the letter "R"'),
  row(5, 'chapter', 'do', ['TKO'], 'Matches the spelling'),
  row(6, 'chapter', 'you', ['U'], 'Sounds like the letter "U"'),
  row(5, 'extra', 'because', ['BAUZ'], 'Short for the whole word'),
  row(5, 'chapter', 'the', ['-T'], 'Common word for a single key brief'),
  row(6, 'chapter', 'and', ['SKP'], 'The ampersand: "&" <b>not bold</b>'),
  row(6, 'extra', 'something', ['SUPBG'], 'Drops the vowel'),
  row(12, 'chapter', 'would', ['WO'], 'Common word'),
  row(8, 'chapter', 'with', ['W'], 'Matches the spelling'),
  row(8, 'chapter', 'center', ['SEPB/TER'], 'Two strokes'),
  row(8, 'extra', 'just', ['SKWR'], 'Common word'),
  row(12, 'chapter', 'which', ['WEUFP'], 'Matches the spelling'),
  row(12, 'extra', 'been', ['PWEPB'], 'Drops the vowel'),
  row(12, 'chapter', 'could', ['KO'], 'Matches the spelling'),
]

/** Each fetch gets the next reply (the last one repeats): a list, or 'fail'. */
function stubFetch(...replies: Array<BriefRow[] | 'fail'>) {
  let n = 0
  const fn = vi.fn(async (url: string) => {
    const next = replies[Math.min(n++, replies.length - 1)]
    if (url !== '/content/briefs.json' || next === 'fail') return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => next }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  fake.value = progress('ready')
  __resetBriefsCacheForTests()
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  fake.value = null
  __resetBriefsCacheForTests()
  vi.unstubAllGlobals()
})

const input = (): HTMLInputElement => screen.getByLabelText('Filter briefs') as HTMLInputElement
const box = (): HTMLInputElement => screen.getByLabelText(/Include later chapters/) as HTMLInputElement

/** Opens the tool and waits for the list. */
async function open(): Promise<void> {
  render(<Briefs />)
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
}
async function filter(text: string): Promise<void> {
  await open()
  fireEvent.input(input(), { target: { value: text } })
}
const headings = (): string[] => [...document.querySelectorAll('h3')].map((e) => e.textContent ?? '')
const translations = (): string[] => [...document.querySelectorAll('.briefs__translation')].map((e) => e.textContent ?? '')
const item = (translation: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('.briefs__row')].find((e) => e.querySelector('.briefs__translation')?.textContent === translation)
  if (!found) throw new Error(`no row for ${translation}`)
  return found
}
/** The count line (or the empty note): the only text under an aria-live region. */
const live = (): string[] => [...document.querySelectorAll('[aria-live]')].map((e) => e.textContent ?? '')

describe('Briefs loading and the cache', () => {
  it('shows Loading… and the filter box at once, and then the list', async () => {
    stubFetch(BRIEFS)
    render(<Briefs />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(input()).toBeTruthy()
    await screen.findByText('14 briefs')
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it('fetches once: a second open (unmount, mount) reuses the cache, with no Loading… flash', async () => {
    const fetchFn = stubFetch(BRIEFS)
    const first = render(<Briefs />)
    await screen.findByText('14 briefs')
    first.unmount()
    render(<Briefs />)
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByText('14 briefs')).toBeTruthy()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('a failed fetch shows the message and the filter box, is not cached, and Try again refetches', async () => {
    const fetchFn = stubFetch('fail', BRIEFS)
    render(<Briefs />)
    expect(await screen.findByText("Couldn't load the briefs.")).toBeTruthy()
    expect(input()).toBeTruthy()
    expect(screen.queryByText('14 briefs')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('14 briefs')
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(screen.queryByText("Couldn't load the briefs.")).toBeNull()
  })

  it('a failure is not cached for the next open either', async () => {
    const fetchFn = stubFetch('fail', BRIEFS)
    const first = render(<Briefs />)
    await screen.findByText("Couldn't load the briefs.")
    first.unmount()
    render(<Briefs />)
    await screen.findByText('14 briefs')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('a reply that is not a list is a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) })))
    render(<Briefs />)
    expect(await screen.findByText("Couldn't load the briefs.")).toBeTruthy()
  })

  it('unmounting before the fetch settles leaves nothing behind and does not throw', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate
        return { ok: true, status: 200, json: async () => BRIEFS }
      }),
    )
    const view = render(<Briefs />)
    view.unmount()
    release()
    await act(async () => {
      await loadBriefs()
    })
    expect(document.body.textContent).toBe('')
  })

  it('a request that settles after the cache was reset does not leak into the next open', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate
        return { ok: true, status: 200, json: async () => BRIEFS }
      }),
    )
    const stale = loadBriefs()
    __resetBriefsCacheForTests()
    release()
    await stale
    // The next open starts from scratch: it must not find the stale reply in its first render.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<Briefs />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText('14 briefs')).toBeNull()
  })
})

describe('Briefs list', () => {
  beforeEach(() => stubFetch(BRIEFS))

  it('groups the rows under Chapter N headings, ascending, whatever the order in the file', async () => {
    await open()
    expect(headings()).toEqual(['Chapter 5', 'Chapter 6', 'Chapter 8', 'Chapter 12'])
  })

  it('keeps the file order inside a chapter', async () => {
    await open()
    expect(translations()).toEqual([
      'are', 'do', 'because', 'the', // chapter 5
      'you', 'and', 'something', // chapter 6
      'with', 'center', 'just', // chapter 8
      'would', 'which', 'been', 'could', // chapter 12
    ])
  })

  it('puts each row under its own chapter heading', async () => {
    await open()
    for (const section of document.querySelectorAll('section')) {
      const n = Number(section.querySelector('h3')?.textContent?.replace('Chapter ', ''))
      const names = [...section.querySelectorAll('.briefs__translation')].map((e) => e.textContent)
      const expected = BRIEFS.filter((b) => b.chapter === n).map((b) => b.translation)
      expect(names).toEqual(expected)
    }
  })

  it('shows the translation, the outline chips and the explanation of a row', async () => {
    await open()
    const the = item('the')
    expect(the.querySelector('.briefs__translation')?.textContent).toBe('the')
    expect(the.querySelector('code.stroke')?.textContent).toBe('-T')
    expect(the.querySelector('.briefs__explanation')?.textContent).toBe('Common word for a single key brief')
  })

  it('draws one chip per stroke, with a separator between the strokes of an outline', async () => {
    await open()
    const chips = [...item('center').querySelectorAll('code.stroke')]
    expect(chips.map((c) => c.getAttribute('data-stroke'))).toEqual(['SEPB', 'TER'])
    expect(chips.map((c) => c.textContent)).toEqual(['SEPB', 'TER'])
    expect(item('center').querySelectorAll('.briefs__slash')).toHaveLength(1)
    expect(chips.every((c) => c.getAttribute('tabindex') === '0')).toBe(true)
  })

  it('puts or between the outlines of a row that has several, and nowhere else', async () => {
    await open()
    const are = item('are')
    expect([...are.querySelectorAll('code.stroke')].map((c) => c.getAttribute('data-stroke'))).toEqual(['R', '-R'])
    expect([...are.querySelectorAll('.briefs__or')].map((e) => e.textContent)).toEqual(['or'])
    expect(are.querySelectorAll('.briefs__outline')).toHaveLength(2)
    expect(item('do').querySelectorAll('.briefs__or')).toHaveLength(0)
    expect(item('center').querySelectorAll('.briefs__or')).toHaveLength(0)
  })

  it('labels only the extra rows with extra', async () => {
    await open()
    const labelled = [...document.querySelectorAll('.briefs__row')]
      .filter((e) => e.querySelector('.briefs__extra'))
      .map((e) => e.querySelector('.briefs__translation')?.textContent)
    expect(labelled).toEqual(['because', 'something', 'just', 'been'])
    expect(item('because').querySelector('.briefs__extra')?.textContent).toBe('extra')
  })

  it('renders an explanation with quotes and markup characters as plain text', async () => {
    await open()
    const and = item('and')
    expect(and.querySelector('.briefs__explanation')?.textContent).toBe('The ampersand: "&" <b>not bold</b>')
    expect(and.querySelector('b')).toBeNull()
    expect(item('are').querySelector('.briefs__explanation')?.textContent).toBe('Sounds like the letter "R"')
  })

  it('names the count in a polite live region, and nothing else is live', async () => {
    await open()
    expect(screen.getByText('14 briefs').getAttribute('aria-live')).toBe('polite')
    expect(live()).toEqual(['14 briefs'])
  })
})

describe('Briefs filter', () => {
  beforeEach(() => stubFetch(BRIEFS))

  it('is a search box with the focus hook', async () => {
    await open()
    expect(input().type).toBe('search')
    expect(input().hasAttribute('data-autofocus')).toBe(true)
  })

  it('matches the translation', async () => {
    await filter('because')
    expect(translations()).toEqual(['because'])
    expect(screen.getByText('1 brief')).toBeTruthy()
  })

  it('matches an outline, case-insensitively', async () => {
    await filter('TKO')
    expect(translations()).toEqual(['do'])
    fireEvent.input(input(), { target: { value: 'tko' } })
    expect(translations()).toEqual(['do'])
  })

  it('matches any one of the outlines of a row, and part of an outline', async () => {
    await filter('-R')
    expect(translations()).toContain('are')
    fireEvent.input(input(), { target: { value: 'SEPB' } })
    expect(translations()).toEqual(['center'])
  })

  it('matches the explanation, case-insensitively', async () => {
    await filter('LETTER')
    expect(translations()).toEqual(['are', 'you'])
    fireEvent.input(input(), { target: { value: 'ampersand' } })
    expect(translations()).toEqual(['and'])
  })

  it('matches a quote or an & typed in the box', async () => {
    await filter('"&"')
    expect(translations()).toEqual(['and'])
  })

  it('a row matching in only one of the three places is still found', async () => {
    await filter('word')
    // explanation only: none of these has it in the translation or an outline
    expect(translations()).toEqual(['because', 'the', 'just', 'would'])
  })

  it('combines with the chapter limit, and a heading with no rows left disappears', async () => {
    fake.value = READY_AT(6)
    await filter('spelling')
    expect(headings()).toEqual(['Chapter 5'])
    expect(translations()).toEqual(['do'])
    fireEvent.click(box())
    expect(headings()).toEqual(['Chapter 5', 'Chapter 8', 'Chapter 12'])
    expect(translations()).toEqual(['do', 'with', 'which', 'could'])
  })

  it('ignores the spaces around the filter text, and an all-space filter filters nothing', async () => {
    await filter('  because ')
    expect(translations()).toEqual(['because'])
    fireEvent.input(input(), { target: { value: '   ' } })
    expect(translations()).toHaveLength(14)
  })

  it('says No briefs match. when nothing matches, in a polite live region, with no button', async () => {
    await filter('zzzz')
    const note = screen.getByText('No briefs match.')
    expect(note.closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite')
    expect(translations()).toEqual([])
    expect(screen.queryByRole('button', { name: 'Include later chapters' })).toBeNull()
  })
})

describe('Briefs and the chapters taught so far', () => {
  beforeEach(() => stubFetch(BRIEFS))

  it('has no checkbox while progress is loading or failed, and then nothing is limited', async () => {
    for (const status of ['loading', 'error'] as const) {
      __resetBriefsCacheForTests()
      fake.value = progress(status)
      await open()
      expect(screen.queryByRole('checkbox')).toBeNull()
      expect(translations()).toHaveLength(14)
      expect(screen.getByText('14 briefs')).toBeTruthy()
      cleanup()
    }
  })

  it('is not limited by a stale state while progress is not ready', async () => {
    fake.value = { ...READY_AT(6), status: 'error' }
    await open()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(translations()).toHaveLength(14)
  })

  it('has no checkbox when the limit is 26 (nothing is hidden)', async () => {
    fake.value = progress('ready', 26)
    await open()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('14 briefs')).toBeTruthy()
  })

  it('offers the checkbox, off, with the limit in its label', async () => {
    fake.value = READY_AT(6)
    await open()
    expect(box().checked).toBe(false)
    expect(screen.getByLabelText('Include later chapters (now: Chapters up to 6)')).toBe(box())
  })

  it('hides the rows past the limit and says how many: N briefs (M in later chapters hidden)', async () => {
    fake.value = READY_AT(6)
    await open()
    expect(headings()).toEqual(['Chapter 5', 'Chapter 6'])
    expect(screen.getByText('7 briefs (7 in later chapters hidden)').getAttribute('aria-live')).toBe('polite')
    expect(translations()).not.toContain('with')
    expect(translations()).not.toContain('could')
  })

  it('counts only the hidden rows that match the filter', async () => {
    fake.value = READY_AT(6)
    await filter('spelling') // do (chapter 5) is shown; with, which and could are hidden; the other 10 do not match
    expect(screen.getByText('1 brief (3 in later chapters hidden)')).toBeTruthy()
    fireEvent.input(input(), { target: { value: 'common' } }) // the (5) shown; just (8) and would (12) hidden
    expect(screen.getByText('1 brief (2 in later chapters hidden)')).toBeTruthy()
    fireEvent.input(input(), { target: { value: 'letter' } }) // are and you shown; nothing hidden
    expect(screen.getByText('2 briefs')).toBeTruthy()
    expect(document.body.textContent).not.toContain('hidden')
  })

  it('the checkbox reveals the later chapters and the count loses the parenthetical', async () => {
    fake.value = READY_AT(6)
    await open()
    fireEvent.click(box())
    expect(box().checked).toBe(true)
    expect(headings()).toEqual(['Chapter 5', 'Chapter 6', 'Chapter 8', 'Chapter 12'])
    expect(screen.getByText('14 briefs')).toBeTruthy()
    expect(document.body.textContent).not.toContain('hidden')
    fireEvent.click(box())
    expect(headings()).toEqual(['Chapter 5', 'Chapter 6'])
    expect(screen.getByText('7 briefs (7 in later chapters hidden)')).toBeTruthy()
  })

  it('limits at the limit itself: a row of chapter 6 is shown at limit 6 and hidden at limit 5', async () => {
    fake.value = READY_AT(6)
    await open()
    expect(headings()).toContain('Chapter 6')
    cleanup()
    fake.value = READY_AT(5)
    await open()
    expect(headings()).toEqual(['Chapter 5'])
    expect(screen.getByText('4 briefs (10 in later chapters hidden)')).toBeTruthy()
  })

  it('says No briefs yet in Chapters up to N. with a button that checks the box, when the limit hides everything', async () => {
    fake.value = READY_AT(4)
    await open()
    const note = screen.getByText('No briefs yet in Chapters up to 4.')
    expect(note.closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite')
    expect(translations()).toEqual([])
    expect(screen.queryByText('No briefs match.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Include later chapters' }))
    expect(box().checked).toBe(true)
    expect(screen.getByText('14 briefs')).toBeTruthy()
    expect(screen.queryByText(/No briefs yet/)).toBeNull()
  })

  it('with a filter that hits nothing the limit shows, says No briefs match. and still offers the later chapters', async () => {
    fake.value = READY_AT(4)
    await filter('would')
    expect(screen.getByText('No briefs match.')).toBeTruthy()
    expect(screen.queryByText(/No briefs yet/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Include later chapters' }))
    expect(translations()).toEqual(['would'])
  })

  it('with a filter that hits nothing at all, offers no button even when limited', async () => {
    fake.value = READY_AT(4)
    await filter('zzzz')
    expect(screen.getByText('No briefs match.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Include later chapters' })).toBeNull()
  })
})

describe('Briefs in the dock drawer', () => {
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

  it('has the focus in the filter box when the tool opens', async () => {
    stubFetch(BRIEFS)
    mount()
    act(() => dock.open('briefs'))
    const filterBox = await screen.findByLabelText('Filter briefs')
    await waitFor(() => expect(document.activeElement).toBe(filterBox))
    expect(screen.getByRole('dialog', { name: 'Briefs so far' })).toBeTruthy()
    await screen.findByText('14 briefs')
    expect(document.activeElement).toBe(filterBox)
  })
})
