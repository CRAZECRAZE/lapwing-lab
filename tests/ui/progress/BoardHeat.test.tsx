// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { LEVERS } from '../../../src/core/uni.ts'
import { slotMask } from '../../../src/core/steno.ts'
import { Board } from '../../../src/ui/Board.tsx'
import type { BoardProps } from '../../../src/ui/Board.tsx'

afterEach(cleanup)

/** Every cell of a rendered board: its tag, class list and every attribute, in DOM order. */
function shape(container: Element): { tag: string; classes: string[]; attrs: [string, string][] }[] {
  return [...container.querySelector('.board')!.children].map((el) => ({
    tag: el.tagName,
    classes: [...el.classList],
    attrs: [...el.attributes].map((a): [string, string] => [a.name, a.value]),
  }))
}

const PROP_SETS: BoardProps[] = [
  {},
  { size: 22 },
  { target: slotMask('S-') | slotMask('-F') },
  { pressed: ['S1-', '-F', '#2'] },
  { target: slotMask('*'), pressed: ['*1'], diff: { missing: slotMask('-P'), extra: slotMask('-B') } },
]

describe('Board heat prop', () => {
  it('renders exactly as before when heat is absent or an empty object', () => {
    for (const props of PROP_SETS) {
      const without = render(<Board {...props} />)
      const a = shape(without.container)
      without.unmount()
      const empty = render(<Board {...props} heat={{}} />)
      const b = shape(empty.container)
      empty.unmount()
      expect(b, JSON.stringify(props)).toEqual(a)
      expect(a.flatMap((c) => c.classes)).not.toContain('key--heat')
    }
  })

  it('gives a heated slot the key--heat class and a --heat value rounded to 2 decimals, on its levers only', () => {
    const { container } = render(<Board heat={{ '-F': 0.4567, '-P': 1 }} />)
    const heated = [...container.querySelectorAll('.key--heat')]
    expect(heated.map((el) => el.getAttribute('data-lever')).sort()).toEqual(['-F', '-P'])
    const value = (lever: string): string =>
      (container.querySelector(`[data-lever="${lever}"]`) as HTMLElement).style.getPropertyValue('--heat')
    expect(value('-F')).toBe('0.46')
    expect(value('-P')).toBe('1')
    expect(container.querySelector('[data-lever="-B"]')!.getAttribute('style')).toBeNull()
    expect(container.querySelector('[data-lever="-B"]')!.classList.contains('key--heat')).toBe(false)
  })

  it('heats by slot: S- lights both S levers, * all four star levers, # both number levers', () => {
    const { container } = render(<Board heat={{ 'S-': 0.5, '*': 0.5, '#': 0.5 }} />)
    const heated = [...container.querySelectorAll('.key--heat')].map((el) => el.getAttribute('data-lever')!).sort()
    expect(heated).toEqual(['#1', '#2', '*1', '*2', '*3', '*4', 'S1-', 'S2-'])
  })

  it('does not shade a slot whose heat is 0, negative, not a number, or rounds to 0', () => {
    const { container } = render(<Board heat={{ '-F': 0, '-P': -0.5, '-B': Number.NaN, '-L': 0.004 }} />)
    expect(container.querySelectorAll('.key--heat')).toHaveLength(0)
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('caps a heat above 1 at 1', () => {
    const { container } = render(<Board heat={{ '-F': 7 }} />)
    expect((container.querySelector('[data-lever="-F"]') as HTMLElement).style.getPropertyValue('--heat')).toBe('1')
  })

  it('keeps the other classes of a heated key (target, hand) and leaves the unheated keys untouched', () => {
    const plain = shape(render(<Board target={slotMask('-F')} />).container)
    cleanup()
    const heated = shape(render(<Board target={slotMask('-F')} heat={{ '-F': 0.8 }} />).container)
    const index = heated.findIndex((c) => c.attrs.some(([n, v]) => n === 'data-lever' && v === '-F'))
    expect([...heated[index].classes].sort()).toEqual([...plain[index].classes, 'key--heat'].sort())
    expect(heated.filter((_, i) => i !== index)).toEqual(plain.filter((_, i) => i !== index))
    expect(LEVERS).toContain('-F')
  })
})
