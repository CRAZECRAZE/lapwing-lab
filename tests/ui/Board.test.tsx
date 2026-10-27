// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { Board } from '../../src/ui/Board.tsx'
import { LEVERS } from '../../src/core/uni.ts'
import { parseStroke } from '../../src/core/steno.ts'

afterEach(cleanup)

const levers = (container: Element, cls: string): string[] =>
  [...container.querySelectorAll(`.${cls}`)].map((el) => el.getAttribute('data-lever')!)

describe('Board', () => {
  it('renders exactly 28 keys, labelled and coloured by hand', () => {
    const { container } = render(<Board />)
    expect(container.querySelectorAll('[data-lever]')).toHaveLength(28)
    const key = (lever: string) => container.querySelector(`[data-lever="${lever}"]`)!
    expect(key('S1-').textContent).toBe('S')
    expect(key('-F').textContent).toBe('-F')
    expect(key('*3').textContent).toBe('*')
    expect(key('-E').textContent).toBe('E')
    expect(key('#2').textContent).toBe('#')
    const expected: Record<string, string> = {}
    for (const l of ['S1-', 'S2-', 'T-', 'K-', 'P-', 'W-', 'H-', 'R-', '*1', '*2', '*3', '*4', '#1']) expected[l] = 'left'
    for (const l of ['A-', 'O-', '-E', '-U']) expected[l] = 'vowel'
    for (const l of ['-F', '-R', '-P', '-B', '-L', '-G', '-T', '-S', '-D', '-Z', '#2']) expected[l] = 'right'
    expect(Object.keys(expected).sort()).toEqual([...LEVERS].sort())
    for (const lever of LEVERS) {
      const cls = [...key(lever).classList].filter((c) => /^key--(left|vowel|right)$/.test(c))
      expect(cls, lever).toEqual([`key--${expected[lever]}`])
    }
  })

  it('splits the halves after the fifth column in every row', () => {
    const { container } = render(<Board />)
    const cells = [...container.querySelector('.board')!.children]
    expect(cells).toHaveLength(33)
    for (let r = 0; r < 3; r++) {
      const row = cells.slice(r * 11, r * 11 + 11)
      expect(row.map((el) => el.classList.contains('board__cell--gap')), `row ${r}`).toEqual(
        row.map((_, c) => c === 5),
      )
    }
    const before = (r: number) => cells.slice(r * 11, r * 11 + 5).map((el) => el.getAttribute('data-lever'))
    expect(before(0)).toEqual(['S1-', 'T-', 'P-', 'H-', '*1'])
    expect(before(1)).toEqual(['S2-', 'K-', 'W-', 'R-', '*2'])
    expect(before(2)).toEqual([null, null, '#1', 'A-', 'O-'])
  })

  it('is an accessible image and honours size', () => {
    const { container } = render(<Board size={30} />)
    const board = container.querySelector('.board') as HTMLElement
    expect(board.getAttribute('role')).toBe('img')
    expect(board.getAttribute('aria-label')).toBe('Uni v4 board')
    expect(board.style.getPropertyValue('--s')).toBe('30px')
    expect(container.querySelector('[data-lever]')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('lights every lever aliasing a target slot', () => {
    const { container } = render(<Board target={parseStroke('SPA')} />)
    expect(levers(container, 'key--target').sort()).toEqual(['A-', 'P-', 'S1-', 'S2-'])
    expect(container.querySelector('.key--down, .key--missing, .key--extra')).toBeNull()
  })

  it('tells left P- from right -P', () => {
    // In steno order, a P after the vowel is the right-hand -P.
    const { container } = render(<Board target={parseStroke('SAP')} />)
    expect(levers(container, 'key--target').sort()).toEqual(['-P', 'A-', 'S1-', 'S2-'])
  })

  it('marks pressed levers only', () => {
    const { container } = render(<Board pressed={['*3']} />)
    expect(levers(container, 'key--down')).toEqual(['*3'])
    expect(container.querySelector('.key--target')).toBeNull()
  })

  it('overlays missing and extra slots', () => {
    const { container } = render(
      <Board diff={{ missing: parseStroke('T'), extra: parseStroke('-Z') }} />,
    )
    expect(levers(container, 'key--missing')).toEqual(['T-'])
    expect(levers(container, 'key--extra')).toEqual(['-Z'])
  })

  it('marks both S levers when the S slot is missing', () => {
    const { container } = render(<Board diff={{ missing: parseStroke('S'), extra: 0 }} />)
    expect(levers(container, 'key--missing').sort()).toEqual(['S1-', 'S2-'])
  })
})
