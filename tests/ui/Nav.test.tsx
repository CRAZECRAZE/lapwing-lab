// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo, PageEntry } from '../../scripts/build-content.ts'
import type { ProgressMark, SectionResult } from '../../server/archive.ts'
import { chapterStates } from '../../src/core/progress.ts'
import type { ResultsByMode } from '../../src/core/progress.ts'
import type { Progress } from '../../src/state/progress.tsx'
import { Nav } from '../../src/ui/Nav.tsx'

// The nav reads progress through `useProgress`; each test hands it a fake value.
const fake = vi.hoisted(() => ({ value: null as Progress | null }))
vi.mock('../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => fake.value ?? actual.useProgress() }
})

const entry = (id: string, kind: PageEntry['kind'], number?: number): PageEntry => ({
  id,
  title: `Title ${id}`,
  kind,
  number,
  file: `${id}.md`,
})
const PAGES: PageEntry[] = [
  entry('home', 'home'),
  entry('ch01', 'chapter', 1),
  entry('ch04', 'chapter', 4),
  entry('ch05', 'chapter', 5),
  entry('ch06', 'chapter', 6),
  entry('appA', 'appendix'),
  entry('glossary', 'glossary'),
  entry('changes', 'changes'),
]

const CHAPTERS: ChapterInfo[] = [
  { chapter: 4, pageId: 'ch04', title: 'Title ch04', gate: 'stage0', passMark: { accuracy: 0.9, maxMinutes: 10 }, listIds: [] },
  { chapter: 5, pageId: 'ch05', title: 'Title ch05', gate: 'read', listIds: [] },
  { chapter: 6, pageId: 'ch06', title: 'Title ch06', gate: 'read', listIds: [] },
]

const STAGE0_PASSED: SectionResult = {
  section: 'pseudo-test',
  runs: 1,
  passed: true,
  best: { accuracy: 0.96, wpm: 20 },
  last: { accuracy: 0.96, wpm: 20, endedAt: 1, passed: true },
}

function progress(status: Progress['status'], stage0: SectionResult[] = [], marks: ProgressMark[] = []): Progress {
  const results: ResultsByMode = { stage0, section: [], 'chapter-test': [] }
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

beforeEach(() => {
  history.replaceState(null, '', '/page/ch05')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url !== '/content/book.json') return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ commit: 'abc', pages: PAGES }) }
    }),
  )
})

afterEach(() => {
  cleanup()
  fake.value = null
  vi.unstubAllGlobals()
})

async function show(p: Progress, currentId: string | null = 'ch05') {
  fake.value = p
  const view = render(<Nav currentId={currentId} />)
  await screen.findByText('Start here')
  return view
}
const link = (id: string): HTMLAnchorElement => document.querySelector(`a[href="/page/${id}"]`) as HTMLAnchorElement
const marks = (): number => document.querySelectorAll('.nav__mark').length
const locked = (): number => document.querySelectorAll('.nav__link--locked').length

describe('Nav chapter state', () => {
  it('greys a locked chapter and says what it waits for, leaving open chapters alone', async () => {
    await show(progress('ready'))
    expect(link('ch05').classList.contains('nav__link--locked')).toBe(true)
    expect(link('ch05').getAttribute('aria-label')).toBe('Title ch05, locked until Chapter 4 is cleared')
    expect(link('ch05').getAttribute('title')).toBe('Title ch05, locked until Chapter 4 is cleared')
    expect(link('ch06').getAttribute('aria-label')).toBe('Title ch06, locked until Chapter 4 is cleared')
    // chapter 4 is open and not cleared; chapter 1 has no state
    for (const id of ['ch04', 'ch01']) {
      expect(link(id).classList.contains('nav__link--locked')).toBe(false)
      expect(link(id).hasAttribute('aria-label')).toBe(false)
      expect(link(id).hasAttribute('title')).toBe(false)
    }
    expect(marks()).toBe(0)
    expect(locked()).toBe(2)
  })

  it('puts a tick before the title of a cleared chapter and unlocks the next', async () => {
    await show(progress('ready', [STAGE0_PASSED]))
    const ch04 = link('ch04')
    expect(ch04.querySelector('.nav__mark')!.textContent).toBe('✓')
    expect(ch04.firstElementChild!.classList.contains('nav__mark')).toBe(true)
    expect(ch04.getAttribute('aria-label')).toBe('Title ch04, cleared')
    expect(ch04.textContent).toBe('✓Title ch04')
    expect(ch04.classList.contains('nav__link--locked')).toBe(false)
    // chapter 5 is open now, chapter 6 waits for it
    expect(link('ch05').hasAttribute('aria-label')).toBe(false)
    expect(link('ch06').getAttribute('aria-label')).toBe('Title ch06, locked until Chapter 5 is cleared')
    expect(marks()).toBe(1)
  })

  it('shows a cleared chapter as cleared even when an earlier chapter still blocks it', async () => {
    await show(progress('ready', [], [{ chapter: 6, kind: 'read', at: 1 }]))
    expect(link('ch06').getAttribute('aria-label')).toBe('Title ch06, cleared')
    expect(link('ch06').classList.contains('nav__link--locked')).toBe(false)
  })

  it('never marks the home page, appendices, glossary or changes', async () => {
    await show(progress('ready', [STAGE0_PASSED]))
    for (const id of ['home', 'appA', 'glossary', 'changes']) {
      const a = link(id)
      expect(a.querySelector('.nav__mark')).toBeNull()
      expect(a.classList.contains('nav__link--locked')).toBe(false)
      expect(a.hasAttribute('aria-label')).toBe(false)
      expect(a.hasAttribute('title')).toBe(false)
    }
  })

  it.each(['loading', 'error'] as const)('looks exactly as before while progress is %s', async (status) => {
    // Even if states were somehow present, the nav ignores them until progress is ready.
    const states = chapterStates(CHAPTERS, { stage0: [STAGE0_PASSED], section: [], 'chapter-test': [] }, [])
    await show({ ...progress(status), states })
    expect(marks()).toBe(0)
    expect(locked()).toBe(0)
    for (const page of PAGES) {
      const a = link(page.id)
      expect(a.hasAttribute('aria-label')).toBe(false)
      expect(a.hasAttribute('title')).toBe(false)
      expect(a.textContent).toBe(page.title)
    }
  })

  it('still navigates to a locked chapter on a plain click', async () => {
    await show(progress('ready'))
    const a = link('ch06')
    expect(a.getAttribute('href')).toBe('/page/ch06')
    expect(a.hasAttribute('aria-disabled')).toBe(false)
    expect(fireEvent.click(a)).toBe(false)
    expect(location.pathname).toBe('/page/ch06')
  })

  it('keeps aria-current on the current page, locked or not', async () => {
    await show(progress('ready'), 'ch06')
    expect([...document.querySelectorAll('a[aria-current="page"]')].map((a) => a.getAttribute('href'))).toEqual(['/page/ch06'])
    expect(link('ch06').classList.contains('nav__link--locked')).toBe(true)
  })
})
