import type { JSX } from 'preact'
import { isPlainClick, navigate } from '../router.ts'
import type { Tab } from '../router.ts'

const TABS: ReadonlyArray<{ tab: Tab; label: string; href: string }> = [
  { tab: 'book', label: 'Book', href: '/' },
  { tab: 'practice', label: 'Practice', href: '/practice' },
  { tab: 'history', label: 'History', href: '/history' },
  { tab: 'days', label: 'Days', href: '/days' },
  { tab: 'journal', label: 'Journal', href: '/journal' },
]

export function TopBar({ current }: { current: Tab }): JSX.Element {
  const onClick = (e: MouseEvent): void => {
    if (!isPlainClick(e)) return
    e.preventDefault()
    navigate((e.currentTarget as HTMLAnchorElement).getAttribute('href')!)
  }

  return (
    <nav class="topbar" aria-label="Sections">
      <ul class="topbar__tabs">
        {TABS.map(({ tab, label, href }) => (
          <li key={tab}>
            <a href={href} aria-current={tab === current ? 'page' : undefined} onClick={onClick}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
