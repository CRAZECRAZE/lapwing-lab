// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { Board } from '../../src/ui/Board.tsx'
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
    expect(key('S2-').classList.contains('key--left')).toBe(true)
    expect(key('*4').classList.contains('key--left')).toBe(true)
    expect(key('#1').classList.contains('key--left')).toBe(true)
    expect(key('O-').classList.contains('key--vowel')).toBe(true)
    expect(key('-U').classList.contains('key--vowel')).toBe(true)
    expect(key('-Z').classList.contains('key--right')).toBe(true)
    expect(key('#2').classList.contains('key--right')).toBe(true)
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
})
