import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { PracticeList } from '../../scripts/lib/practice.ts'
import { drillPassMark } from '../core/chaptertest.ts'
import { requirementText } from '../core/progress.ts'
import { shuffle } from '../stage0/lists.ts'
import { useProgress } from '../state/progress.tsx'
import { DrillRunner, RunnerMessage } from './DrillRunner.tsx'

const HOME = '/'
const LIST_ID = /^(\d+)-[A-Za-z0-9_-]+$/

type List =
  | { status: 'loading' }
  | { status: 'unknown' }
  | { status: 'error' }
  | { status: 'ready'; list: PracticeList }

/** The list file; a 404 means there is no such list. */
async function loadList(id: string): Promise<List> {
  const res = await fetch(`/content/practice/${encodeURIComponent(id)}.json`)
  if (res.status === 404) return { status: 'unknown' }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return { status: 'ready', list: (await res.json()) as PracticeList }
}

const unknown = (
  <RunnerMessage text="No such word list. Pick a section drill from its chapter." href={HOME} label="Back to the book" />
)

/** The `/drill/list/<listId>` route: one section's practice list as a word drill. */
export function ListDrillRoute({ listId }: { listId: string }): JSX.Element {
  const progress = useProgress()
  const valid = LIST_ID.exec(listId)
  const [list, setList] = useState<List>({ status: 'loading' })

  // Fetched alongside progress: the content may load even when the results do not.
  useEffect(() => {
    if (!valid) return
    let live = true
    setList({ status: 'loading' })
    loadList(listId)
      .catch((): List => ({ status: 'error' }))
      .then((next) => live && setList(next))
    return () => {
      live = false
    }
  }, [listId])

  if (!valid) return unknown
  if (progress.status === 'loading') return <p class="page__status">Loading…</p>
  const entry = progress.index.find((e) => e.id === listId)
  // An index that loaded is the authority; without one, the list file decides.
  if (!entry && progress.index.length > 0) return unknown
  if (list.status === 'loading') return <p class="page__status">Loading…</p>
  if (list.status === 'unknown') return unknown
  if (list.status === 'error') {
    return (
      <RunnerMessage
        text="Couldn't load the word list. Check that the Lapwing Lab server is still running, then try again."
        href={HOME}
        label="Back to the book"
      />
    )
  }

  const chapter = entry?.chapter ?? Number(valid[1])
  const info = progress.chapters.find((c) => c.chapter === chapter)
  const backHref = info ? `/page/${info.pageId}` : HOME
  const backLabel = info ? `Back to Chapter ${chapter}` : 'Back to the book'
  const items = list.list.items
  if (items.length === 0) return <RunnerMessage text="This list has no words yet." href={backHref} label={backLabel} />

  // Only a chapter cleared by its drills judges them; elsewhere a list is practice.
  const graded = info?.gate === 'drills'
  return (
    <DrillRunner
      key={listId}
      title={`Chapter ${chapter} · ${listId}`}
      backHref={backHref}
      backLabel={backLabel}
      chapter={chapter}
      items={() => shuffle(items)}
      logTest={{ mode: 'section', chapter, section: listId }}
      passMark={graded ? drillPassMark(info) : undefined}
      requirement={graded ? requirementText(info) : undefined}
    />
  )
}
