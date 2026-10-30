// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_STEPS, validateRoutineDoc } from '../../src/core/routine.ts'
import type { Routine } from '../../src/core/routine.ts'
import type { Progress } from '../../src/state/progress.tsx'
import { RoutineEditor } from '../../src/ui/RoutineEditor.tsx'
import { RoutineInvalid } from '../../src/ui/useRoutines.ts'
import { DOC, TEXTS, progress } from './helpers/routine-fixtures.ts'

vi.mock('../../src/api.ts', () => ({ listTexts: vi.fn() }))
const api = await import('../../src/api.ts')
const listTexts = vi.mocked(api.listTexts)

const fake = vi.hoisted(() => ({ value: null as Progress | null }))
vi.mock('../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => fake.value ?? actual.useProgress() }
})

beforeEach(() => {
  fake.value = progress()
  listTexts.mockReset().mockResolvedValue(TEXTS)
})

afterEach(() => cleanup())

const onSave = vi.fn(async (_routine: Routine) => {})
const onCancel = vi.fn()

function mount(routine: Routine | null = null, routines: Routine[] = []) {
  onSave.mockReset().mockResolvedValue(undefined)
  onCancel.mockReset()
  render(<RoutineEditor routine={routine} routines={routines} onSave={onSave} onCancel={onCancel} />)
}

const name = (value: string): void => {
  fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value } })
}
const kind = (value: string): void => {
  fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value } })
}
const choose = (label: string, value: string): void => {
  fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } })
}
const add = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Add step' }))
}
const stepItems = (): HTMLElement[] => within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
const save = (): HTMLElement => screen.getByRole('button', { name: 'Save' })
const optionValues = (label: string): string[] =>
  within(screen.getByRole('combobox', { name: label }))
    .getAllByRole('option')
    .map((o) => (o as HTMLOptionElement).value)

describe('RoutineEditor name', () => {
  it('disables Save until the name is 1 to 40 characters', () => {
    mount()
    expect((save() as HTMLButtonElement).disabled).toBe(true)
    name('   ')
    expect((save() as HTMLButtonElement).disabled).toBe(true)
    name('Warm up')
    expect((save() as HTMLButtonElement).disabled).toBe(false)
    name('x'.repeat(40))
    expect((save() as HTMLButtonElement).disabled).toBe(false)
    name('x'.repeat(41))
    expect((save() as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('RoutineEditor add a step', () => {
  it('adds a section drill, offering only the lists of chapters reached', async () => {
    mount()
    kind('list')
    expect(optionValues('List')).toEqual(['5-cvc', '5-ops'])
    choose('List', '5-ops')
    add()
    expect(stepItems().map((li) => li.textContent)).toEqual([expect.stringContaining('Section drill 5-ops')])
  })

  it('adds a free-type step from the sources and modes of the Practice tab', () => {
    mount()
    kind('free')
    expect(optionValues('Words from')).toEqual(['pseudo', 'ch-5', 'ch-20'])
    expect(optionValues('Mode')).toEqual(['words-25', 'words-50', 'time-30', 'time-60'])
    choose('Words from', 'ch-5')
    choose('Mode', 'time-30')
    add()
    expect(stepItems()[0].textContent).toContain('Free type · Chapter 5 word lists · 30 seconds')
  })

  it('adds a fix-up step for words or patterns', () => {
    mount()
    kind('fixup')
    choose('Fix-up list', 'patterns')
    add()
    expect(stepItems()[0].textContent).toContain('Fix-up · patterns')
  })

  it('adds a saved text with a part number from 1 to 99', async () => {
    mount()
    kind('text')
    await waitFor(() => expect(optionValues('Saved text')).toEqual(['moby']))
    const part = screen.getByRole('spinbutton', { name: 'Part' }) as HTMLInputElement
    fireEvent.input(part, { target: { value: '0' } })
    expect((screen.getByRole('button', { name: 'Add step' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.input(part, { target: { value: '100' } })
    expect((screen.getByRole('button', { name: 'Add step' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.input(part, { target: { value: '3' } })
    add()
    expect(stepItems()[0].textContent).toContain('Real text · Moby Dick · part 3')
  })

  it('says so calmly when there is no saved text, and when the texts do not load', async () => {
    listTexts.mockResolvedValue([])
    mount()
    kind('text')
    expect(await screen.findByText(/No saved texts yet/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Add step' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    listTexts.mockRejectedValue(new Error('offline'))
    mount()
    kind('text')
    expect(await screen.findByText(/Couldn't load the saved texts/)).toBeTruthy()
  })

  it('refuses the 13th step with a message', () => {
    mount()
    kind('fixup')
    for (let i = 0; i < MAX_STEPS; i++) add()
    expect(stepItems()).toHaveLength(MAX_STEPS)
    add()
    expect(stepItems()).toHaveLength(MAX_STEPS)
    expect(screen.getByRole('status').textContent).toBe(`A routine can have up to ${MAX_STEPS} steps.`)
  })
})

describe('RoutineEditor steps', () => {
  const routine: Routine = {
    id: 'r',
    name: 'R',
    steps: [
      { kind: 'fixup', tab: 'words' },
      { kind: 'list', listId: '5-cvc' },
      { kind: 'fixup', tab: 'patterns' },
    ],
  }
  const order = (): string[] => stepItems().map((li) => li.querySelector('.routine-editor__step-text')!.textContent!)

  it('moves a step up and down, and the ends cannot move outwards', () => {
    mount(routine)
    const first = stepItems()[0]
    const last = stepItems()[2]
    expect((within(first).getByRole('button', { name: /^Move up/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(last).getByRole('button', { name: /^Move down/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(stepItems()[1]).getByRole('button', { name: /^Move up/ }))
    expect(order()).toEqual(['Section drill 5-cvc', 'Fix-up · words', 'Fix-up · patterns'])
    fireEvent.click(within(stepItems()[0]).getByRole('button', { name: /^Move down/ }))
    expect(order()).toEqual(['Fix-up · words', 'Section drill 5-cvc', 'Fix-up · patterns'])
  })

  it('removes a step', () => {
    mount(routine)
    fireEvent.click(within(stepItems()[1]).getByRole('button', { name: /^Remove/ }))
    expect(order()).toEqual(['Fix-up · words', 'Fix-up · patterns'])
  })

  it('keeps a step whose target is gone, marked, and lets it be moved and removed', async () => {
    mount({
      id: 'r',
      name: 'R',
      steps: [
        { kind: 'text', id: 'gone', part: 1 },
        { kind: 'fixup', tab: 'words' },
      ],
    })
    await waitFor(() => expect(within(stepItems()[0]).getByText('Unavailable')).toBeTruthy())
    fireEvent.click(within(stepItems()[0]).getByRole('button', { name: /^Move down/ }))
    expect(order()[1]).toBe('Real text · gone · part 1')
    fireEvent.click(within(stepItems()[1]).getByRole('button', { name: /^Remove/ }))
    expect(stepItems()).toHaveLength(1)
  })
})

describe('RoutineEditor Save and Cancel', () => {
  it('saves a routine that passes the validator, with a new unique id made from the name', async () => {
    mount(null, DOC.routines)
    name('Morning')
    kind('fixup')
    add()
    fireEvent.click(save())
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const saved = onSave.mock.calls[0][0]
    expect(saved).toEqual({ id: 'morning-2', name: 'Morning', steps: [{ kind: 'fixup', tab: 'words' }] })
    expect(() => validateRoutineDoc({ routines: [...DOC.routines, saved], active: null })).not.toThrow()
  })

  it('keeps the id of the routine being edited, and trims the name', async () => {
    mount(DOC.routines[1], DOC.routines)
    name('  Night  ')
    fireEvent.click(save())
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'evening', name: 'Night' })
  })

  it("shows the validator's message calmly and keeps the editor open with its work", async () => {
    mount()
    onSave.mockRejectedValue(new RoutineInvalid('A routine can have at most 12 steps'))
    name('Warm up')
    fireEvent.click(save())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe("Couldn't save the routines. A routine can have at most 12 steps")
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Warm up')
    expect((save() as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows a calm hint, not the raw error text, when the save fails some other way', async () => {
    mount()
    onSave.mockRejectedValue(new TypeError('Failed to fetch'))
    name('Warm up')
    fireEvent.click(save())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      "Couldn't save the routines. Check that the Lapwing Lab server is still running, then try again.",
    )
    expect(alert.textContent).not.toMatch(/fetch/i)
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Warm up')
    expect((save() as HTMLButtonElement).disabled).toBe(false)
  })

  it('Cancel drops the edit and saves nothing', () => {
    mount()
    name('Warm up')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
