// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { backTarget } from '../../src/ui/backTarget.ts'

afterEach(() => history.replaceState(null, '', '/'))

describe('backTarget', () => {
  it('leads to the routine page when the page was opened from a routine', () => {
    history.replaceState(null, '', '/practice/free/pseudo/words-25?from=routine')
    expect(backTarget('/practice', 'Back to Practice')).toEqual({ href: '/practice/routine', label: 'Back to routine' })
  })

  it('finds the marker among other parameters', () => {
    history.replaceState(null, '', '/drill/list/5-cvc?x=1&from=routine')
    expect(backTarget('/page/ch05', 'Back to Chapter 5').href).toBe('/practice/routine')
  })

  it('returns the arguments without the marker, or with another one', () => {
    history.replaceState(null, '', '/practice/free/pseudo/words-25')
    expect(backTarget('/practice', 'Back to Practice')).toEqual({ href: '/practice', label: 'Back to Practice' })
    history.replaceState(null, '', '/practice/free/pseudo/words-25?from=other')
    expect(backTarget('/practice', 'Back to Practice')).toEqual({ href: '/practice', label: 'Back to Practice' })
  })
})
