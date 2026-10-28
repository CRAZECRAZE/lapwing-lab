// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/preact'
import type { JSX } from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo } from '../../scripts/build-content.ts'
import { chapterStates } from '../../src/core/progress.ts'
import type { ResultsByMode } from '../../src/core/progress.ts'
import { DockProvider, useDock } from '../../src/state/dock.tsx'
import type { Dock } from '../../src/state/dock.tsx'
import type { Progress } from '../../src/state/progress.tsx'
import { DockHost } from '../../src/ui/DockHost.tsx'
import { __resetBriefsCacheForTests } from '../../src/ui/tools/Briefs.tsx'
import { __resetKeyChartCacheForTests } from '../../src/ui/tools/KeyChart.tsx'
import { __resetDictionaryCacheForTests } from '../../src/ui/tools/Lookup.tsx'
import { __resetNotesForTests } from '../../src/ui/tools/Notes.tsx'
import { __resetPendingSavesForTests } from '../../src/ui/useAutosave.ts'

// No tool is mocked here: the real DockHost opens the four real tools. Only the progress (which three of them read) and
// the network are stubbed.
const fake = vi.hoisted(() => ({ value: null as Progress | null }))
vi.mock('../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => fake.value ?? actual.useProgress() }
})

const CHAPTERS: ChapterInfo[] = Array.from({ length: 23 }, (_, i) => ({
  chapter: i + 4,
  pageId: `ch${i + 4}`,
  title: `Chapter ${i + 4}`,
  gate: 'read',
  listIds: [],
}))

function readyProgress(): Progress {
  const results: ResultsByMode = { stage0: [], section: [], 'chapter-test': [] }
  return {
    status: 'ready',
    chapters: CHAPTERS,
    index: [],
    results,
    marks: [],
    states: chapterStates(CHAPTERS, results, []),
    reload: async () => {},
    setMark: async () => {},
    setMarks: async () => {},
    clearMark: async () => {},
  }
}

/** Every request gets an empty, valid answer: the tools' lists are empty, the dictionary has no cards, the notes are blank. */
function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.startsWith('/api/notes/')
        ? { chapter: 4, text: '' }
        : url === '/content/dictionary.json'
          ? { commit: 'test', cards: [], letters: {} }
          : []
      return { ok: true, status: 200, json: async () => body }
    }),
  )
}

let dock: Dock
function Probe(): JSX.Element | null {
  dock = useDock()
  return null
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fake.value = null
  __resetBriefsCacheForTests()
  __resetKeyChartCacheForTests()
  __resetDictionaryCacheForTests()
  __resetNotesForTests()
  __resetPendingSavesForTests()
})

describe('the real DockHost', () => {
  it('each of the four tools renders its own real body, and none shows a placeholder', async () => {
    fake.value = readyProgress()
    stubFetch()
    render(
      <DockProvider>
        <Probe />
        <DockHost />
      </DockProvider>,
    )
    const distinctive = {
      lookup: (box: HTMLElement) => within(box).getByLabelText('Look up a word or a stroke'),
      chart: (box: HTMLElement) => box.querySelector('.keychart'),
      briefs: (box: HTMLElement) => within(box).getByLabelText('Filter briefs'),
      notes: (box: HTMLElement) => within(box).getByRole('combobox', { name: 'Chapter' }),
    } as const
    const titles = { lookup: 'Lookup', chart: 'Key chart', briefs: 'Briefs so far', notes: 'My notes' } as const
    for (const tool of ['lookup', 'chart', 'briefs', 'notes'] as const) {
      act(() => dock.open(tool))
      const box = screen.getByRole('dialog', { name: titles[tool] })
      await act(async () => {})
      expect(distinctive[tool](box), tool).toBeTruthy()
      expect(box.textContent, tool).not.toContain('Coming in this milestone.')
    }
  })
})
