import type { JSX } from 'preact'
import { isPlainClick, navigate } from '../router.ts'

/** An in-app link: a plain click navigates without a page load. */
export function AppLink({ href, children }: { href: string; children: string }): JSX.Element {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (!isPlainClick(e)) return
        e.preventDefault()
        navigate(href)
      }}
    >
      {children}
    </a>
  )
}
