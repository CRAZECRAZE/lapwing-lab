// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ghost } from '../../src/core/ghost.ts'
import type { GhostChoice } from '../../src/ui/GhostPicker.tsx'

vi.mock('../../src/api.ts', () => ({ getGhosts: vi.fn() }))
const api = await import('../../src/api.ts')
const { useGhost } = await import('../../src/ui/useGhost.ts')
const getGhosts = vi.mocked(api.getGhosts)

const best: Ghost = { testId: 1, endedAt: 100, wpm: 40, completions: [1000, 2000, 3000, 4000, 5000] }
const last: Ghost = { testId: 2, endedAt: 200, wpm: 30, completions: [1500, 3000, 4500, 6000, 7500] }

let seen: ReturnType<typeof useGhost> = null
const renders: ReturnType<typeof useGhost>[] = []
function Probe(p: { mode: string; section: string | null; choice: GhostChoice; attempt: number; ready?: boolean }) {
  seen = useGhost(p.mode, p.section, p.choice, p.attempt, p.ready ?? true)
  renders.push(seen)
  return null
}
const mount = async (props: Parameters<typeof Probe>[0]) => {
  const view = render(<Probe {...props} />)
  await act(async () => {})
  return view
}

beforeEach(() => {
  seen = null
  renders.length = 0
  getGhosts.mockReset().mockResolvedValue({ best, last })
})
afterEach(cleanup)

describe('useGhost', () => {
  it('is the best run, labelled', async () => {
    await mount({ mode: 'free', section: 'pseudo/words-25', choice: 'best', attempt: 0 })
    expect(seen).toEqual({ ...best, label: 'Best' })
    expect(getGhosts).toHaveBeenCalledWith('free', 'pseudo/words-25')
  })

  it('is the last run when asked for it', async () => {
    await mount({ mode: 'free', section: 's', choice: 'last', attempt: 0 })
    expect(seen).toEqual({ ...last, label: 'Last' })
  })

  it('is null for off, without asking', async () => {
    await mount({ mode: 'free', section: 's', choice: 'off', attempt: 0 })
    expect(seen).toBeNull()
    expect(getGhosts).not.toHaveBeenCalled()
  })

  it('is null without a section, without asking', async () => {
    await mount({ mode: 'free', section: null, choice: 'best', attempt: 0 })
    expect(seen).toBeNull()
    expect(getGhosts).not.toHaveBeenCalled()
  })

  it('is null when there is no such run', async () => {
    getGhosts.mockResolvedValue({ best: null, last: null })
    await mount({ mode: 'free', section: 's', choice: 'best', attempt: 0 })
    expect(seen).toBeNull()
  })

  it('is null when the lookup fails, quietly', async () => {
    getGhosts.mockRejectedValue(new Error('down'))
    await mount({ mode: 'free', section: 's', choice: 'best', attempt: 0 })
    expect(seen).toBeNull()
  })

  it('is null when the api call itself throws', async () => {
    getGhosts.mockImplementation(() => {
      throw new Error('boom')
    })
    await mount({ mode: 'free', section: 's', choice: 'best', attempt: 0 })
    expect(seen).toBeNull()
  })

  it('asks again when the attempt changes, and drops the old ghost meanwhile', async () => {
    const view = await mount({ mode: 'free', section: 's', choice: 'best', attempt: 0 })
    expect(seen).not.toBeNull()
    let arrive!: (g: { best: Ghost | null; last: Ghost | null }) => void
    getGhosts.mockReturnValue(new Promise((resolve) => (arrive = resolve)))
    view.rerender(<Probe mode="free" section="s" choice="best" attempt={1} />)
    await act(async () => {})
    expect(getGhosts).toHaveBeenCalledTimes(2)
    expect(seen).toBeNull()
    await act(async () => arrive({ best: last, last }))
    expect(seen).toEqual({ ...last, label: 'Best' })
  })

  it('asks nothing and shows nothing until the choice is ready, then asks once', async () => {
    const view = await mount({ mode: 'free', section: 's', choice: 'best', attempt: 0, ready: false })
    expect(seen).toBeNull()
    expect(getGhosts).not.toHaveBeenCalled()
    view.rerender(<Probe mode="free" section="s" choice="last" attempt={0} ready />)
    await act(async () => {})
    expect(getGhosts).toHaveBeenCalledTimes(1)
    expect(seen).toEqual({ ...last, label: 'Last' })
  })

  it('shows no ghost of the old attempt on the first render of a new one', async () => {
    const view = await mount({ mode: 'free', section: 's', choice: 'best', attempt: 0 })
    expect(seen).not.toBeNull()
    getGhosts.mockReturnValue(new Promise(() => {}))
    const before = renders.length
    view.rerender(<Probe mode="free" section="s" choice="best" attempt={1} />)
    expect(renders[before]).toBeNull()
  })

  it('ignores an answer that arrives after a newer question', async () => {
    let arriveOld!: (g: { best: Ghost | null; last: Ghost | null }) => void
    getGhosts.mockReturnValueOnce(new Promise((resolve) => (arriveOld = resolve)))
    const view = render(<Probe mode="free" section="s" choice="best" attempt={0} />)
    view.rerender(<Probe mode="free" section="s" choice="off" attempt={0} />)
    await act(async () => arriveOld({ best, last }))
    expect(seen).toBeNull()
  })
})
