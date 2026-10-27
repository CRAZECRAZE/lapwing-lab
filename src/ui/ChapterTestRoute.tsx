import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { PracticeList } from '../../scripts/lib/practice.ts'
import { CHAPTER_TEST, buildChapterTest, drillPassMark } from '../core/chaptertest.ts'
import { requirementText } from '../core/progress.ts'
import { useProgress } from '../state/progress.tsx'
import { DrillRunner, RunnerMessage } from './DrillRunner.tsx'

const HOME = '/'

type List = { status: 'loading' } | { status: 'error' } | { status: 'ready'; list: PracticeList }

async function loadList(id: string): Promise<List> {
  const res = await fetch(`/content/practice/${encodeURIComponent(id)}.json`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return { status: 'ready', list: (await res.json()) as PracticeList }
}

/** The `/drill/test/<chapter>` route: the book's chapter test. */
export function ChapterTestRoute({ chapter: chapterId }: { chapter: string }): JSX.Element {
  const progress = useProgress()
  const chapter = /^\d+$/.test(chapterId) ? Number(chapterId) : NaN
  const info = progress.chapters.find((c) => c.chapter === chapter)
  const testListId = info?.gate === 'test' ? info.testListId : undefined
  const [list, setList] = useState<List>({ status: 'loading' })

  useEffect(() => {
    if (testListId === undefined) return
    let live = true
    setList({ status: 'loading' })
    loadList(testListId)
      .catch((): List => ({ status: 'error' }))
      .then((next) => live && setList(next))
    return () => {
      live = false
    }
  }, [testListId])

  if (progress.status === 'loading') return <p class="page__status">Loading…</p>
  if (!info) {
    if (progress.status === 'error' && progress.chapters.length === 0) {
      return (
        <RunnerMessage
          text="Couldn't load the chapter list. Check that the Lapwing Lab server is still running, then try again."
          href={HOME}
          label="Back to the book"
        />
      )
    }
    return <RunnerMessage text="No such chapter. Pick a chapter test from its chapter page." href={HOME} label="Back to the book" />
  }
  const backHref = `/page/${info.pageId}`
  const backLabel = `Back to Chapter ${chapter}`
  if (testListId === undefined) {
    return <RunnerMessage text={`Chapter ${chapter} has no chapter test.`} href={backHref} label={backLabel} />
  }
  if (list.status === 'loading') return <p class="page__status">Loading…</p>
  if (list.status === 'error') {
    return (
      <RunnerMessage
        text="Couldn't load the test words. Check that the Lapwing Lab server is still running, then try again."
        href={backHref}
        label={backLabel}
      />
    )
  }

  const items = list.list.items
  const words = Math.min(CHAPTER_TEST.words, new Set(items.map((i) => i.prompt)).size)
  if (words === 0) return <RunnerMessage text="This test has no words yet." href={backHref} label={backLabel} />

  return (
    <DrillRunner
      key={testListId}
      title={`Chapter ${chapter} test`}
      backHref={backHref}
      backLabel={backLabel}
      chapter={chapter}
      items={() => buildChapterTest(items)}
      logTest={{ mode: 'chapter-test', chapter, section: testListId }}
      passMark={drillPassMark(info)}
      requirement={requirementText(info)}
      intro={`${words} words, ${CHAPTER_TEST.repetitions} times each`}
    />
  )
}
