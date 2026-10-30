import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { StrokeRecord, TestRow } from '../../server/archive.ts'
import { getTest } from '../api.ts'
import { formatDuration } from '../core/days.ts'
import { describeTest, misses, slowest } from '../core/review.ts'
import { FIXUP_MODE, TEXT_MODE } from '../core/runmodes.ts'
import { isPlainClick, navigate } from '../router.ts'
import { RhythmView } from './progress/RhythmView.tsx'
import { wasAbandoned } from './TestList.tsx'
import { useTextNames } from './useTextNames.ts'
import './history.css'

type Loaded =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'missing' }
  | { status: 'ready'; test: TestRow; strokes: StrokeRecord[] }

const keys = (slots: readonly string[]): string => (slots.length > 0 ? slots.join(' ') : '—')

export function TestDetail({ id }: { id: number }): JSX.Element {
  const [state, setState] = useState<Loaded>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const textNames = useTextNames(state.status === 'ready' && state.test.mode === TEXT_MODE)

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    getTest(id).then(
      (found) => live && setState(found === null ? { status: 'missing' } : { status: 'ready', ...found }),
      () => live && setState({ status: 'error' }),
    )
    return () => {
      live = false
    }
  }, [id, attempt])

  const back = (
    <a
      class="history__back"
      href="/history"
      onClick={(e) => {
        if (!isPlainClick(e)) return
        e.preventDefault()
        navigate('/history')
      }}
    >
      ← History
    </a>
  )

  if (state.status !== 'ready') {
    return (
      <section class="history">
        {back}
        {state.status === 'loading' && <p class="history__status">Loading…</p>}
        {state.status === 'missing' && <p class="history__status">No such test.</p>}
        {state.status === 'error' && (
          <p class="history__status" role="alert">
            Couldn't load this test. Check that the Lapwing Lab server is still running.{' '}
            <button type="button" class="history__button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </p>
        )}
      </section>
    )
  }

  const { test, strokes } = state
  const finished = test.endedAt !== null
  const wrong = misses(strokes)
  const slow = slowest(strokes, 5)
  const practiced = strokes.length > 0 ? strokes[strokes.length - 1].tsMs - strokes[0].tsMs : null

  return (
    <section class="history">
      {back}
      <h1 class="history__heading">{describeTest(test, textNames)}</h1>
      {!finished && <p class="history__note">Unfinished</p>}
      {wasAbandoned(test.meta) && <p class="history__note">Left early</p>}
      <dl class="detail__stats">
        <div>
          <dt>Accuracy</dt>
          <dd>{finished ? `${Math.round((test.accuracy ?? 0) * 100)}%` : '—'}</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{finished && test.mode !== FIXUP_MODE ? `${Math.round(test.wpm ?? 0)} wpm` : '—'}</dd>
        </div>
        <div>
          <dt>Strokes</dt>
          <dd>{strokes.length}</dd>
        </div>
        <div>
          <dt>Time practiced</dt>
          <dd>{practiced === null ? '—' : formatDuration(practiced)}</dd>
        </div>
      </dl>

      <section class="detail__section">
        <h2 class="detail__heading">Rhythm</h2>
        {finished && !wasAbandoned(test.meta) ? (
          <RhythmView test={test} strokes={strokes} />
        ) : (
          <p class="history__status">Rhythm is shown for finished runs.</p>
        )}
      </section>

      <section class="detail__section">
        <h2 class="detail__heading">Misses</h2>
        {wrong.length === 0 ? (
          <p class="history__status">No misses.</p>
        ) : (
          <div class="history__scroll">
            <table class="detail__table">
              <thead>
                <tr>
                  <th>Word</th>
                  <th>Required</th>
                  <th>Pressed</th>
                  <th>Missing</th>
                  <th>Extra</th>
                </tr>
              </thead>
              <tbody>
                {wrong.map((m, i) => (
                  <tr key={i}>
                    <td>{m.prompt}</td>
                    <td class="detail__steno">{m.expected}</td>
                    <td class="detail__steno">{m.pressed}</td>
                    <td class="detail__steno">{keys(m.missing)}</td>
                    <td class="detail__steno">{keys(m.extra)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {slow.length > 0 && (
        <section class="detail__section">
          <h2 class="detail__heading">Slowest words</h2>
          <ol class="detail__slow">
            {slow.map((s, i) => (
              <li key={i}>
                <span>{s.prompt}</span>
                <span class="detail__latency">{(s.latencyMs / 1000).toFixed(1)} s</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  )
}
