// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { MIN_MIXUP_COUNT } from '../../../src/core/keystats.ts'
import type { Mixup } from '../../../src/core/keystats.ts'
import type { Slot } from '../../../src/core/steno.ts'
import { Mixups } from '../../../src/ui/progress/Mixups.tsx'
import { badNumbers, ready } from './fixtures.ts'

afterEach(cleanup)

const m = (pressed: Slot, needed: Slot, count: number): Mixup => ({ pressed, needed, count })
const show = (mixups: Mixup[]): ReturnType<typeof render> => render(<Mixups data={ready({ mixups })} />)
const items = (c: Element): string[] => [...c.querySelectorAll('.mixups__list li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim())

describe('Mixups', () => {
  it('has the title and the plain-words line', () => {
    const { container } = show([m('-P', '-B', 9)])
    expect(screen.getByRole('heading', { level: 2, name: 'Mix-ups' })).toBeTruthy()
    expect(container.textContent).toContain('A mix-up is a miss where you pressed one wrong key in place of the one you needed.')
  })

  it('names all modes and the period of the range in its scope', () => {
    for (const [range, text] of [['4w', 'all modes, last 4 weeks'], ['3m', 'all modes, last 3 months'], ['all', 'all modes, all time']] as const) {
      const view = render(<Mixups data={ready({ mixups: [m('-P', '-B', 9)], range })} />)
      expect(view.container.querySelector('.panel__scope')!.textContent).toBe(text)
      cleanup()
    }
  })

  it('writes `-P instead of -B · 9 times` with the keys in code', () => {
    const { container } = show([m('-P', '-B', 9)])
    expect(items(container)).toEqual(['-P instead of -B · 9 times'])
    const codes = [...container.querySelectorAll('.mixups__list li code')].map((c) => c.textContent)
    expect(codes).toEqual(['-P', '-B'])
  })

  it('writes 1 time and N times, with the slot names as stored', () => {
    expect(MIN_MIXUP_COUNT).toBe(3)
    const { container } = show([m('S-', '*', 12), m('-T', '-S', 3)])
    expect(items(container)).toEqual(['S- instead of * · 12 times', '-T instead of -S · 3 times'])
  })

  it('lists a pair seen 3 times and not one seen 2 times', () => {
    const { container } = show([m('-P', '-B', 3), m('-F', '-R', 2), m('-L', '-G', 1)])
    expect(items(container)).toEqual(['-P instead of -B · 3 times'])
  })

  it('keeps the top 8 in the order given and cuts the rest', () => {
    const pairs = (['S-', 'T-', 'K-', 'P-', 'W-', 'H-', 'R-', 'A-', 'O-', '-E'] as Slot[]).map((s, i) => m(s, '-F', 20 - i))
    const { container } = show(pairs)
    expect(items(container)).toHaveLength(8)
    expect(items(container)[0]).toBe('S- instead of -F · 20 times')
    expect(items(container)[7]).toBe('A- instead of -F · 13 times')
    expect(container.textContent).not.toContain('O- instead of')
  })

  it('does not count an under-threshold pair against the top 8', () => {
    const pairs = [m('S-', '-F', 2), ...(['T-', 'K-', 'P-', 'W-', 'H-', 'R-', 'A-', 'O-'] as Slot[]).map((s) => m(s, '-F', 5))]
    expect(items(show(pairs).container)).toHaveLength(8)
  })

  it('says no repeated mix-ups yet when there is none, or none at the threshold', () => {
    const none = show([])
    expect(none.container.textContent).toContain('no repeated mix-ups yet')
    expect(items(none.container)).toEqual([])
    cleanup()
    const few = show([m('-P', '-B', 2)])
    expect(few.container.textContent).toContain('no repeated mix-ups yet')
    expect(few.container.textContent).toContain('A mix-up is a miss')
    expect(few.container.querySelector('details')).toBeNull()
  })

  it('has a table of the pairs seen at least 3 times, all of them, under Show the numbers', () => {
    const pairs = (['S-', 'T-', 'K-', 'P-', 'W-', 'H-', 'R-', 'A-', 'O-', '-E'] as Slot[]).map((s, i) => m(s, '-F', 15 - i))
    const { container } = show([...pairs, m('-U', '-F', 2)])
    const details = container.querySelector('details.chart__numbers') as HTMLElement
    expect(within(details).getByText('Show the numbers')).toBeTruthy()
    const rows = [...details.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent))
    expect(rows).toHaveLength(10)
    expect(rows[0]).toEqual(['S-', '-F', '15'])
    expect([...details.querySelectorAll('thead th')].map((c) => c.textContent)).toEqual(['Pressed', 'Needed', 'Times'])
  })

  it('has no NaN or Infinity for odd counts', () => {
    const { container } = show([m('-P', '-B', Number.NaN), m('-F', '-R', Number.POSITIVE_INFINITY), m('-L', '-G', 4)])
    expect(badNumbers(container)).toEqual([])
    expect(items(container)).toEqual(['-L instead of -G · 4 times'])
  })
})

describe('Mixups: Drill these', () => {
  const drill = (): HTMLElement => screen.getByRole('link', { name: 'Drill these' })

  it('links to the pattern fix-up page', () => {
    render(<Mixups data={ready({ mixups: [] })} />)
    expect(drill().getAttribute('href')).toBe('/practice/fixup/patterns')
    expect(screen.getByText('no repeated mix-ups yet')).toBeTruthy()
  })

  it('is also there when the panel has data', () => {
    render(<Mixups data={ready({ mixups: [m('-P', '-B', 9)] })} />)
    expect(drill().getAttribute('href')).toBe('/practice/fixup/patterns')
    expect(screen.queryByText('no repeated mix-ups yet')).toBeNull()
  })

  it('is in the panel, and navigates on a plain click', () => {
    history.replaceState(null, '', '/progress')
    const { container } = render(<Mixups data={ready({ mixups: [] })} />)
    expect(container.querySelector('section')!.contains(drill())).toBe(true)
    expect(fireEvent.click(drill())).toBe(false)
    expect(location.pathname).toBe('/practice/fixup/patterns')
  })
})
