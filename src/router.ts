import { useEffect, useState } from 'preact/hooks'

export type Route =
  | { name: 'page'; id: string }
  | { name: 'drill'; id: string }
  | { name: 'practice' }
  | { name: 'free'; source: string; mode: string }
  | { name: 'fixup'; tab: 'words' | 'patterns' }
  | { name: 'fixup-run'; kind: 'words' | 'patterns' }
  | { name: 'text' }
  | { name: 'text-run'; id: string; part: number }
  | { name: 'history' }
  | { name: 'test'; id: number }
  | { name: 'days'; date?: string }
  | { name: 'progress' }
  | { name: 'reports' }
  | { name: 'report'; month: string }
  | { name: 'journal'; date?: string }
  | { name: 'notfound' }

export type Tab = 'book' | 'practice' | 'history' | 'days' | 'progress' | 'journal'

/** The top-bar tab a route belongs to. */
export function tabOf(route: Route): Tab {
  switch (route.name) {
    case 'practice':
    case 'free':
    case 'fixup':
    case 'fixup-run':
    case 'text':
    case 'text-run':
      return 'practice'
    case 'history':
    case 'test':
      return 'history'
    case 'days':
      return 'days'
    case 'progress':
    case 'reports':
    case 'report':
      return 'progress'
    case 'journal':
      return 'journal'
    default:
      return 'book'
  }
}

const PAGE_PATH = /^\/page\/([A-Za-z0-9_-]+)\/?$/
const DRILL_PATH = /^\/drill\/(.+?)\/?$/
const FREE_PATH = /^\/practice\/free\/([A-Za-z0-9-]+)\/([A-Za-z0-9-]+)\/?$/
const FIXUP_RUN_PATH = /^\/practice\/fixup\/run\/(words|patterns)\/?$/
const TEXT_RUN_PATH = /^\/practice\/text\/run\/([A-Za-z0-9_-]+)\/([1-9]\d*)\/?$/
const TEST_PATH = /^\/history\/(\d+)\/?$/
const REPORT_PATH = /^\/progress\/reports\/([^/]+)\/?$/
const DATED_PATH = /^\/(days|journal)\/(\d{4}-\d{2}-\d{2})\/?$/

/** decodeURIComponent that returns null instead of throwing on a malformed escape such as `%zz`. */
export function safeDecode(text: string): string | null {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'page', id: 'home' }
  const page = PAGE_PATH.exec(pathname)
  if (page) return { name: 'page', id: page[1] }
  const drill = DRILL_PATH.exec(pathname)
  if (drill) {
    const id = safeDecode(drill[1])
    if (id !== null) return { name: 'drill', id }
  }
  if (/^\/practice\/?$/.test(pathname)) return { name: 'practice' }
  const free = FREE_PATH.exec(pathname)
  if (free) return { name: 'free', source: free[1], mode: free[2] }
  if (/^\/practice\/fixup\/?$/.test(pathname)) return { name: 'fixup', tab: 'words' }
  if (/^\/practice\/fixup\/patterns\/?$/.test(pathname)) return { name: 'fixup', tab: 'patterns' }
  const fixupRun = FIXUP_RUN_PATH.exec(pathname)
  if (fixupRun) return { name: 'fixup-run', kind: fixupRun[1] as 'words' | 'patterns' }
  if (/^\/practice\/text\/?$/.test(pathname)) return { name: 'text' }
  const textRun = TEXT_RUN_PATH.exec(pathname)
  if (textRun) {
    const part = Number(textRun[2])
    if (Number.isSafeInteger(part)) return { name: 'text-run', id: textRun[1], part }
  }
  if (/^\/history\/?$/.test(pathname)) return { name: 'history' }
  const test = TEST_PATH.exec(pathname)
  if (test) {
    const id = Number(test[1])
    if (Number.isSafeInteger(id)) return { name: 'test', id }
  }
  if (/^\/days\/?$/.test(pathname)) return { name: 'days' }
  if (/^\/progress\/?$/.test(pathname)) return { name: 'progress' }
  if (/^\/progress\/reports\/?$/.test(pathname)) return { name: 'reports' }
  const report = REPORT_PATH.exec(pathname)
  if (report) {
    // any single segment: the Report page says "No such month." for one that is not a month, in the Progress tab
    const month = safeDecode(report[1])
    if (month !== null) return { name: 'report', month }
  }
  if (/^\/journal\/?$/.test(pathname)) return { name: 'journal' }
  const dated = DATED_PATH.exec(pathname)
  if (dated) return { name: dated[1] as 'days' | 'journal', date: dated[2] }
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
