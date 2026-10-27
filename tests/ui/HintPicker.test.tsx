// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../server/settings.ts'

vi.mock('../../src/api.ts', () => ({
  getSettings: vi.fn(),
  putSettings: vi.fn(),
}))
const api = await import('../../src/api.ts')
const { HintPicker, useHints } = await import('../../src/ui/HintPicker.tsx')
const getSettings = vi.mocked(api.getSettings)
const putSettings = vi.mocked(api.putSettings)

function Probe() {
  const [hints, pick] = useHints()
  return (
    <div>
      <output data-testid="hints">{hints}</output>
      <HintPicker value={hints} onPick={pick} />
    </div>
  )
}

const value = (): string => screen.getByTestId('hints').textContent!
const stored = (hints: Settings['hints']): Settings => ({ boardVisibility: 'always', hints })

beforeEach(() => {
  getSettings.mockReset().mockResolvedValue(stored('miss'))
  putSettings.mockReset().mockImplementation(async (s) => ({ ...stored('miss'), ...s }))
})
afterEach(cleanup)

describe('HintPicker', () => {
  it('is a labelled group of on miss / always buttons with aria-pressed', () => {
    render(<HintPicker value="always" onPick={() => {}} />)
    const group = screen.getByRole('group', { name: 'Hint' })
    expect(group.textContent).toContain('Hint')
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['on miss', 'always'])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  })

  it('reports a pick', () => {
    const onPick = vi.fn()
    render(<HintPicker value="miss" onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: 'always' }))
    expect(onPick).toHaveBeenCalledWith('always')
  })
})

describe('useHints', () => {
  it('starts at miss and takes the stored value once', async () => {
    getSettings.mockResolvedValue(stored('always'))
    render(<Probe />)
    expect(value()).toBe('miss')
    await act(async () => {})
    expect(value()).toBe('always')
    expect(getSettings).toHaveBeenCalledTimes(1)
  })

  it('saves a pick as a hints-only patch', async () => {
    render(<Probe />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'always' }))
    expect(value()).toBe('always')
    expect(putSettings).toHaveBeenCalledWith({ hints: 'always' })
  })

  it('a pick made before the stored value arrives wins', async () => {
    let arrive!: (s: Settings) => void
    getSettings.mockReturnValue(new Promise<Settings>((resolve) => (arrive = resolve)))
    render(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'always' }))
    await act(async () => arrive(stored('miss')))
    expect(value()).toBe('always')
  })

  it('swallows a failed save: the pick still applies for the session', async () => {
    putSettings.mockRejectedValue(new Error('down'))
    render(<Probe />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'always' }))
    await act(async () => {})
    expect(value()).toBe('always')
  })

  it('ignores a stored value that arrives after unmount', async () => {
    let arrive!: (s: Settings) => void
    getSettings.mockReturnValue(new Promise<Settings>((resolve) => (arrive = resolve)))
    const { unmount } = render(<Probe />)
    unmount()
    await act(async () => arrive(stored('always')))
    expect(screen.queryByTestId('hints')).toBeNull()
  })
})
