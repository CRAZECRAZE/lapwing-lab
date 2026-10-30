// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../server/settings.ts'

vi.mock('../../src/api.ts', () => ({
  getSettings: vi.fn(),
  putSettings: vi.fn(),
}))
const api = await import('../../src/api.ts')
const { GhostPicker, useGhostChoice } = await import('../../src/ui/GhostPicker.tsx')
const getSettings = vi.mocked(api.getSettings)
const putSettings = vi.mocked(api.putSettings)

function Probe() {
  const [ghost, pick] = useGhostChoice()
  return (
    <div>
      <output data-testid="ghost">{ghost}</output>
      <GhostPicker value={ghost} onPick={pick} />
    </div>
  )
}

const value = (): string => screen.getByTestId('ghost').textContent!
const stored = (ghost: Settings['ghost']): Settings => ({ boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null, ghost })

beforeEach(() => {
  getSettings.mockReset().mockResolvedValue(stored('best'))
  putSettings.mockReset().mockImplementation(async (s) => ({ ...stored('best'), ...s }))
})
afterEach(cleanup)

describe('GhostPicker', () => {
  it('is a labelled group of best / last / off buttons with aria-pressed', () => {
    render(<GhostPicker value="last" onPick={() => {}} />)
    const group = screen.getByRole('group', { name: 'Ghost' })
    expect(group.textContent).toContain('Ghost')
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['best', 'last', 'off'])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
  })

  it('reports a pick', () => {
    const onPick = vi.fn()
    render(<GhostPicker value="best" onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: 'off' }))
    expect(onPick).toHaveBeenCalledWith('off')
  })
})

describe('useGhostChoice', () => {
  it('starts at best and takes the stored value once', async () => {
    getSettings.mockResolvedValue(stored('last'))
    render(<Probe />)
    expect(value()).toBe('best')
    await act(async () => {})
    expect(value()).toBe('last')
    expect(getSettings).toHaveBeenCalledTimes(1)
  })

  it('saves a pick as a ghost-only patch', async () => {
    render(<Probe />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'off' }))
    expect(value()).toBe('off')
    expect(putSettings).toHaveBeenCalledWith({ ghost: 'off' })
  })

  it('a pick made before the stored value arrives wins', async () => {
    let arrive!: (s: Settings) => void
    getSettings.mockReturnValue(new Promise<Settings>((resolve) => (arrive = resolve)))
    render(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'off' }))
    await act(async () => arrive(stored('last')))
    expect(value()).toBe('off')
  })

  it('swallows a failed save and a failed read', async () => {
    putSettings.mockRejectedValue(new Error('down'))
    getSettings.mockRejectedValue(new Error('down'))
    render(<Probe />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'last' }))
    await act(async () => {})
    expect(value()).toBe('last')
  })

  it('ignores a stored value that arrives after unmount', async () => {
    let arrive!: (s: Settings) => void
    getSettings.mockReturnValue(new Promise<Settings>((resolve) => (arrive = resolve)))
    const { unmount } = render(<Probe />)
    unmount()
    await act(async () => arrive(stored('off')))
    expect(screen.queryByTestId('ghost')).toBeNull()
  })
})
