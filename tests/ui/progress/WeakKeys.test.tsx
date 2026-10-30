// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { HEAT_FULL_RATE } from '../../../src/ui/progress/WeakKeys.tsx'
import { MIN_KEY_PRESSES } from '../../../src/core/keystats.ts'
import type { KeyStat } from '../../../src/core/keystats.ts'
import type { Slot } from '../../../src/core/steno.ts'
import { WeakKeys } from '../../../src/ui/progress/WeakKeys.tsx'
import { badNumbers, ready } from './fixtures.ts'

afterEach(cleanup)

const k = (slot: Slot, required: number, missed: number): KeyStat => ({ slot, required, missed })
const show = (keys: KeyStat[]): { container: Element } => render(<WeakKeys data={ready({ keys })} />)
const heat = (c: Element, lever: string): number | null => {
  const el = c.querySelector<HTMLElement>(`[data-lever="${lever}"]`)!
  return el.classList.contains('key--heat') ? Number(el.style.getPropertyValue('--heat')) : null
}
const heated = (c: Element): string[] => [...c.querySelectorAll('.key--heat')].map((el) => el.getAttribute('data-lever')!).sort()
const items = (c: Element): string[] => [...c.querySelectorAll('.weak__list li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim())

describe('WeakKeys: threshold and ranking', () => {
  it('has the title and the board', () => {
    const { container } = show([k('-F', 66, 14)])
    expect(screen.getByRole('heading', { level: 2, name: 'Weakest keys' })).toBeTruthy()
    expect(container.querySelectorAll('.board')).toHaveLength(1)
  })

  it('names all modes and the period of the range in its scope', () => {
    for (const [range, text] of [['4w', 'all modes, last 4 weeks'], ['3m', 'all modes, last 3 months'], ['all', 'all modes, all time']] as const) {
      const view = render(<WeakKeys data={ready({ keys: [k('-F', 66, 14)], range })} />)
      expect(view.container.querySelector('.panel__scope')!.textContent).toBe(text)
      cleanup()
    }
  })

  it('does not rank a key with 29 required presses and ranks one with 30', () => {
    expect(MIN_KEY_PRESSES).toBe(30)
    const below = show([k('-F', 29, 20), k('-P', 100, 5)])
    expect(items(below.container)).toEqual(['-P 5% missed (5 of 100)'])
    expect(heated(below.container)).toEqual(['-P'])
    cleanup()
    const at = show([k('-F', 30, 20), k('-P', 100, 5)])
    expect(items(at.container)).toEqual(['-F 67% missed (20 of 30)', '-P 5% missed (5 of 100)'])
    expect(heated(at.container)).toEqual(['-F', '-P'])
  })

  it('lists the worst five by rate, then required presses, then board order, and leaves out 0%', () => {
    const { container } = show([
      k('S-', 100, 10), // 10%
      k('T-', 100, 30), // 30%
      k('K-', 200, 60), // 30%, more presses: before T-
      k('P-', 50, 15), // 30%, fewest presses: last of the 30s
      k('W-', 100, 20), // 20%
      k('H-', 100, 25), // 25%
      k('R-', 100, 0), // 0%: not listed
      k('A-', 100, 15), // 15%
    ])
    expect(items(container)).toEqual([
      'K- 30% missed (60 of 200)',
      'T- 30% missed (30 of 100)',
      'P- 30% missed (15 of 50)',
      'H- 25% missed (25 of 100)',
      'W- 20% missed (20 of 100)',
    ])
  })

  it('breaks a tie of rate and presses by the board order of the keys', () => {
    const { container } = show([k('-G', 100, 10), k('T-', 100, 10), k('-F', 100, 10)])
    expect(items(container).map((t) => t.split(' ')[0])).toEqual(['T-', '-F', '-G'])
  })

  it('does not list a key with nothing missed, even when it is the only ranked key', () => {
    const { container } = show([k('-F', 500, 0)])
    expect(items(container)).toEqual([])
    expect(container.textContent).toContain('Nothing missed on any key with enough presses.')
    expect(heated(container)).toEqual([])
  })

  it('writes a rate under 1% as <1%', () => {
    const { container } = show([k('-F', 1000, 2)])
    expect(items(container)).toEqual(['-F <1% missed (2 of 1,000)'])
  })

  it('shades by an absolute scale: 25% missed or more is 1, a key at 12.5% is 0.5, 1% is 0.04, 0% is not shaded', () => {
    expect(HEAT_FULL_RATE).toBe(0.25)
    const { container } = show([k('-F', 100, 40), k('-P', 200, 25), k('-B', 100, 25), k('-L', 100, 1), k('-R', 100, 0), k('T-', 29, 29)])
    expect(heat(container, '-F')).toBe(1) // 40%: capped
    expect(heat(container, '-B')).toBe(1) // exactly 25%
    expect(heat(container, '-P')).toBe(0.5) // 12.5%
    expect(heat(container, '-L')).toBe(0.04)
    expect(heat(container, '-R')).toBeNull()
    expect(heat(container, 'T-')).toBeNull() // too few presses
    expect(heat(container, '-D')).toBeNull() // no data
  })

  it('does not paint the worst key red when every rate is low: nothing reaches 0.1 under 2%', () => {
    const { container } = show([k('-G', 1190, 10), k('-R', 1316, 10), k('-F', 500, 4), k('S-', 300, 1)])
    const values = [...container.querySelectorAll('.key--heat')].map((el) => Number((el as HTMLElement).style.getPropertyValue('--heat')))
    expect(values.length).toBeGreaterThan(0)
    expect(Math.max(...values)).toBeLessThan(0.1)
    expect(heat(container, '-G')).toBe(0.03) // 0.84% / 25%
  })

  it('gives the same key the same heat whatever the other keys are (the scale is not relative)', () => {
    const alone = heat(show([k('-F', 100, 10)]).container, '-F')
    cleanup()
    const among = heat(show([k('-F', 100, 10), k('-P', 100, 60), k('-B', 100, 90)]).container, '-F')
    expect(among).toBe(alone)
    expect(alone).toBe(0.4)
  })

  it('keeps every heat within 0 and 1', () => {
    const { container } = show([k('-F', 31, 31), k('-P', 3000, 7), k('S-', 30, 1), k('*', 90, 45)])
    for (const el of container.querySelectorAll('.key--heat') as NodeListOf<HTMLElement>) {
      const v = Number(el.style.getPropertyValue('--heat'))
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(heat(container, '-F')).toBe(1)
  })

  it('explains the colour under the board, built from the full-heat rate', () => {
    const { container } = show([k('-F', 66, 14)])
    expect(container.querySelector('.weak__board')!.textContent).toContain('Colour: share of presses missed, from none to 25% or more.')
  })

  it('heats by slot: S- lights both S levers and * all four star levers', () => {
    const { container } = show([k('S-', 100, 30), k('*', 100, 15)])
    expect(heated(container)).toEqual(['*1', '*2', '*3', '*4', 'S1-', 'S2-'])
    expect(heat(container, 'S2-')).toBe(1) // 30%
    expect(heat(container, '*4')).toBe(0.6) // 15%
  })

  it('does not shade a key whose counts make no rate (missed above nothing, odd numbers)', () => {
    const { container } = show([k('-F', Number.POSITIVE_INFINITY, 5), k('-P', Number.NaN, 5), k('-B', 100, -3), k('-L', 100, Number.NaN)])
    expect(heated(container)).toEqual([])
    expect(items(container)).toEqual([])
  })
})

describe('WeakKeys: the words', () => {
  it('says not enough data yet and how many presses a key needs, and still draws the board without heat', () => {
    const { container } = show([k('-F', 29, 20), k('-P', 12, 3)])
    expect(container.textContent).toContain('not enough data yet')
    expect(container.textContent).toContain('A key needs 30 presses to be ranked.')
    expect(container.querySelectorAll('.board')).toHaveLength(1)
    expect(container.querySelectorAll('.key')).toHaveLength(28)
    expect(heated(container)).toEqual([])
    expect(items(container)).toEqual([])
  })

  it('says not enough data yet with no keys at all', () => {
    const { container } = show([])
    expect(container.textContent).toContain('not enough data yet')
    expect(container.querySelectorAll('.board')).toHaveLength(1)
  })

  it('does not say not enough data yet when keys are ranked', () => {
    const { container } = show([k('-F', 66, 14)])
    expect(container.textContent).not.toContain('not enough data yet')
  })

  it('explains the multi-stroke limit in a note', () => {
    const { container } = show([k('-F', 66, 14)])
    expect(container.textContent).toContain('For words with several strokes, a miss is matched to the closest stroke of the word.')
  })

  it('describes the colouring and the threshold', () => {
    const { container } = show([k('-F', 66, 14)])
    expect(container.textContent).toContain('A key needs 30 presses to be ranked.')
    expect(container.textContent).toMatch(/red/i)
  })
})

describe('WeakKeys: the numbers', () => {
  it('has a table of every key with presses, marking those under the threshold as too few', () => {
    const { container } = show([k('S-', 29, 10), k('-F', 66, 14), k('-P', 30, 0), k('-B', 0, 0)])
    const details = container.querySelector('details.chart__numbers') as HTMLElement
    expect(within(details).getByText('Show the numbers')).toBeTruthy()
    const rows = [...details.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent))
    expect(rows).toEqual([
      ['S-', '29', '10', 'too few'],
      ['-F', '66', '14', '21%'],
      ['-P', '30', '0', '0%'],
    ])
    expect([...details.querySelectorAll('thead th')].map((c) => c.textContent)).toEqual(['Key', 'Needed', 'Missed', 'Rate'])
  })

  it('has the table even when no key is ranked', () => {
    const { container } = show([k('S-', 10, 1)])
    expect(container.querySelectorAll('details.chart__numbers tbody tr')).toHaveLength(1)
  })
})

describe('WeakKeys: no NaN or Infinity', () => {
  const FIXTURES: [string, KeyStat[]][] = [
    ['empty', []],
    ['one key', [k('-F', 66, 14)]],
    ['all keys', (['S-', 'T-', 'K-', 'P-', 'W-', 'H-', 'R-', 'A-', 'O-', '*', '-E', '-U', '-F', '-R', '-P', '-B', '-L', '-G', '-T', '-S', '-D', '-Z', '#'] as Slot[]).map((s, i) => k(s, 40 + i, i))],
    ['zero required', [k('-F', 0, 0), k('-P', 0, 5)]],
    ['missed above required', [k('-F', 40, 90)]],
    ['odd numbers', [k('-F', Number.NaN, 1), k('-P', Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY), k('-B', -5, -5), k('-L', Number.MAX_VALUE, Number.MAX_VALUE)]],
  ]
  for (const [name, keys] of FIXTURES) {
    it(`has none in attributes or text: ${name}`, () => {
      const { container } = show(keys)
      expect(badNumbers(container)).toEqual([])
    })
  }
})

describe('WeakKeys: Drill these', () => {
  const drill = (): HTMLElement => screen.getByRole('link', { name: 'Drill these' })

  it('links to the pattern fix-up page', () => {
    render(<WeakKeys data={ready({ keys: [] })} />)
    expect(drill().getAttribute('href')).toBe('/practice/fixup/patterns')
    expect(screen.getByText('not enough data yet')).toBeTruthy()
  })

  it('is also there when the panel has data', () => {
    render(<WeakKeys data={ready({ keys: [k('-F', 66, 14)] })} />)
    expect(drill().getAttribute('href')).toBe('/practice/fixup/patterns')
    expect(screen.queryByText('not enough data yet')).toBeNull()
  })

  it('is in the panel, and navigates on a plain click', () => {
    history.replaceState(null, '', '/progress')
    const { container } = render(<WeakKeys data={ready({ keys: [] })} />)
    expect(container.querySelector('section')!.contains(drill())).toBe(true)
    expect(fireEvent.click(drill())).toBe(false)
    expect(location.pathname).toBe('/practice/fixup/patterns')
  })
})
