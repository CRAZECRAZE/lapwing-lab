// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import type { JSX } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DictCard, DictionaryFile } from '../../../scripts/lib/dictionary.ts'
import { DockProvider, useDock } from '../../../src/state/dock.tsx'
import type { Dock } from '../../../src/state/dock.tsx'
import { DockHost } from '../../../src/ui/DockHost.tsx'
import { Lookup, __resetDictionaryCacheForTests } from '../../../src/ui/tools/Lookup.tsx'

const START = 'Start typing to look something up.'
const FAILED = "Couldn't load the dictionary."

const CARDS: DictCard[] = [
  { t: 'cat', r: [{ o: 'KAT', b: [{ chapter: 5, source: 'practice' }] }] },
  { t: 'Cat', r: [{ o: 'KAT' }] },
  { t: 'catch', r: [{ o: 'KAFP', b: [{ chapter: 7, source: 'practice' }] }] },
  { t: 'scat', r: [{ o: 'SKAT', b: [{ chapter: 6, source: 'practice' }] }] },
  { t: 'the', r: [{ o: '-T', b: [{ chapter: 5, source: 'brief', note: 'the short form' }] }] },
  { t: 'especially', r: [{ o: 'EPS' }, { o: 'ES/PERB/HREU' }, { o: 'ES/PERBL/KWREU' }] },
  {
    t: 'dad',
    r: [
      {
        o: 'TKAD',
        b: [
          { chapter: 5, source: 'practice' },
          { chapter: 5, source: 'example' },
        ],
      },
    ],
  },
  {
    t: 'mistake',
    r: [
      { o: 'SPHAEUBG' },
      {
        o: 'PHEUS/TAEUBG',
        b: [
          { chapter: 13, source: 'example' },
          { chapter: 13, source: 'brief', note: 'two strokes' },
          { chapter: 20, source: 'practice' },
        ],
      },
    ],
  },
  {
    t: 'around',
    r: [
      { o: 'ARPBD' },
      { o: 'A/ROUPBD', b: [{ chapter: 13, source: 'example' }] },
      { o: 'APB/ROUPBD', b: [{ chapter: 13, source: 'example' }], x: true },
    ],
  },
  { t: '{^\n^}', r: [{ o: 'TKPWHR*EPB' }] },
  { t: '{^}.sh', r: [{ o: 'SH-PBG', f: ['names'] }] },
  { t: 'colour', r: [{ o: 'KHUR', f: ['uk'] }, { o: 'KHOUR', f: ['uk', 'names'] }, { o: 'KHO*UR', f: ['numbers', 'commands', 'movement'] }] },
  {
    t: 'Comma (,)',
    n: true,
    r: [
      { o: 'KW-BG', b: [{ chapter: 20, source: 'practice' }], w: ['{,}', '{^,^}'] },
      { o: 'KW-BG/KW-BG', b: [{ chapter: 20, source: 'practice' }], w: [] },
    ],
  },
  { t: 'i', r: [{ o: 'EU' }] },
  { t: 'I', r: [{ o: 'EU' }, { o: 'PWR-PB' }] },
  {
    t: '.',
    r: [
      { o: 'TP-PL', b: [{ chapter: 5, source: 'brief', note: 'Symmetrical shape.' }], x: true, w: ['{.}', '{^\n^}'] },
      { o: 'TP*PL', x: true },
    ],
  },
  ...Array.from({ length: 40 }, (_, i): DictCard => ({ t: `aa${i + 1}`, r: [{ o: 'AEU' }] })),
]

const LETTERS: Record<string, string> = { a: 'A*', c: 'KR*', d: 'TKPW*', k: 'K*', q: 'KW*', t: 'T*', z: 'STKPW*' }
const FILE: DictionaryFile = { commit: 'abc', cards: CARDS, letters: LETTERS }

type Reply = DictionaryFile | 'fail' | unknown

/** Each fetch gets the next reply (the last one repeats): a dictionary, 'fail', or any other body. */
function stubFetch(...replies: Reply[]) {
  let n = 0
  const fn = vi.fn(async (url: string) => {
    const next = replies[Math.min(n++, replies.length - 1)]
    if (url !== '/content/dictionary.json' || next === 'fail') return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => next }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  __resetDictionaryCacheForTests()
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  __resetDictionaryCacheForTests()
  vi.unstubAllGlobals()
})

const input = (): HTMLInputElement => screen.getByLabelText('Look up a word or a stroke') as HTMLInputElement

/** Opens the tool and waits for the dictionary. */
async function open(): Promise<void> {
  render(<Lookup />)
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
}
function enter(text: string): void {
  fireEvent.input(input(), { target: { value: text } })
}
async function type(text: string): Promise<void> {
  await open()
  enter(text)
}
const words = (): string[] => [...document.querySelectorAll('.lookup__word')].map((e) => e.textContent ?? '')
const cardOf = (word: string): HTMLElement => {
  const item = [...document.querySelectorAll<HTMLElement>('.lookup__result')].find((e) => e.querySelector('.lookup__word')?.textContent === word)
  if (!item) throw new Error(`no card ${word}`)
  return item
}
const rows = (word: string): HTMLElement[] => [...cardOf(word).querySelectorAll<HTMLElement>('.lookup__row')]
const strokes = (row: HTMLElement): string[] => [...row.querySelectorAll('code.stroke')].map((c) => c.getAttribute('data-stroke') ?? '')
const keys = (...levers: string[]): string[] => [...levers].sort()
const lit = (): string[] =>
  [...document.querySelectorAll('.lookup__preview .key--target')].map((e) => e.getAttribute('data-lever') ?? '').sort()
const WRITTEN = 'The dictionary writes this outline as:'

describe('Lookup loading and the cache', () => {
  it('shows Loading… and then the start message, with the search box there throughout', async () => {
    stubFetch(FILE)
    render(<Lookup />)
    expect(screen.getByText('Loading…').getAttribute('aria-live')).toBe('polite')
    expect(input()).toBeTruthy()
    await screen.findByText(START)
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it('fetches once: a second open (unmount, mount) reuses the cache and shows no loading flash', async () => {
    const fetchFn = stubFetch(FILE)
    const first = render(<Lookup />)
    await screen.findByText(START)
    first.unmount()
    render(<Lookup />)
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByText(START)).toBeTruthy()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('a failed fetch shows the message, is not cached, and Try again refetches', async () => {
    const fetchFn = stubFetch('fail', FILE)
    render(<Lookup />)
    expect(await screen.findByText(FAILED)).toBeTruthy()
    expect(screen.getByText(FAILED).closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite')
    expect(screen.queryByText(START)).toBeNull()
    expect(input()).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText(START)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(FAILED)).toBeNull()
  })

  it('a failure is not cached for the next open either', async () => {
    const fetchFn = stubFetch('fail', FILE)
    const first = render(<Lookup />)
    await screen.findByText(FAILED)
    first.unmount()
    render(<Lookup />)
    await screen.findByText(START)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('a body that is not { cards: [...] } counts as a failure', async () => {
    for (const body of [[], {}, { cards: 'no' }, null, { cards: [], letters: 5 }]) {
      __resetDictionaryCacheForTests()
      stubFetch(body)
      render(<Lookup />)
      expect(await screen.findByText(FAILED), JSON.stringify(body)).toBeTruthy()
      cleanup()
    }
  })

  it('tolerates a missing letters table', async () => {
    stubFetch({ commit: 'abc', cards: CARDS })
    await type('zzzz')
    expect(screen.getByText('Not in the dictionary.')).toBeTruthy()
    expect(screen.queryByText('Fingerspell it:')).toBeNull()
  })

  it('a query typed while loading is searched when the data arrives', async () => {
    let release: (reply: unknown) => void = () => {}
    const gate = new Promise<unknown>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => gate })),
    )
    render(<Lookup />)
    enter('dad')
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(input().value).toBe('dad')
    release(FILE)
    expect(await screen.findByText('1 result')).toBeTruthy()
    expect(words()).toEqual(['dad'])
  })

  it('a late settle after the reset does not leak into the next open', async () => {
    let release: (reply: unknown) => void = () => {}
    const gate = new Promise<unknown>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => gate })),
    )
    const first = render(<Lookup />)
    first.unmount()
    __resetDictionaryCacheForTests()
    release(FILE)
    // Let the late request finish all the way (a macrotask, so every promise step has run).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // The next open must start from nothing: fetch again and show Loading…, not the data the old request brought.
    const fetchFn = vi.fn(() => new Promise<never>(() => {}))
    vi.stubGlobal('fetch', fetchFn)
    render(<Lookup />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText(START)).toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('Lookup searching', () => {
  beforeEach(() => stubFetch(FILE))

  it('shows the start message for an empty or whitespace-only query', async () => {
    await open()
    expect(screen.getByText(START).getAttribute('aria-live')).toBe('polite')
    enter('   ')
    expect(screen.getByText(START)).toBeTruthy()
    expect(screen.queryByText('Not in the dictionary.')).toBeNull()
    expect(words()).toEqual([])
    expect(document.querySelector('.lookup__preview')).toBeNull()
  })

  it('puts the exact word before its prefix and substring matches, the same text before another case', async () => {
    await type('cat')
    expect(words()).toEqual(['cat', 'Cat', 'catch', 'scat'])
  })

  it('searches without regard to case', async () => {
    await type('CATCH')
    expect(words()).toEqual(['catch'])
  })

  it('finds a card by an outline query (upper case), emphasising the rows that hit and keeping the row order', async () => {
    await type('TKAD')
    expect(words()).toEqual(['dad'])
    enter('PHEUS')
    expect(words()).toEqual(['mistake'])
    const mistake = rows('mistake')
    expect(mistake.map((r) => strokes(r).join('/'))).toEqual(['SPHAEUBG', 'PHEUS/TAEUBG'])
    expect(mistake.map((r) => r.classList.contains('lookup__row--hit'))).toEqual([false, true])
  })

  it('does not emphasise any row for a word match', async () => {
    await type('mistake')
    expect(document.querySelector('.lookup__row--hit')).toBeNull()
  })

  it('does not search outlines with lower-case text', async () => {
    await type('tkad')
    expect(words()).toEqual([])
    expect(screen.getByText('Not in the dictionary.')).toBeTruthy()
  })

  it('names the count, singular and plural, in a polite live region that is not the list', async () => {
    await type('dad')
    expect(screen.getByText('1 result').getAttribute('aria-live')).toBe('polite')
    enter('cat')
    expect(screen.getByText('4 results')).toBeTruthy()
    expect(document.querySelector('.lookup__results')?.hasAttribute('aria-live')).toBe(false)
  })

  it('counts every match, not only the shown cards', async () => {
    await type('aa')
    expect(screen.getByText('40 results')).toBeTruthy()
    expect(document.querySelectorAll('.lookup__result')).toHaveLength(30)
  })

  it('lists the rows of a card in the order the data gives', async () => {
    await type('especially')
    expect(rows('especially').map((r) => strokes(r).join('/'))).toEqual(['EPS', 'ES/PERB/HREU', 'ES/PERBL/KWREU'])
  })

  it('does not break on a very long query', async () => {
    await type('qzx'.repeat(2000))
    expect(screen.getByText('Not in the dictionary.')).toBeTruthy()
    expect(screen.queryByText('Fingerspell it:')).toBeNull()
    enter('Q'.repeat(5000))
    expect(screen.getByText('Not in the dictionary.')).toBeTruthy()
  })

  it('renders no checkbox and no chapter limit', async () => {
    await type('cat')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(document.body.textContent).not.toContain('Include later chapters')
    expect(document.body.textContent).not.toContain('later in the book')
  })
})

describe('Lookup cards', () => {
  beforeEach(() => stubFetch(FILE))

  it('shows the chapter and the kinds of the book (practice as practice list), then the note', async () => {
    await type('dad')
    const row = rows('dad')[0]
    expect(row.textContent).toContain('Chapter 5')
    expect(row.querySelector('.lookup__sources')?.textContent).toBe('practice list, example')
    enter('catch')
    expect(rows('catch')[0].textContent).toContain('Chapter 7')
    expect(rows('catch')[0].querySelector('.lookup__sources')?.textContent).toBe('practice list')
    enter('the')
    expect(cardOf('the').textContent).toContain('the short form')
  })

  it('merges labels of a chapter into one group, keeps a group per chapter, and puts brief before example', async () => {
    await type('mistake')
    const groups = [...rows('mistake')[1].querySelectorAll('.lookup__label-group')]
    expect(groups).toHaveLength(2)
    expect(groups[0].querySelector('.lookup__where')?.textContent).toBe('Chapter 13')
    expect(groups[0].querySelector('.lookup__sources')?.textContent).toBe('brief, example')
    expect(groups[0].querySelector('.lookup__hit-note')?.textContent).toBe('two strokes')
    expect(groups[1].querySelector('.lookup__where')?.textContent).toBe('Chapter 20')
    expect(groups[1].querySelector('.lookup__sources')?.textContent).toBe('practice list')
    expect(groups[1].querySelector('.lookup__hit-note')).toBeNull()
    expect(rows('mistake')[0].querySelector('.lookup__label-group')).toBeNull()
  })

  it('tags rows that come from the other files, and none for the main file', async () => {
    await type('colour')
    expect(rows('colour').map((r) => [...r.querySelectorAll('.lookup__tag')].map((t) => t.textContent))).toEqual([
      ['UK'],
      ['UK', 'names'],
      ['numbers', 'commands', 'movement'],
    ])
    enter('cat')
    expect(cardOf('cat').querySelector('.lookup__tag')).toBeNull()
  })

  it('says book only on an x row, and only there', async () => {
    await type('around')
    expect(rows('around').map((r) => r.textContent?.includes('book only'))).toEqual([false, false, true])
    expect(rows('around')[2].textContent).not.toContain(WRITTEN)
  })

  it('a book-only row with w shows what the dictionary writes, and one without w shows only book only', async () => {
    await type('.')
    const [withW, without] = rows('.')
    expect(withW.textContent).toContain('book only')
    const line = withW.querySelector('.lookup__written')!
    expect(line.textContent).toContain(WRITTEN)
    expect([...line.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['{.}', '{^\\n^}'])
    expect(without.textContent).toContain('book only')
    expect(without.textContent).not.toContain(WRITTEN)
    expect(without.textContent).not.toContain('not in the dictionary')
  })

  it('keeps the order: chips, book labels, tags, book only, the dictionary line', async () => {
    const card: DictCard = {
      t: 'zed',
      r: [{ o: 'STKPW*', b: [{ chapter: 9, source: 'brief' }], f: ['uk'], x: true, w: ['{z}'] }],
    }
    stubFetch({ ...FILE, cards: [card] })
    await type('zed')
    const text = rows('zed')[0].textContent ?? ''
    const at = ['STKPW*', 'Chapter 9', 'UK', 'book only', WRITTEN, '{z}'].map((s) => text.indexOf(s))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('a named card carries a from the book marker; a dictionary card does not', async () => {
    await type('comma')
    expect(words()).toEqual(['Comma (,)'])
    expect(cardOf('Comma (,)').querySelector('.lookup__named')?.textContent).toBe('from the book')
    enter('cat')
    expect(document.querySelector('.lookup__named')).toBeNull()
  })

  it('a named card shows what the dictionary writes, or not in the dictionary when it has none', async () => {
    await type('comma')
    const [first, second] = rows('Comma (,)')
    expect(first.textContent).toContain(WRITTEN)
    expect([...first.querySelectorAll('.lookup__written code')].map((c) => c.textContent)).toEqual(['{,}', '{^,^}'])
    expect(second.textContent).toContain('not in the dictionary')
    expect(second.textContent).not.toContain(WRITTEN)
    expect(first.textContent).not.toContain('not in the dictionary')
    expect(first.textContent).not.toContain('book only')
  })

  it('shows a card with a newline in its text with a visible backslash-n, in monospace', async () => {
    await type('{^')
    const heading = [...document.querySelectorAll('.lookup__word')].find((e) => e.textContent === '{^\\n^}')
    expect(heading).toBeTruthy()
    expect(heading!.classList.contains('lookup__word--code')).toBe(true)
    expect(document.body.textContent).not.toContain('{^\n^}')
  })

  it('uses monospace for Plover syntax and odd characters, and normal text for words and plain punctuation', async () => {
    await type('{^}.sh')
    expect(cardOf('{^}.sh').querySelector('.lookup__word')!.classList.contains('lookup__word--code')).toBe(true)
    expect(cardOf('{^}.sh').querySelector('.lookup__tag')?.textContent).toBe('names')
    enter('Comma')
    expect(cardOf('Comma (,)').querySelector('.lookup__word')!.classList.contains('lookup__word--code')).toBe(false)
    enter('cat')
    expect(cardOf('cat').querySelector('.lookup__word')!.classList.contains('lookup__word--code')).toBe(false)
    enter('.')
    expect(cardOf('.').querySelector('.lookup__word')!.classList.contains('lookup__word--code')).toBe(false)
  })

  it('keeps the cards that differ only in case apart', async () => {
    await type('i')
    expect(words().slice(0, 2)).toEqual(['i', 'I'])
  })

  it('draws one chip per stroke of a multi-stroke outline, with a separator between them', async () => {
    await type('especially')
    const row = rows('especially')[2]
    const chips = [...row.querySelectorAll('code.stroke')]
    expect(chips.map((c) => c.getAttribute('data-stroke'))).toEqual(['ES', 'PERBL', 'KWREU'])
    expect(chips.map((c) => c.textContent)).toEqual(['ES', 'PERBL', 'KWREU'])
    expect(row.querySelectorAll('.lookup__slash')).toHaveLength(2)
    expect(chips.every((c) => c.getAttribute('tabindex') === '0')).toBe(true)
  })
})

describe('Lookup paging', () => {
  beforeEach(() => stubFetch(FILE))
  const count = (): number => document.querySelectorAll('.lookup__result').length

  it('shows 30 cards, Show more adds 30, and the button goes when everything is shown', async () => {
    await type('aa')
    expect(count()).toBe(30)
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(count()).toBe(40)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    expect(screen.getByText('40 results')).toBeTruthy()
  })

  it('has no Show more when 30 or fewer match', async () => {
    await type('cat')
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('a new query goes back to 30', async () => {
    await type('aa')
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(count()).toBe(40)
    enter('aa1')
    expect(count()).toBe(11)
    enter('aa')
    expect(count()).toBe(30)
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy()
  })

  it('shows the next cards in order', async () => {
    await type('aa')
    expect(words()[0]).toBe('aa1')
    expect(words()).toHaveLength(30)
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(new Set(words()).size).toBe(40)
  })
})

describe('Lookup not found', () => {
  beforeEach(() => stubFetch(FILE))
  const chips = (): string[] => [...document.querySelectorAll('.lookup__fingerspell code.stroke')].map((c) => c.getAttribute('data-stroke') ?? '')

  it('says Not in the dictionary. in a polite live region, with fingerspelling chips for lower-case letters', async () => {
    await type('tkad')
    const note = screen.getByText('Not in the dictionary.')
    expect(note.getAttribute('aria-live')).toBe('polite')
    expect(screen.getByText('Fingerspell it:')).toBeTruthy()
    expect(chips()).toEqual(['T*', 'K*', 'A*', 'TKPW*'])
    expect(screen.queryByText('0 results')).toBeNull()
  })

  it('offers no fingerspelling for upper case, mixed text, digits, spaces inside, or a missing letter', async () => {
    await open()
    for (const query of ['ZZZZ', 'Zzzz', 'zz1', 'z z', 'zzy']) {
      enter(query)
      expect(screen.getByText('Not in the dictionary.'), query).toBeTruthy()
      expect(screen.queryByText('Fingerspell it:'), query).toBeNull()
    }
  })

  it('fingerspells a query with spaces around it, and not at all when the query is found', async () => {
    await type('  zz  ')
    expect(chips()).toEqual(['STKPW*', 'STKPW*'])
    enter('cat')
    expect(screen.queryByText('Fingerspell it:')).toBeNull()
  })

  it('fingerspells at most 40 letters, so a pasted paragraph does not draw thousands of chips', async () => {
    await type('t'.repeat(40))
    expect(chips()).toHaveLength(40)
    enter('t'.repeat(41))
    expect(screen.getByText('Not in the dictionary.')).toBeTruthy()
    expect(screen.queryByText('Fingerspell it:')).toBeNull()
  })

  it('feeds the preview board from the fingerspelling chips, and has no board before one is hovered', async () => {
    await type('tkad')
    expect(document.querySelector('.lookup__preview')).toBeNull()
    fireEvent.mouseOver(document.querySelector('.lookup__fingerspell code.stroke[data-stroke="K*"]')!)
    expect(lit()).toEqual(keys('K-', '*1', '*2', '*3', '*4'))
    enter('zzz')
    expect(document.querySelector('.lookup__preview')).toBeNull()
  })
})

describe('Lookup preview board', () => {
  beforeEach(() => stubFetch(FILE))

  it('is hidden with no results and with no query', async () => {
    await open()
    expect(document.querySelector('.lookup__preview')).toBeNull()
    enter('qqqq')
    expect(document.querySelector('.lookup__preview')).toBeNull()
    expect(document.querySelector('.board')).toBeNull()
  })

  it('defaults to the first stroke of the first row of the first card', async () => {
    await type('especially')
    expect(document.querySelectorAll('.lookup__preview .board')).toHaveLength(1)
    expect(lit()).toEqual(keys('-E', '-P', '-S')) // EPS
  })

  it('lights the keys of the hovered chip and keeps them after the pointer leaves', async () => {
    await type('TKAD')
    expect(lit()).toEqual(keys('T-', 'K-', 'A-', '-D'))
    enter('especially')
    const perb = document.querySelector('code.stroke[data-stroke="PERB"]')!
    fireEvent.mouseOver(perb)
    expect(lit()).toEqual(keys('P-', '-E', '-R', '-B'))
    fireEvent.mouseOut(perb)
    expect(lit()).toEqual(keys('P-', '-E', '-R', '-B'))
  })

  it('lights the keys of a focused chip', async () => {
    await type('cat')
    const scat = cardOf('scat').querySelector('code.stroke') as HTMLElement
    fireEvent.focus(scat)
    expect(lit()).toEqual(keys('S1-', 'S2-', 'K-', 'A-', '-T'))
    fireEvent.blur(scat)
    expect(lit()).toEqual(keys('S1-', 'S2-', 'K-', 'A-', '-T'))
  })

  it('goes back to the first card when the search changes', async () => {
    await type('cat')
    fireEvent.focus(cardOf('scat').querySelector('code.stroke')!)
    enter('dad')
    expect(lit()).toEqual(keys('T-', 'K-', 'A-', '-D'))
  })

  it('shows nothing for a stroke the parser rejects', async () => {
    stubFetch({ ...FILE, cards: [{ t: 'odd', r: [{ o: 'XYZ' }] }] })
    await type('odd')
    expect(words()).toEqual(['odd'])
    expect(document.querySelector('.lookup__preview')).toBeNull()
  })
})

describe('Lookup preview stays in view', () => {
  it('carries the class the sticky rule is on', async () => {
    stubFetch(FILE)
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

  it('the drawer keeps room for the taller sticky Key chart board when tabbing upward', () => {
    const css = readFileSync('src/ui/dock.css', 'utf8')
    expect(/\.dock-drawer__body\s*\{[^}]*scroll-padding-top:\s*8rem\s*;/.test(css)).toBe(true)
  })
})

describe('Lookup in the dock drawer', () => {
  let dock: Dock
  function Probe(): JSX.Element {
    dock = useDock()
    return <span />
  }

  it('has the focus in the search box when the tool opens', async () => {
    stubFetch(FILE)
    render(
      <DockProvider>
        <Probe />
        <DockHost />
      </DockProvider>,
    )
    act(() => dock.open('lookup'))
    const box = await screen.findByLabelText('Look up a word or a stroke')
    await waitFor(() => expect(document.activeElement).toBe(box))
    expect(box.hasAttribute('data-autofocus')).toBe(true)
    expect((box as HTMLInputElement).type).toBe('search')
  })
})
