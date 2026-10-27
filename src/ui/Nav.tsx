import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { BookIndex, PageEntry } from '../../scripts/build-content.ts'
import { isPlainClick, navigate } from '../router.ts'

const GROUPS = ['Start here', 'Core', 'Later', 'Appendices'] as const
type Group = (typeof GROUPS)[number]

function groupOf(page: PageEntry): Group {
  if (page.kind === 'home') return 'Start here'
  if (page.kind !== 'chapter' || page.number === undefined) return 'Appendices'
  if (page.number <= 4) return 'Start here'
  return page.number <= 12 ? 'Core' : 'Later'
}

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; pages: PageEntry[] }

export function Nav({ currentId }: { currentId: string | null }): JSX.Element {
  const [book, setBook] = useState<Loaded>({ status: 'loading' })

  useEffect(() => {
    let live = true
    fetch('/content/book.json')
      .then((res) => (res.ok ? (res.json() as Promise<BookIndex>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((index) => live && setBook({ status: 'ready', pages: index.pages }))
      .catch(() => live && setBook({ status: 'error' }))
    return () => {
      live = false
    }
  }, [])

  const onClick = (e: MouseEvent): void => {
    if (!isPlainClick(e)) return
    e.preventDefault()
    navigate((e.currentTarget as HTMLAnchorElement).getAttribute('href')!)
  }

  return (
    <nav class="nav" aria-label="Book pages">
      <a class="nav__brand" href="/" onClick={onClick}>Lapwing Lab</a>
      {book.status === 'error' && <p class="nav__note">Couldn't load the chapter list.</p>}
      {book.status === 'ready' &&
        GROUPS.map((group) => (
          <section class="nav__group" key={group}>
            <h2 class="nav__heading">{group}</h2>
            <ul>
              {book.pages
                .filter((page) => groupOf(page) === group)
                .map((page) => (
                  <li key={page.id}>
                    <a
                      href={`/page/${page.id}`}
                      aria-current={page.id === currentId ? 'page' : undefined}
                      onClick={onClick}
                    >
                      {page.title}
                    </a>
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </nav>
  )
}
