import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { PageFile } from '../../scripts/build-content.ts'
import { isPlainClick, navigate, safeDecode } from '../router.ts'
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

export function Reader({ id }: { id: string }): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [outline, setOutline] = useState<string | null>(null)
  const article = useRef<HTMLElement>(null)

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

  useEffect(() => {
    const root = article.current!
    const showStroke = (e: Event): void => {
      const stroke = (e.target as Element).closest?.('[data-stroke]')
      if (stroke) setOutline(stroke.getAttribute('data-stroke'))
    }
    const followLink = (e: MouseEvent): void => {
      const link = (e.target as Element).closest?.('a')
      const href = link?.getAttribute('href')
      if (!href?.startsWith('/page/') || link!.target === '_blank' || !isPlainClick(e)) return
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
      <aside class="dock" aria-label="Stroke inspector">
        <StrokeInspector outline={outline} />
      </aside>
    </div>
  )
}
