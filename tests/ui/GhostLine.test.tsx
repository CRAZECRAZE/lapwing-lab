// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActiveGhost } from '../../src/core/ghost.ts'
import { GhostLine, GhostNote } from '../../src/ui/GhostLine.tsx'

afterEach(cleanup)

const DAY = 86_400_000
const NOW = new Date(2026, 9, 30, 12).getTime()
const ghost = (over: Partial<ActiveGhost> = {}): ActiveGhost => ({
  testId: 1,
  endedAt: NOW - 3 * DAY,
  wpm: 30,
  completions: Array.from({ length: 20 }, (_, i) => (i + 1) * 1000),
  label: 'Best',
  ...over,
})

describe('GhostLine', () => {
  it('says what the ghost and you have done', () => {
    const { container } = render(<GhostLine ghost={ghost()} you={12} elapsedMs={14_500} total={null} nowMs={NOW} />)
    expect(container.querySelector('.ghost__text')!.textContent).toBe('Ghost (best, 3 days ago) 14 · You 12')
  })

  it('names the last run', () => {
    const { container } = render(
      <GhostLine ghost={ghost({ label: 'Last', endedAt: NOW })} you={0} elapsedMs={0} total={20} nowMs={NOW} />,
    )
    expect(container.querySelector('.ghost__text')!.textContent).toBe('Ghost (last, today) 0 · You 0')
  })

  it('draws two tracks, both hidden from assistive tech, sized by progress', () => {
    const { container } = render(<GhostLine ghost={ghost()} you={5} elapsedMs={10_000} total={20} nowMs={NOW} />)
    const tracks = [...container.querySelectorAll('.ghost__track')]
    expect(tracks).toHaveLength(2)
    expect(tracks.every((t) => t.getAttribute('aria-hidden') === 'true')).toBe(true)
    const fills = tracks.map((t) => (t.firstElementChild as HTMLElement).style.width)
    expect(fills).toEqual(['50%', '25%']) // the ghost first, then you
  })

  it('keeps a track inside its bar when a run outgrows the total', () => {
    const { container } = render(<GhostLine ghost={ghost()} you={30} elapsedMs={20_000} total={20} nowMs={NOW} />)
    const fills = [...container.querySelectorAll('.ghost__fill')].map((f) => (f as HTMLElement).style.width)
    expect(fills).toEqual(['100%', '100%'])
  })

  it('is not a live region', () => {
    const { container } = render(<GhostLine ghost={ghost()} you={1} elapsedMs={1000} total={null} nowMs={NOW} />)
    expect(container.querySelector('[aria-live]')).toBeNull()
    expect(container.querySelector('[role="status"], [role="alert"], [role="log"]')).toBeNull()
  })
})

describe('GhostNote', () => {
  const stats = { completed: 25, firstTryCorrect: 25, accuracy: 1, elapsedMs: 41_000, wpm: 36 }

  it('is the comparison line', () => {
    const g = ghost({ completions: Array.from({ length: 30 }, (_, i) => (i + 1) * 1000) })
    const { container } = render(<GhostNote ghost={g} stats={stats} />)
    expect(container.textContent).toBe('Best run (3 days ago) had 30 words by 0:41. You: 25 — 5 behind.')
  })

  it('renders nothing without a ghost', () => {
    const { container } = render(<GhostNote ghost={null} stats={stats} />)
    expect(container.innerHTML).toBe('')
  })
})
