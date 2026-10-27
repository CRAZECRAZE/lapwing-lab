import { useEffect, useState } from 'preact/hooks'

export type Route = { name: 'page'; id: string } | { name: 'drill'; id: string } | { name: 'notfound' }

const PAGE_PATH = /^\/page\/([A-Za-z0-9_-]+)\/?$/
const DRILL_PATH = /^\/drill\/(.+?)\/?$/

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'page', id: 'home' }
  const page = PAGE_PATH.exec(pathname)
  if (page) return { name: 'page', id: page[1] }
  const drill = DRILL_PATH.exec(pathname)
  if (drill) return { name: 'drill', id: decodeURIComponent(drill[1]) }
  return { name: 'notfound' }
}

const listeners = new Set<() => void>()

export function navigate(path: string): void {
  if (path !== location.pathname + location.search + location.hash) history.pushState(null, '', path)
  for (const listener of listeners) listener()
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname))
  useEffect(() => {
    const update = (): void => setRoute(parseRoute(location.pathname))
    listeners.add(update)
    addEventListener('popstate', update)
    update() // the URL may have changed between render and subscribing
    return () => {
      listeners.delete(update)
      removeEventListener('popstate', update)
    }
  }, [])
  return route
}

/** True for a plain left click, which the app may turn into history navigation. */
export function isPlainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented
}
