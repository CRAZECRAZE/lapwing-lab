// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseStroke } from '../../src/core/steno.ts'
import { parseRoute } from '../../src/router.ts'
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
    render(<Reader id="ch05" />)
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
    const { container } = render(<Reader id="ch05" />)
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
    const { container } = render(<Reader id="ch05" />)
    fireEvent.mouseOver(await screen.findByText('Five'))
    expect(container.querySelectorAll('.key--target')).toHaveLength(0)
  })

  it.each([
    ['the server is unreachable', new Error('offline'), /couldn.t load/i],
    ['the page is not in the book', 404 as const, /isn.t in the book/i],
  ])('shows a calm message when %s', async (_why, reply, message) => {
    mockFetch({ '/content/pages/ch05.json': reply })
    render(<Reader id="ch05" />)
    expect((await screen.findByRole('alert')).textContent).toMatch(message)
  })

  it('shows a calm message when the page is not valid JSON', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad') } }))
    render(<Reader id="ch05" />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn.t load/i)
  })

  it('does not let a slow earlier page overwrite the current one', async () => {
    let finishA!: (page: Json) => void
    const slowA = new Promise<Json>((resolve) => (finishA = resolve))
    mockFetch({
      '/content/pages/ch05.json': slowA,
      '/content/pages/ch06.json': pageFile('ch06', '<p>Page six</p>'),
    })
    const { rerender } = render(<Reader id="ch05" />)
    rerender(<Reader id="ch06" />)
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
    const { rerender } = render(<Reader id="ch05" />)
    rerender(<Reader id="ch06" />)
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
    const { rerender } = render(<Reader id="ch05" />)
    await screen.findByText('Intro')
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 0))
    expect(scrollIntoView).not.toHaveBeenCalled()
    rerender(<Reader id="ch06" />)
    await screen.findByText('Six')
    history.replaceState(null, '', '/page/ch05#later')
    rerender(<Reader id="ch05" />)
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

  it('shows placeholders for drill and unknown routes', async () => {
    mockFetch(routes())
    history.replaceState(null, '', '/drill/stage0/rows-left-bottom')
    render(<App />)
    expect(await screen.findByText(/coming in a later task/i)).toBeTruthy()
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
    render(<Nav currentId="ch05" />)
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
    render(<Nav currentId="home" />)
    expect((await screen.findByText(/chapter list/i)).textContent).toMatch(/couldn.t load/i)
  })
})
