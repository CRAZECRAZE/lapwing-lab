// @vitest-environment jsdom
import { createElement } from 'preact'
import { cleanup, render } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { DockProvider } from '../../src/state/dock.tsx'
import { TopBar } from '../../src/ui/TopBar.tsx'
import { TOUR_STEPS } from '../../src/ui/tourSteps.ts'

afterEach(cleanup)

const words = (text: string): number => text.trim().split(/\s+/).length

describe('TOUR_STEPS', () => {
  it('has at least 8 steps with unique, non-empty ids', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(8)
    const ids = TOUR_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })

  it('keeps every title to 5 words and every body to 40', () => {
    for (const step of TOUR_STEPS) {
      expect(words(step.title), step.id).toBeLessThanOrEqual(5)
      expect(words(step.body), step.id).toBeLessThanOrEqual(40)
      expect(step.body.length, step.id).toBeGreaterThan(0)
    }
  })

  it('names only targets that exist in the rendered top bar', () => {
    render(createElement(DockProvider, null, createElement(TopBar, { current: 'book' })))
    const targets = TOUR_STEPS.filter((s) => s.target !== undefined)
    expect(targets.length).toBeGreaterThan(0)
    for (const step of targets) expect(document.querySelector(step.target!), step.id).not.toBeNull()
  })

  it('has a step for every tab and for the tools', () => {
    const targets = TOUR_STEPS.map((s) => s.target)
    for (const href of ['/', '/practice', '/history', '/days', '/progress', '/journal']) {
      expect(targets, href).toContain(`.topbar__tabs a[href="${href}"]`)
    }
    expect(targets).toContain('.topbar__tools')
  })

  it('never scolds or advises', () => {
    const text = TOUR_STEPS.map((s) => `${s.title} ${s.body}`).join(' ').toLowerCase()
    for (const phrase of ['you should', 'make sure', 'must', 'always', 'never', "don't", 'do not', 'remember to']) {
      expect(text, phrase).not.toContain(phrase)
    }
  })
})
