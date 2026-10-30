// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import type { JSX } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo, PracticeIndexEntry } from '../../scripts/build-content.ts'
import type { ProgressMark, SectionResult } from '../../server/archive.ts'
import { chapterStates } from '../../src/core/progress.ts'
import type { ResultsByMode } from '../../src/core/progress.ts'
import { parseStroke } from '../../src/core/steno.ts'
import { parseRoute } from '../../src/router.ts'
import { ProgressProvider } from '../../src/state/progress.tsx'
import type { Progress } from '../../src/state/progress.tsx'
import { App } from '../../src/ui/App.tsx'
import { Nav } from '../../src/ui/Nav.tsx'
import { Reader } from '../../src/ui/Reader.tsx'
import { StrokeInspector } from '../../src/ui/StrokeInspector.tsx'

// Records the `target` of every Board render, so a test can see renders that never reach the DOM for long.
const boardTargets = vi.hoisted(() => [] as number[])
vi.mock('../../src/ui/Board.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../src/ui/Board.tsx')>()
  return {
    ...actual,
    Board: (props: Parameters<typeof actual.Board>[0]) => {
      boardTargets.push(props.target ?? 0)
      return actual.Board(props)
    },
  }
})

// `useProgress` reads this fake when a test sets it, else the real provider's value.
const fakeProgress = vi.hoisted(() => ({ value: null as Progress | null }))
vi.mock('../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => fakeProgress.value ?? actual.useProgress() }
})

/** The Reader reads chapter progress, so it renders inside a provider. */
const withProgress = (node: JSX.Element): JSX.Element => <ProgressProvider>{node}</ProgressProvider>

type Json = Record<string, unknown>
type Reply = Json | Error | Promise<Json> | 404

const pageFile = (id: string, html: string): Json => ({ id, title: id, html, headings: [], practiceLinks: [] })

/** Routes /content/*.json to canned replies; anything unknown is a 404. */
function mockFetch(routes: Record<string, Reply>) {
  const fn = vi.fn(async (url: string) => {
    const reply = routes[url]
    if (reply === undefined || reply === 404) return { ok: false, status: 404, json: async () => ({}) }
    if (reply instanceof Error) throw reply
    return { ok: true, status: 200, json: async () => reply }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** Lets every pending promise callback and timer-0 task run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

const scrollIntoView = vi.fn()

beforeEach(() => {
  history.replaceState(null, '', '/')
  vi.stubGlobal('scrollTo', vi.fn())
  Element.prototype.scrollIntoView = scrollIntoView
})

afterEach(() => {
  cleanup()
  fakeProgress.value = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  scrollIntoView.mockClear()
})

describe('parseRoute', () => {
  it('maps paths to routes', () => {
    expect(parseRoute('/')).toEqual({ name: 'page', id: 'home' })
    expect(parseRoute('/page/ch05')).toEqual({ name: 'page', id: 'ch05' })
    expect(parseRoute('/page/appA')).toEqual({ name: 'page', id: 'appA' })
    expect(parseRoute('/drill/stage0/rows-left-bottom')).toEqual({ name: 'drill', id: 'stage0/rows-left-bottom' })
    expect(parseRoute('/nope')).toEqual({ name: 'notfound' })
    expect(parseRoute('/page/')).toEqual({ name: 'notfound' })
    expect(parseRoute('/page/a/b')).toEqual({ name: 'notfound' })
  })

  it('decodes drill ids and sends malformed escapes to notfound instead of throwing', () => {
    expect(parseRoute('/drill/stage0/a%20b')).toEqual({ name: 'drill', id: 'stage0/a b' })
    expect(parseRoute('/drill/%zz')).toEqual({ name: 'notfound' })
    expect(parseRoute('/drill/stage0/100%')).toEqual({ name: 'notfound' })
    expect(parseRoute('/page/%zz')).toEqual({ name: 'notfound' })
  })

  it('renders the app at a malformed URL without crashing', async () => {
    mockFetch({ '/content/book.json': { commit: 'abc', pages: [] } })
    history.replaceState(null, '', '/drill/%zz')
    render(<App />)
    expect(await screen.findByText(/no such page/i)).toBeTruthy()
  })
})

describe('StrokeInspector', () => {
  it('lights the keys of a single stroke', () => {
    const { container } = render(<StrokeInspector outline="TKAD" />)
    const lit = [...container.querySelectorAll('.key--target')].map((el) => el.getAttribute('data-lever'))
    expect(lit.sort()).toEqual(['-D', 'A-', 'K-', 'T-'])
    expect(screen.queryByText(/\d\/\d/)).toBeNull()
  })

  it('cycles the strokes of an outline every 800 ms', () => {
    vi.useFakeTimers()
    const { container } = render(<StrokeInspector outline="TKAD/PWAOD/-T" />)
    const lit = () => [...container.querySelectorAll('.key--target')].map((el) => el.getAttribute('data-lever')).sort()
    expect(screen.getByText('1/3')).toBeTruthy()
    expect(lit()).toEqual(['-D', 'A-', 'K-', 'T-'])
    act(() => void vi.advanceTimersByTime(799))
    expect(screen.getByText('1/3')).toBeTruthy()
    act(() => void vi.advanceTimersByTime(1))
    expect(screen.getByText('2/3')).toBeTruthy()
    expect(lit()).toEqual(['-D', 'A-', 'O-', 'P-', 'W-'])
    act(() => void vi.advanceTimersByTime(800))
    expect(screen.getByText('3/3')).toBeTruthy()
    act(() => void vi.advanceTimersByTime(800))
    expect(screen.getByText('1/3')).toBeTruthy()
  })

  it('shows stroke 1 on the very first render of a new outline', () => {
    vi.useFakeTimers()
    const { rerender } = render(<StrokeInspector outline="TKAD/PWAOD/-T" />)
    act(() => void vi.advanceTimersByTime(800))
    expect(screen.getByText('2/3')).toBeTruthy()
    boardTargets.length = 0
    rerender(<StrokeInspector outline="SAP/TKAD/-T" />)
    expect(boardTargets.length).toBeGreaterThan(0)
    expect(boardTargets[0]).toBe(parseStroke('SAP'))
    expect(boardTargets.every((t) => t === parseStroke('SAP'))).toBe(true)
  })

  it('restarts at the first stroke when the outline changes, and invites a hover when empty', () => {
    vi.useFakeTimers()
    const { rerender } = render(<StrokeInspector outline="TKAD/PWAOD" />)
    act(() => void vi.advanceTimersByTime(800))
    expect(screen.getByText('2/2')).toBeTruthy()
    rerender(<StrokeInspector outline="SAP/SAP/SAP" />)
    expect(screen.getByText('1/3')).toBeTruthy()
    rerender(<StrokeInspector outline={null} />)
    expect(screen.getByText(/hover/i)).toBeTruthy()
  })
})

describe('Reader', () => {
  it('survives a malformed percent-escape in the URL hash and ends up at the top', async () => {
    mockFetch({ '/content/pages/ch05.json': pageFile('ch05', '<h2 id="intro">Intro</h2><a href="/page/ch05#%zz">odd</a>') })
    history.replaceState(null, '', '/page/ch05#%')
    render(withProgress(<Reader id="ch05" />))
    await screen.findByText('Intro')
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 0))
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    ;(window.scrollTo as ReturnType<typeof vi.fn>).mockClear()
    fireEvent.click(screen.getByText('odd')) // same-page link: scrolls from the click handler
    expect(location.hash).toBe('#%zz')
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  const strokePage = pageFile(
    'ch05',
    '<h1>Five</h1><p>Try <code class="stroke" data-stroke="TKAD" tabindex="0">TKAD</code> and ' +
      '<span class="stroke stroke-tag" data-stroke="TKAD/PWAOD/-T" tabindex="0">three</span>.</p>',
  )
  const litKeys = (container: Element) => [...container.querySelectorAll('.key--target')].map((el) => el.getAttribute('data-lever')).sort()

  it('lights the board when a stroke is hovered, focused or clicked', async () => {
    mockFetch({ '/content/pages/ch05.json': strokePage })
    const { container } = render(withProgress(<Reader id="ch05" />))
    const stroke = await screen.findByText('TKAD')
    expect(container.querySelectorAll('.key--target')).toHaveLength(0)
    fireEvent.mouseOver(stroke)
    expect(container.querySelectorAll('.key--target')).toHaveLength(4)
    expect(litKeys(container)).toEqual(['-D', 'A-', 'K-', 'T-'])
    fireEvent.mouseOver(await screen.findByText('three'))
    expect(screen.getByText('1/3')).toBeTruthy()
    fireEvent.focusIn(stroke)
    expect(screen.queryByText('1/3')).toBeNull()
    expect(container.querySelectorAll('.key--target')).toHaveLength(4)
    fireEvent.click(screen.getByText('three'))
    expect(screen.getByText('1/3')).toBeTruthy()
  })

  it('ignores hover on text that is not a stroke', async () => {
    mockFetch({ '/content/pages/ch05.json': strokePage })
    const { container } = render(withProgress(<Reader id="ch05" />))
    fireEvent.mouseOver(await screen.findByText('Five'))
    expect(container.querySelectorAll('.key--target')).toHaveLength(0)
  })

  it.each([
    ['the server is unreachable', new Error('offline'), /couldn.t load/i],
    ['the page is not in the book', 404 as const, /isn.t in the book/i],
  ])('shows a calm message when %s', async (_why, reply, message) => {
    mockFetch({ '/content/pages/ch05.json': reply })
    render(withProgress(<Reader id="ch05" />))
    expect((await screen.findByRole('alert')).textContent).toMatch(message)
  })

  it('shows a calm message when the page is not valid JSON', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad') } }))
    render(withProgress(<Reader id="ch05" />))
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn.t load/i)
  })

  it('does not let a slow earlier page overwrite the current one', async () => {
    let finishA!: (page: Json) => void
    const slowA = new Promise<Json>((resolve) => (finishA = resolve))
    mockFetch({
      '/content/pages/ch05.json': slowA,
      '/content/pages/ch06.json': pageFile('ch06', '<p>Page six</p>'),
    })
    const { rerender } = render(withProgress(<Reader id="ch05" />))
    rerender(withProgress(<Reader id="ch06" />))
    expect(await screen.findByText('Page six')).toBeTruthy()
    await act(async () => {
      finishA(pageFile('ch05', '<p>Page five</p>'))
      await settle()
    })
    expect(screen.queryByText('Page five')).toBeNull()
    expect(screen.getByText('Page six')).toBeTruthy()
  })

  it('does not let a late failure of an earlier page replace the current one', async () => {
    let failA!: (error: Error) => void
    const slowA = new Promise<Json>((_resolve, reject) => (failA = reject))
    mockFetch({
      '/content/pages/ch05.json': slowA,
      '/content/pages/ch06.json': pageFile('ch06', '<p>Page six</p>'),
    })
    const { rerender } = render(withProgress(<Reader id="ch05" />))
    rerender(withProgress(<Reader id="ch06" />))
    await screen.findByText('Page six')
    await act(async () => {
      failA(new Error('late'))
      await settle()
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('scrolls to the top when a page loads, or to the anchor in the URL', async () => {
    mockFetch({
      '/content/pages/ch05.json': pageFile('ch05', '<h2 id="intro">Intro</h2><h2 id="later">Later</h2>'),
      '/content/pages/ch06.json': pageFile('ch06', '<p>Six</p>'),
    })
    const { rerender } = render(withProgress(<Reader id="ch05" />))
    await screen.findByText('Intro')
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 0))
    expect(scrollIntoView).not.toHaveBeenCalled()
    rerender(withProgress(<Reader id="ch06" />))
    await screen.findByText('Six')
    history.replaceState(null, '', '/page/ch05#later')
    rerender(withProgress(<Reader id="ch05" />))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect((scrollIntoView.mock.contexts[0] as HTMLElement).id).toBe('later')
  })
})

describe('internal links', () => {
  const book = {
    commit: 'abc',
    pages: [
      { id: 'home', title: 'Home', kind: 'home', file: 'Home.md' },
      { id: 'ch05', title: 'Chapter 5: Five', kind: 'chapter', number: 5, file: 'Chapter-5.md' },
      { id: 'ch06', title: 'Chapter 6: Six', kind: 'chapter', number: 6, file: 'Chapter-6.md' },
    ],
  }
  const routes = () => ({
    '/content/book.json': book,
    '/content/pages/ch05.json': pageFile(
      'ch05',
      '<p>Go to <a href="/page/ch06#deep">chapter six</a>, <a href="/page/ch05#top-bit">up</a> or ' +
        '<a href="https://example.com/x" target="_blank" rel="noreferrer">outside</a>.</p><h2 id="top-bit">Top bit</h2>',
    ),
    '/content/pages/ch06.json': pageFile('ch06', '<h2 id="deep">Deep</h2><p>Chapter six text</p>'),
  })

  it('navigates without a reload, swaps the content, and scrolls to the anchor', async () => {
    const fetchMock = mockFetch(routes())
    history.replaceState(null, '', '/page/ch05')
    render(<App />)
    const link = await screen.findByText('chapter six')
    expect(fireEvent.click(link)).toBe(false) // default prevented: no browser navigation
    expect(await screen.findByText('Chapter six text')).toBeTruthy()
    expect(location.pathname + location.hash).toBe('/page/ch06#deep')
    expect(screen.queryByText('chapter six')).toBeNull()
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect((scrollIntoView.mock.contexts.at(-1) as HTMLElement).id).toBe('deep')
    expect(fetchMock.mock.calls.filter(([u]) => u === '/content/book.json')).toHaveLength(1)
  })

  it('scrolls to an anchor on the page that is already open', async () => {
    mockFetch(routes())
    history.replaceState(null, '', '/page/ch05')
    render(<App />)
    fireEvent.click(await screen.findByText('up'))
    expect(location.hash).toBe('#top-bit')
    expect((scrollIntoView.mock.contexts.at(-1) as HTMLElement).id).toBe('top-bit')
  })

  it('leaves external links to the browser', async () => {
    mockFetch(routes())
    history.replaceState(null, '', '/page/ch05')
    render(<App />)
    expect(fireEvent.click(await screen.findByText('outside'))).toBe(true)
    expect(location.pathname).toBe('/page/ch05')
  })

  it('follows the browser back button', async () => {
    mockFetch(routes())
    history.replaceState(null, '', '/page/ch05')
    render(<App />)
    fireEvent.click(await screen.findByText('chapter six'))
    await screen.findByText('Chapter six text')
    await act(async () => {
      history.back()
      await settle()
    })
    expect(await screen.findByText('chapter six')).toBeTruthy()
  })

  it('scrolls to the top when the nav switches pages', async () => {
    mockFetch(routes())
    history.replaceState(null, '', '/page/ch05')
    render(<App />)
    await screen.findByText('chapter six')
    ;(window.scrollTo as ReturnType<typeof vi.fn>).mockClear()
    fireEvent.click(await screen.findByRole('link', { name: /Chapter 6/ }))
    await screen.findByText('Chapter six text')
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 0))
  })

  it('shows a calm message for unknown drills and unknown routes', async () => {
    mockFetch(routes())
    history.replaceState(null, '', '/drill/elsewhere/rows')
    render(<App />)
    expect(await screen.findByText(/no such drill/i)).toBeTruthy()
    cleanup()
    history.replaceState(null, '', '/nope')
    render(<App />)
    expect(await screen.findByText(/no such page/i)).toBeTruthy()
  })
})

describe('Nav', () => {
  const entry = (id: string, kind: string, number?: number) => ({ id, title: `Title ${id}`, kind, number, file: `${id}.md` })
  const pages = [
    entry('home', 'home'),
    ...[1, 4, 5, 12, 13, 26].map((n) => entry(`ch${String(n).padStart(2, '0')}`, 'chapter', n)),
    entry('appA', 'appendix'),
    entry('appD', 'appendix'),
    entry('glossary', 'glossary'),
    entry('changes', 'changes'),
  ]

  it('groups every page and marks the current one', async () => {
    mockFetch({ '/content/book.json': { commit: 'abc', pages } })
    render(withProgress(<Nav currentId="ch05" />))
    await screen.findByText('Start here')
    const groups = [...document.querySelectorAll('.nav__group')].map((g) => ({
      title: g.querySelector('.nav__heading')!.textContent,
      ids: [...g.querySelectorAll('a')].map((a) => a.getAttribute('href')!.replace('/page/', '')),
    }))
    expect(groups).toEqual([
      { title: 'Start here', ids: ['home', 'ch01', 'ch04'] },
      { title: 'Core', ids: ['ch05', 'ch12'] },
      { title: 'Later', ids: ['ch13', 'ch26'] },
      { title: 'Appendices', ids: ['appA', 'appD', 'glossary', 'changes'] },
    ])
    expect(document.querySelector('a[aria-current="page"]')!.getAttribute('href')).toBe('/page/ch05')
    expect(document.querySelectorAll('.nav__locked, [aria-disabled]')).toHaveLength(0)
  })

  it('stays calm when the book index cannot be loaded', async () => {
    mockFetch({ '/content/book.json': new Error('offline') })
    render(withProgress(<Nav currentId="home" />))
    expect((await screen.findByText(/chapter list/i)).textContent).toMatch(/couldn.t load/i)
  })
})

describe('practice links and the chapter panel', () => {
  const CHAPTERS: ChapterInfo[] = [
    { chapter: 4, pageId: 'ch04', title: 'Chapter 4', gate: 'stage0', passMark: { accuracy: 0.9, maxMinutes: 10 }, listIds: [] },
    { chapter: 5, pageId: 'ch05', title: 'Chapter 5', gate: 'test', passMark: { accuracy: 0.9, minWpm: 30 }, testListId: '5-test', listIds: ['5-cvc'] },
    { chapter: 6, pageId: 'ch06', title: 'Chapter 6', gate: 'drills', listIds: ['6-fqm'] },
  ]
  const INDEX: PracticeIndexEntry[] = [
    { id: '5-cvc', chapter: 5, items: 120 },
    { id: '5-test', chapter: 5, items: 300 },
    { id: '6-fqm', chapter: 6, items: 40 },
  ]
  const result = (section: string, accuracy: number, wpm: number): SectionResult => ({
    section,
    runs: 1,
    passed: accuracy >= 0.9,
    best: { accuracy, wpm },
    last: { accuracy, wpm, endedAt: 1, passed: accuracy >= 0.9 },
    firstPassedAt: accuracy >= 0.9 ? 1 : null,
  })
  const STAGE0_PASSED = result('pseudo-test', 0.96, 20)

  function progress(status: Progress['status'], over: Partial<ResultsByMode> = {}, marks: ProgressMark[] = []): Progress {
    const results: ResultsByMode = { stage0: [STAGE0_PASSED], section: [], 'chapter-test': [], ...over }
    return {
      status,
      chapters: CHAPTERS,
      index: INDEX,
      results,
      marks,
      states: status === 'ready' ? chapterStates(CHAPTERS, results, marks) : new Map(),
      reload: async () => {},
      setMark: async () => {},
      setMarks: async () => {},
      clearMark: async () => {},
    }
  }

  const LINKS =
    '<h2>Drills</h2><p><a class="practice-link" data-list="5-cvc">Basic words drill</a></p>' +
    '<ul><li><a class="practice-link" data-list="5-cvc">Basic words</a></li>' +
    '<li><a class="practice-link" data-list="6-fqm">Next chapter words</a></li>' +
    '<li><a class="practice-link" data-list="9-unknown">Not in the index</a></li></ul>' +
    '<p><a class="practice-link" data-list="5-test">Click here to access the chapter 5 test</a></p>'

  const links = (): HTMLAnchorElement[] => [...document.querySelectorAll<HTMLAnchorElement>('a.practice-link')]
  const meta = (a: Element): string | null => a.querySelector('.practice-link__meta')?.textContent ?? null

  async function showPage(p: Progress, id = 'ch05', html = LINKS) {
    fakeProgress.value = p
    mockFetch({ [`/content/pages/${id}.json`]: pageFile(id, html) })
    const view = render(withProgress(<Reader id={id} />))
    await waitFor(() => expect(document.querySelector('a.practice-link[href]')).toBeTruthy())
    return view
  }

  it('gives every practice link an href and meta with the word count and the last result', async () => {
    await showPage(progress('ready', { section: [result('5-cvc', 0.92, 31.2)] }, [{ chapter: 5, kind: 'override', at: 1 }]))
    const [row, inline, next, unknown, test] = links()
    expect(row.getAttribute('href')).toBe('/drill/list/5-cvc')
    expect(meta(row)).toBe(' · 120 words · last 92% · 31 wpm')
    expect(meta(inline)).toBe(' · 120 words · last 92% · 31 wpm')
    expect(next.getAttribute('href')).toBe('/drill/list/6-fqm')
    expect(meta(next)).toBe(' · 40 words · not tried')
    expect(unknown.getAttribute('href')).toBe('/drill/list/9-unknown')
    expect(meta(unknown)).toBe(' · not tried')
    expect(test.getAttribute('href')).toBe('/drill/test/5')
    // the test draws 45 words, 3 times each, whatever the list holds
    expect(meta(test)).toBe(' · 45 words, 3 times each · not tried')
    // the book's own link text is left as it was
    expect(row.firstChild!.textContent).toBe('Basic words drill')
    expect(test.firstChild!.textContent).toBe('Click here to access the chapter 5 test')
  })

  it('marks links that are a paragraph of their own as rows, and leaves links in lists inline', async () => {
    await showPage(progress('ready'))
    const [row, inline, , , test] = links()
    expect(row.classList.contains('practice-link--row')).toBe(true)
    expect(test.classList.contains('practice-link--row')).toBe(true)
    expect(inline.classList.contains('practice-link--row')).toBe(false)
  })

  it('reads chapter-test results for test links', async () => {
    await showPage(progress('ready', { 'chapter-test': [result('5-test', 0.95, 34)] }))
    expect(meta(links()[4])).toBe(' · 45 words, 3 times each · last 95% · 34 wpm')
  })

  it('keeps the locked part after the test size', async () => {
    await showPage(progress('ready', { stage0: [] }))
    expect(meta(links()[4])).toBe(' · 45 words, 3 times each · not tried · locked')
  })

  it('shows one decimal for a score just below the mark that would round up to it', async () => {
    // Chapter 5's test wants 90% and 30 wpm; chapter 6's drills want 90%.
    await showPage(
      progress('ready', {
        'chapter-test': [result('5-test', 121 / 135, 29.6)],
        section: [result('5-cvc', 0.896, 31.2), result('6-fqm', 0.896, 31.2)],
      }),
    )
    const [row, , next, , test] = links()
    expect(meta(test)).toBe(' · 45 words, 3 times each · last 89.6% · 29.6 wpm')
    // a drills-gate list has the 90% mark and no wpm mark
    expect(meta(next)).toBe(' · 40 words · last 89.6% · 31 wpm · locked')
    // a section list in a chapter that is judged by its test is only practice
    expect(meta(row)).toBe(' · 120 words · last 90% · 31 wpm')
  })

  it('replaces the meta when progress changes instead of adding more, without re-rendering the page HTML', async () => {
    const view = await showPage(progress('ready'))
    const first = links()[0]
    expect(meta(first)).toBe(' · 120 words · not tried')
    fakeProgress.value = progress('ready', { section: [result('5-cvc', 0.8, 25)] })
    view.rerender(withProgress(<Reader id="ch05" />))
    await waitFor(() => expect(meta(links()[0])).toBe(' · 120 words · last 80% · 25 wpm'))
    expect(links()[0]).toBe(first) // the same node: the HTML was not rebuilt
    fakeProgress.value = progress('ready', { section: [result('5-cvc', 0.9, 30)] })
    view.rerender(withProgress(<Reader id="ch05" />))
    await waitFor(() => expect(meta(links()[0])).toBe(' · 120 words · last 90% · 30 wpm'))
    for (const a of links()) expect(a.querySelectorAll('.practice-link__meta')).toHaveLength(1)
    expect(document.querySelectorAll('.practice-link__meta')).toHaveLength(5)
  })

  it('decorates the new page after a page change', async () => {
    const view = await showPage(progress('ready', {}, [{ chapter: 5, kind: 'override', at: 1 }]))
    mockFetch({ '/content/pages/ch06.json': pageFile('ch06', '<p><a class="practice-link" data-list="6-fqm">Six drill</a></p>') })
    view.rerender(withProgress(<Reader id="ch06" />))
    await screen.findByText('Six drill')
    await waitFor(() => expect(meta(links()[0])).toBe(' · 40 words · not tried'))
    expect(links()[0].getAttribute('href')).toBe('/drill/list/6-fqm')
  })

  it("says a locked chapter's links are locked but keeps them working", async () => {
    await showPage(progress('ready')) // chapter 5 is not cleared, so chapter 6 is locked
    const next = links()[2]
    expect(meta(next)).toBe(' · 40 words · not tried · locked')
    expect(next.getAttribute('href')).toBe('/drill/list/6-fqm')
    expect(meta(links()[0])).not.toContain('locked')
  })

  it('navigates in-app on a plain click and leaves a modified click to the browser', async () => {
    history.replaceState(null, '', '/page/ch05')
    await showPage(progress('ready'))
    const test = links()[4]
    expect(fireEvent.click(test, { metaKey: true })).toBe(true)
    expect(location.pathname).toBe('/page/ch05')
    expect(fireEvent.click(test)).toBe(false)
    expect(location.pathname).toBe('/drill/test/5')
  })

  it.each(['error', 'loading'] as const)('gives the links an href but no meta while progress is %s', async (status) => {
    await showPage(progress(status))
    expect(links().map((a) => a.getAttribute('href'))).toEqual([
      '/drill/list/5-cvc',
      '/drill/list/5-cvc',
      '/drill/list/6-fqm',
      '/drill/list/9-unknown',
      '/drill/test/5',
    ])
    expect(document.querySelectorAll('.practice-link__meta')).toHaveLength(0)
  })

  it('shows the chapter panel on chapter pages only, above the text', async () => {
    const view = await showPage(progress('ready'))
    expect(document.querySelector('.chapter-panel')).toBeTruthy()
    expect(
      document.querySelector('.chapter-panel')!.compareDocumentPosition(document.querySelector('article')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    for (const id of ['home', 'appA', 'glossary']) {
      mockFetch({ [`/content/pages/${id}.json`]: pageFile(id, `<p>Page ${id}</p>`) })
      view.rerender(withProgress(<Reader id={id} />))
      await screen.findByText(`Page ${id}`)
      expect(document.querySelector('.chapter-panel')).toBeNull()
    }
  })

  it('shows the Stage 0 panel and then the chapter panel on ch04', async () => {
    fakeProgress.value = progress('ready', { stage0: [] })
    mockFetch({ '/content/pages/ch04.json': pageFile('ch04', '<h1>Four</h1>') })
    render(withProgress(<Reader id="ch04" />))
    await screen.findByText('Four')
    const stage0 = document.querySelector('.stage0')!
    const panel = document.querySelector('.chapter-panel')!
    expect(stage0).toBeTruthy()
    expect(panel.querySelector('.chapter-panel__status')!.textContent).toBe('Open')
    expect(stage0.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
