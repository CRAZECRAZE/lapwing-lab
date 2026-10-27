import type { JSX } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { PageFile } from '../../scripts/build-content.ts'
import { CHAPTER_TEST } from '../core/chaptertest.ts'
import { isPlainClick, navigate, safeDecode } from '../router.ts'
import { isLocked, useProgress } from '../state/progress.tsx'
import type { Progress } from '../state/progress.tsx'
import { ChapterPanel, describeScore, scoreMarks } from './ChapterPanel.tsx'
import { Stage0Panel } from './Stage0Panel.tsx'
import { StrokeInspector } from './StrokeInspector.tsx'

type Loaded =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; page: PageFile }

function scrollToHash(): void {
  const raw = location.hash.slice(1)
  const id = safeDecode(raw) ?? raw
  const target = id === '' ? null : document.getElementById(id)
  if (target) target.scrollIntoView()
  else window.scrollTo(0, 0)
}

const META = 'practice-link__meta'
const ROW = 'practice-link--row'

/** The in-app route of a book practice link: a chapter test (`5-test`) or a section drill. */
function practiceHref(listId: string): string {
  const test = /^(\d+)-test$/.exec(listId)
  return test ? `/drill/test/${test[1]}` : `/drill/list/${encodeURIComponent(listId)}`
}

/** ` · 120 words · last 92% · 31 wpm`, ` · not tried`, ` · locked` … for one practice link. */
function practiceMeta(listId: string, progress: Progress): string {
  const entry = progress.index.find((e) => e.id === listId)
  const isTest = /^\d+-test$/.test(listId)
  const results = isTest ? progress.results['chapter-test'] : progress.results.section
  const last = results.find((r) => r.section === listId)?.last
  const chapter = entry?.chapter ?? Number(/^(\d+)-/.exec(listId)?.[1])
  // The chapter test always draws its fixed number of words from the list, so the list's size would mislead.
  let text = isTest ? ` · ${CHAPTER_TEST.words} words, ${CHAPTER_TEST.repetitions} times each` : entry ? ` · ${entry.items} words` : ''
  const info = progress.chapters.find((c) => c.chapter === chapter)
  text += last ? ` · last ${describeScore(last, scoreMarks(info, isTest ? 'test' : 'section'))}` : ' · not tried'
  if (Number.isInteger(chapter) && isLocked(progress, chapter)) text += ' · locked'
  return text
}

/**
 * Makes the book's practice links live: an href always, and once progress is ready a trailing meta span.
 * Idempotent: it removes what an earlier pass added, and never touches the book's own link text.
 */
function decoratePracticeLinks(root: Element, progress: Progress): void {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a.practice-link[data-list]')) {
    const listId = link.getAttribute('data-list')!
    link.setAttribute('href', practiceHref(listId))
    for (const old of link.querySelectorAll(`.${META}`)) old.remove()
    if (progress.status === 'ready') {
      const meta = document.createElement('span')
      meta.className = META
      meta.textContent = practiceMeta(listId, progress)
      link.append(meta)
    }
    // A link that is its paragraph's whole content reads as a row; one inside a sentence or a list stays inline.
    const parent = link.parentElement
    const alone = parent?.tagName === 'P' && parent.textContent?.trim() === link.textContent?.trim()
    link.classList.toggle(ROW, alone)
  }
}

export function Reader({ id }: { id: string }): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [outline, setOutline] = useState<string | null>(null)
  const article = useRef<HTMLElement>(null)
  const progress = useProgress()
  const chapter = /^ch(\d+)$/.exec(id)

  useEffect(() => {
    // `live` goes false when the page id changes, so a slow earlier response can never win.
    let live = true
    setLoaded({ status: 'loading' })
    setOutline(null)
    fetch(`/content/pages/${id}.json`)
      .then(async (res): Promise<Loaded> => {
        if (res.status === 404) return { status: 'missing' }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return { status: 'ready', page: (await res.json()) as PageFile }
      })
      .catch((): Loaded => ({ status: 'error' }))
      .then((next) => live && setLoaded(next))
    return () => {
      live = false
    }
  }, [id])

  useEffect(() => {
    if (loaded.status !== 'ready') return
    document.title = `${loaded.page.title} · Lapwing Lab`
    scrollToHash()
  }, [loaded])

  // After the page HTML is in the DOM (and again whenever progress changes); before paint, so nothing flickers.
  useLayoutEffect(() => {
    if (loaded.status !== 'ready') return
    decoratePracticeLinks(article.current!, progress)
  }, [loaded, progress])

  useEffect(() => {
    const root = article.current!
    const showStroke = (e: Event): void => {
      const stroke = (e.target as Element).closest?.('[data-stroke]')
      if (stroke) setOutline(stroke.getAttribute('data-stroke'))
    }
    const followLink = (e: MouseEvent): void => {
      const link = (e.target as Element).closest?.('a')
      const href = link?.getAttribute('href') ?? ''
      const inApp = href.startsWith('/page/') || href.startsWith('/drill/')
      if (!inApp || link!.target === '_blank' || !isPlainClick(e)) return
      e.preventDefault()
      navigate(href)
      // Same page: the route does not change, so nothing else will scroll to the anchor.
      if (new URL(href, location.href).pathname === `/page/${id}`) scrollToHash()
    }
    root.addEventListener('mouseover', showStroke)
    root.addEventListener('focusin', showStroke)
    root.addEventListener('click', showStroke)
    root.addEventListener('click', followLink)
    return () => {
      root.removeEventListener('mouseover', showStroke)
      root.removeEventListener('focusin', showStroke)
      root.removeEventListener('click', showStroke)
      root.removeEventListener('click', followLink)
    }
  }, [id])

  return (
    <div class="reader">
      <div class="reader__column">
        {id === 'ch04' && <Stage0Panel />}
        {chapter && <ChapterPanel key={id} chapter={Number(chapter[1])} />}
        <article class="page" ref={article} aria-busy={loaded.status === 'loading'}>
          {loaded.status === 'ready' && <div dangerouslySetInnerHTML={{ __html: loaded.page.html }} />}
          {loaded.status === 'loading' && <p class="page__status">Loading…</p>}
          {loaded.status === 'missing' && (
            <p class="page__status" role="alert">This page isn't in the book.</p>
          )}
          {loaded.status === 'error' && (
            <p class="page__status" role="alert">Couldn't load this page. Check that the Lapwing Lab server is still running, then reload.</p>
          )}
        </article>
      </div>
      <aside class="dock" aria-label="Stroke inspector">
        <StrokeInspector outline={outline} />
      </aside>
    </div>
  )
}
