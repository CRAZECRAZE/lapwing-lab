import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { TestSummary } from '../../server/archive.ts'
import { listTests } from '../api.ts'
import { TestList } from './TestList.tsx'
import './history.css'

const PAGE = 50

export function History(): JSX.Element {
  const [tests, setTests] = useState<TestSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [full, setFull] = useState(false) // the last page was full, so older tests may exist
  const alive = useRef(true)

  // Loads the first page, or the page before `beforeId`, and appends it.
  const load = (beforeId?: number): void => {
    setLoading(true)
    setFailed(false)
    listTests(beforeId === undefined ? { limit: PAGE } : { limit: PAGE, beforeId }).then(
      (page) => {
        if (!alive.current) return
        setTests((prev) => (beforeId === undefined ? page : [...prev, ...page]))
        setFull(page.length >= PAGE)
        setLoading(false)
      },
      () => {
        if (!alive.current) return
        setFailed(true)
        setLoading(false)
      },
    )
  }
  const loadOlder = (): void => load(tests.length > 0 ? tests[tests.length - 1].id : undefined)

  useEffect(() => {
    alive.current = true
    load()
    return () => {
      alive.current = false
    }
  }, [])

  return (
    <section class="history" aria-labelledby="history-heading">
      <h1 id="history-heading" class="history__heading">History</h1>
      {tests.length > 0 && <TestList tests={tests} />}
      {loading && <p class="history__status">Loading…</p>}
      {failed && (
        <p class="history__status" role="alert">
          Couldn't load your tests. Check that the Lapwing Lab server is still running.{' '}
          <button type="button" class="history__button" onClick={loadOlder}>Try again</button>
        </p>
      )}
      {!loading && !failed && tests.length === 0 && (
        <p class="history__status">Nothing practiced yet. Try a drill from the Practice tab.</p>
      )}
      {!loading && !failed && full && (
        <button type="button" class="history__button" onClick={loadOlder}>Show older</button>
      )}
    </section>
  )
}
