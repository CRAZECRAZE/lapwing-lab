import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { PracticeIndexEntry } from '../../scripts/build-content.ts'
import type { TestRow } from '../../server/archive.ts'
import { getLastTest } from '../api.ts'
import { currentChapter } from '../core/progress.ts'
import { FREE_MODES, PSEUDO_SOURCE, sourcesFor } from '../freetype/free.ts'
import type { FreeSource } from '../freetype/free.ts'
import { isPlainClick, navigate } from '../router.ts'
import { useProgress } from '../state/progress.tsx'
import { ChapterPanel } from './ChapterPanel.tsx'
import { Stage0Panel } from './Stage0Panel.tsx'
import './practice.css'

/** The quiet "last time" text for one free-type combination. */
function describeLast(row: TestRow | null): string {
  if (row === null || row.accuracy === null) return 'Last: —'
  return `Last: ${Math.round(row.accuracy * 100)}% · ${Math.round(row.wpm ?? 0)} wpm`
}

function FreeType(): JSX.Element {
  // Until (or unless) the index loads, the pseudo-words are the only source.
  const [sources, setSources] = useState<FreeSource[]>([PSEUDO_SOURCE])
  const [source, setSource] = useState(PSEUDO_SOURCE.id)
  const [mode, setMode] = useState(FREE_MODES[0].id)
  const [last, setLast] = useState<{ section: string; row: TestRow | null } | null>(null)
  const section = `${source}/${mode}`
  const href = `/practice/free/${section}`

  useEffect(() => {
    let live = true
    fetch('/content/practice-index.json')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return sourcesFor((await res.json()) as PracticeIndexEntry[])
      })
      .catch(() => [PSEUDO_SOURCE])
      .then((next) => live && setSources(next))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    let live = true
    void getLastTest('free', section).then((row) => live && setLast({ section, row }))
    return () => {
      live = false
    }
  }, [section])

  return (
    <section class="practice__box free-type" aria-labelledby="free-type-heading">
      <h2 id="free-type-heading" class="practice__heading">Free type</h2>
      <div class="free-type__form">
        <label class="free-type__source">
          <span class="free-type__label">Words from</span>
          <select value={source} onChange={(e) => setSource((e.currentTarget as HTMLSelectElement).value)}>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <div class="free-type__modes" role="radiogroup" aria-labelledby="free-type-mode">
          <span id="free-type-mode" class="free-type__label">Mode</span>
          {FREE_MODES.map((m) => (
            <label key={m.id} class="free-type__mode">
              <input
                type="radio"
                name="free-type-mode"
                value={m.id}
                checked={mode === m.id}
                onChange={() => setMode(m.id)}
              />
              {m.label}
            </label>
          ))}
        </div>
        <div class="free-type__go">
          <a
            class="free-type__start"
            href={href}
            onClick={(e) => {
              if (!isPlainClick(e)) return
              e.preventDefault()
              navigate(href)
            }}
          >
            Start
          </a>
          <span class="free-type__last">{describeLast(last?.section === section ? last.row : null)}</span>
        </div>
      </div>
    </section>
  )
}

/** The chapter the owner is on, with its panel and a way back to its page. Nothing until progress has loaded. */
function WhereYouAre(): JSX.Element | null {
  const progress = useProgress()
  if (progress.status !== 'ready' || progress.chapters.length === 0) return null
  const number = currentChapter(progress.chapters, progress.states)
  const info = progress.chapters.find((c) => c.chapter === number)
  if (!info) return null
  const href = `/page/${info.pageId}`
  return (
    <section class="practice__where" aria-labelledby="where-heading">
      <h2 id="where-heading" class="practice__heading">Where you are</h2>
      <p class="practice__where-title">{info.title}</p>
      <ChapterPanel chapter={number} />
      <a
        class="practice__where-go"
        href={href}
        onClick={(e) => {
          if (!isPlainClick(e)) return
          e.preventDefault()
          navigate(href)
        }}
      >
        {`Go to Chapter ${number}`}
      </a>
    </section>
  )
}

/** The Practice tab: where you are, free type, then the Chapter 4 drills. */
export function Practice(): JSX.Element {
  return (
    <div class="practice">
      <h1 class="practice__title">Practice</h1>
      <WhereYouAre />
      <FreeType />
      {/* The panel brings its own heading ("Practice — Stage 0"); the region name says where it sits. */}
      <section class="practice__drills" aria-label="Chapter 4 drills">
        <Stage0Panel />
      </section>
    </div>
  )
}
