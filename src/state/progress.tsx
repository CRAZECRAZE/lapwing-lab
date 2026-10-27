import { createContext } from 'preact'
import type { ComponentChildren, JSX } from 'preact'
import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ChapterInfo, PracticeIndexEntry } from '../../scripts/build-content.ts'
import type { ProgressMark } from '../../server/archive.ts'
import { deleteMark, getProgress, getResults, putMark } from '../api.ts'
import { chapterStates } from '../core/progress.ts'
import type { ChapterState, ResultsByMode } from '../core/progress.ts'

export type Progress = {
  status: 'loading' | 'ready' | 'error'
  chapters: ChapterInfo[]
  index: PracticeIndexEntry[]
  results: ResultsByMode
  marks: ProgressMark[]
  /** Empty unless `status` is 'ready': when anything failed to load, nothing is locked. `chapters` and `index` are kept once loaded, even in an error. */
  states: Map<number, ChapterState>
  /** Refetches results and marks (the content is static unless it never loaded). Never rejects. */
  reload(): Promise<void>
  /** Rejects if the write fails; resolves once the new state has loaded. */
  setMark(chapter: number, kind: 'read' | 'override'): Promise<void>
  /** Rejects if the write fails; resolves once the new state has loaded. */
  clearMark(chapter: number): Promise<void>
}

type Content = { chapters: ChapterInfo[]; index: PracticeIndexEntry[] }
type Dynamic = { results: ResultsByMode; marks: ProgressMark[] }
type Loaded = Content & Dynamic

const EMPTY_RESULTS: ResultsByMode = { stage0: [], section: [], 'chapter-test': [] }

const ProgressContext = createContext<Progress | null>(null)

export function useProgress(): Progress {
  const value = useContext(ProgressContext)
  if (!value) throw new Error('useProgress must be used inside a ProgressProvider')
  return value
}

/** True when the chapter is known to be locked; false when unknown or the state is not ready. */
export function isLocked(progress: Progress, chapter: number): boolean {
  return progress.states.get(chapter)?.locked === true
}

async function fetchList<T>(url: string): Promise<T[]> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  const body: unknown = await response.json()
  if (!Array.isArray(body)) throw new Error(`${url}: not a list`)
  return body as T[]
}

async function loadContent(): Promise<Content> {
  const [chapters, index] = await Promise.all([
    fetchList<ChapterInfo>('/content/chapters.json'),
    fetchList<PracticeIndexEntry>('/content/practice-index.json'),
  ])
  return { chapters, index }
}

async function loadDynamic(): Promise<Dynamic> {
  const [stage0, section, chapterTest, marks] = await Promise.all([
    getResults('stage0'),
    getResults('section'),
    getResults('chapter-test'),
    getProgress(),
  ])
  return { results: { stage0, section, 'chapter-test': chapterTest }, marks }
}

type Data = { status: Progress['status'] } & Partial<Loaded>

export function ProgressProvider({ children }: { children: ComponentChildren }): JSX.Element {
  const [data, setData] = useState<Data>({ status: 'loading' })
  /** Counts requests; only the latest one may apply its response. */
  const latest = useRef(0)
  const live = useRef(false)
  /** The static content once it has loaded; kept apart from `data` so a reload can read it synchronously. */
  const content = useRef<Content | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    const mine = ++latest.current
    // Static content is fetched only until it has loaded once, and cached the moment it arrives, so a failing
    // dynamic half never throws it away. A reload then refetches the dynamic part alone.
    const contentLoad =
      content.current !== null
        ? Promise.resolve(content.current)
        : loadContent().then((loaded) => {
            content.current = loaded
            return loaded
          })
    const [loadedContent, dynamic] = await Promise.allSettled([contentLoad, loadDynamic()])
    if (!live.current || latest.current !== mine) return
    if (loadedContent.status === 'fulfilled' && dynamic.status === 'fulfilled') {
      setData({ status: 'ready', ...loadedContent.value, ...dynamic.value })
      return
    }
    // Keep what loaded (the content even when only the dynamic half failed), but never lock anything:
    // states are empty unless ready.
    setData((previous) => ({ ...previous, ...(content.current ?? {}), status: 'error' }))
  }, [])

  useLayoutEffect(() => {
    live.current = true
    void reload()
    return () => {
      live.current = false
      latest.current++
    }
  }, [reload])

  const setMark = useCallback(
    async (chapter: number, kind: 'read' | 'override'): Promise<void> => {
      await putMark(chapter, kind)
      await reload()
    },
    [reload],
  )
  const clearMark = useCallback(
    async (chapter: number): Promise<void> => {
      await deleteMark(chapter)
      await reload()
    },
    [reload],
  )

  const value = useMemo<Progress>(() => {
    const chapters = data.chapters ?? []
    const results = data.results ?? EMPTY_RESULTS
    const marks = data.marks ?? []
    return {
      status: data.status,
      chapters,
      index: data.index ?? [],
      results,
      marks,
      states: data.status === 'ready' ? chapterStates(chapters, results, marks) : new Map(),
      reload,
      setMark,
      clearMark,
    }
  }, [data, reload, setMark, clearMark])

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>
}
