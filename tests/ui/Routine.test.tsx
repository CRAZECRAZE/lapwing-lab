// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localDate } from '../../src/core/days.ts'
import { validateRoutineDoc } from '../../src/core/routine.ts'
import type { RoutineDoc } from '../../src/core/routine.ts'
import type { Progress } from '../../src/state/progress.tsx'
import { RoutinePage } from '../../src/ui/Routine.tsx'
import { DOC, STEPS, TEXTS, progress, testRow } from './helpers/routine-fixtures.ts'

vi.mock('../../src/api.ts', () => ({
  getRoutines: vi.fn(),
  putRoutines: vi.fn(),
  listTests: vi.fn(),
  listTexts: vi.fn(),
}))
const api = await import('../../src/api.ts')
const getRoutines = vi.mocked(api.getRoutines)
const putRoutines = vi.mocked(api.putRoutines)
const listTests = vi.mocked(api.listTests)
const listTexts = vi.mocked(api.listTexts)

const fake = vi.hoisted(() => ({ value: null as Progress | null }))
vi.mock('../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => fake.value ?? actual.useProgress() }
})

const NOW = new Date(2026, 9, 30, 12).getTime()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  history.replaceState(null, '', '/practice/routine')
  fake.value = progress()
  getRoutines.mockReset().mockResolvedValue(structuredClone(DOC))
  putRoutines.mockReset().mockImplementation(async (doc) => doc)
  listTests.mockReset().mockResolvedValue([testRow('section', '5-cvc')])
  listTexts.mockReset().mockResolvedValue(TEXTS)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const step = (text: RegExp | string): HTMLElement => screen.getByText(text).closest('li') as HTMLElement
const savedDoc = (): RoutineDoc => putRoutines.mock.calls.at(-1)![0]

describe('RoutinePage checklist', () => {
  it('shows the active routine with its count, a tick as text, and "Next up" on the first undone step', async () => {
    render(<RoutinePage />)
    expect(await screen.findByText('1 of 4 done today')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Morning' })).toBeTruthy()
    const list = screen.getByRole('list', { name: 'Steps of Morning' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    expect(within(step('Section drill 5-cvc')).getByText('Done')).toBeTruthy()
    expect(within(step('Section drill 5-cvc')).queryByRole('link')).toBeNull()
    const free = step('Free type · Chapter 5 word lists · 25 words')
    expect(within(free).getByText('Next up')).toBeTruthy()
    expect(within(step('Fix-up · words')).queryByText('Next up')).toBeNull()
    expect(within(step('Real text · Moby Dick · part 2')).queryByText('Next up')).toBeNull()
  })

  it('links each undone step to its page, marked as from the routine except the fix-up page', async () => {
    render(<RoutinePage />)
    await screen.findByText('1 of 4 done today')
    const href = (text: string): string | null => within(step(text)).getByRole('link').getAttribute('href')
    expect(href('Free type · Chapter 5 word lists · 25 words')).toBe('/practice/free/ch-5/words-25?from=routine')
    expect(href('Fix-up · words')).toBe('/practice/fixup')
    expect(href('Real text · Moby Dick · part 2')).toBe('/practice/text/run/moby/2?from=routine')
    expect(
      within(step('Free type · Chapter 5 word lists · 25 words')).getByRole('link', { name: /^Start/ }),
    ).toBeTruthy()
  })

  it('asks for the tests of the local date today, and again each time the page is shown', async () => {
    const first = render(<RoutinePage />)
    await screen.findByText('1 of 4 done today')
    expect(listTests).toHaveBeenCalledWith({ date: localDate(NOW), limit: 200 })
    first.unmount()
    listTests.mockResolvedValue([testRow('section', '5-cvc'), testRow('fixup', 'words')])
    render(<RoutinePage />)
    expect(await screen.findByText('2 of 4 done today')).toBeTruthy()
    expect(listTests).toHaveBeenCalledTimes(2)
  })

  it('does not tick unfinished or abandoned tests', async () => {
    listTests.mockResolvedValue([
      testRow('section', '5-cvc', { endedAt: null }),
      testRow('fixup', 'words', { meta: { abandoned: true } }),
    ])
    render(<RoutinePage />)
    expect(await screen.findByText('0 of 4 done today')).toBeTruthy()
  })

  it('shows a step whose target is gone as unavailable, without a link, and never ticks it', async () => {
    getRoutines.mockResolvedValue({
      routines: [
        {
          id: 'm',
          name: 'M',
          steps: [
            { kind: 'text', id: 'gone', part: 1 },
            { kind: 'list', listId: '9-none' },
            { kind: 'free', source: 'ch-9', mode: 'words-25' },
            ...STEPS.slice(2, 3),
          ],
        },
      ],
      active: 'm',
    })
    listTests.mockResolvedValue([
      testRow('text', 'text/gone/1'),
      testRow('section', '9-none'),
      testRow('free', 'ch-9/words-25'),
    ])
    render(<RoutinePage />)
    expect(await screen.findByText('0 of 4 done today')).toBeTruthy()
    const items = within(screen.getByRole('list', { name: 'Steps of M' })).getAllByRole('listitem')
    for (const item of items.slice(0, 3)) {
      expect(within(item).getByText('Unavailable')).toBeTruthy()
      expect(within(item).queryByRole('link')).toBeNull()
      expect(within(item).queryByText('Done')).toBeNull()
    }
    // the unavailable steps are skipped when naming the next one
    expect(within(items[3]).getByText('Next up')).toBeTruthy()
  })

  it("says so calmly when today's tests cannot be read, and shows no count", async () => {
    listTests.mockRejectedValue(new Error('offline'))
    render(<RoutinePage />)
    expect(await screen.findByText(/Couldn't check today's tests/)).toBeTruthy()
    expect(screen.queryByText(/done today/)).toBeNull()
    expect(screen.getByRole('list', { name: 'Steps of Morning' })).toBeTruthy()
  })

  it('has a calm line when the active routine has no steps', async () => {
    getRoutines.mockResolvedValue({ routines: [{ id: 'e', name: 'Empty', steps: [] }], active: 'e' })
    render(<RoutinePage />)
    expect(await screen.findByText('This routine has no steps yet.')).toBeTruthy()
  })

  it('says so, with a New routine button, when there are no routines', async () => {
    getRoutines.mockResolvedValue({ routines: [], active: null })
    render(<RoutinePage />)
    expect(await screen.findByText(/No routines yet/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New routine' })).toBeTruthy()
  })

  it('says so calmly when no routine is active', async () => {
    getRoutines.mockResolvedValue({ ...DOC, active: null })
    render(<RoutinePage />)
    expect(await screen.findByText('No routine is active.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Make Morning active' })).toBeTruthy()
  })

  it('shows a calm error with a retry when the routines do not load', async () => {
    getRoutines.mockRejectedValueOnce(new Error('offline'))
    render(<RoutinePage />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Couldn't load your routines/)
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('1 of 4 done today')).toBeTruthy()
    expect(getRoutines).toHaveBeenCalledTimes(2)
  })
})

describe('RoutinePage planner', () => {
  it('lists the routines, marking the active one in text', async () => {
    render(<RoutinePage />)
    await screen.findByText('1 of 4 done today')
    const planner = screen.getByRole('region', { name: 'Your routines' })
    const rows = within(planner).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Active')).toBeTruthy()
    expect(within(rows[0]).queryByRole('button', { name: /Make .* active/ })).toBeNull()
    expect(within(rows[1]).getByRole('button', { name: 'Make Evening active' })).toBeTruthy()
  })

  it('Make active saves the doc with that routine active', async () => {
    render(<RoutinePage />)
    await screen.findByText('1 of 4 done today')
    fireEvent.click(screen.getByRole('button', { name: 'Make Evening active' }))
    await waitFor(() => expect(putRoutines).toHaveBeenCalledTimes(1))
    expect(savedDoc().active).toBe('evening')
    expect(savedDoc().routines).toHaveLength(2)
    expect(await screen.findByRole('heading', { name: 'Evening' })).toBeTruthy()
  })

  it('deletes only after the confirmation, and deleting the active routine leaves none active', async () => {
    render(<RoutinePage />)
    await screen.findByText('1 of 4 done today')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Morning' }))
    const dialog = screen.getByRole('alertdialog')
    expect(putRoutines).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(putRoutines).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Morning' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(putRoutines).toHaveBeenCalledTimes(1))
    expect(savedDoc()).toEqual({ routines: [DOC.routines[1]], active: null })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByText('No routine is active.')).toBeTruthy()
  })

  it('deleting another routine keeps the active one', async () => {
    render(<RoutinePage />)
    await screen.findByText('1 of 4 done today')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Evening' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(putRoutines).toHaveBeenCalledTimes(1))
    expect(savedDoc()).toEqual({ routines: [DOC.routines[0]], active: 'morning' })
  })

  it('shows a failed save calmly and leaves the routines as they were', async () => {
    // what api.ts rejects with for a non-2xx reply: its message is not for the owner
    putRoutines.mockRejectedValue(
      Object.assign(new Error('PUT /api/routines failed with 500'), { name: 'HttpStatusError' }),
    )
    render(<RoutinePage />)
    await screen.findByText('1 of 4 done today')
    fireEvent.click(screen.getByRole('button', { name: 'Make Evening active' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Couldn't save the routines/)
    expect(alert.textContent).toMatch(/server is still running/)
    expect(alert.textContent).not.toMatch(/failed with 500/)
    expect(screen.getByRole('heading', { name: 'Morning' })).toBeTruthy()
  })

  it('New routine opens the editor; Cancel returns without saving', async () => {
    render(<RoutinePage />)
    await screen.findByText('1 of 4 done today')
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }))
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Morning' })).toBeTruthy()
    expect(putRoutines).not.toHaveBeenCalled()
  })

  it('refuses a ninth routine with a message', async () => {
    getRoutines.mockResolvedValue({
      routines: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, steps: [] })),
      active: null,
    })
    render(<RoutinePage />)
    await screen.findByText('No routine is active.')
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }))
    expect(screen.getByRole('status').textContent).toBe('You can keep up to 8 routines.')
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
  })

  it('Edit opens the editor with that routine, and saving replaces it in place', async () => {
    render(<RoutinePage />)
    await screen.findByText('1 of 4 done today')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Evening' }))
    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    expect(name.value).toBe('Evening')
    fireEvent.input(name, { target: { value: 'Night' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(putRoutines).toHaveBeenCalledTimes(1))
    expect(savedDoc().routines.map((r) => `${r.id}:${r.name}`)).toEqual(['morning:Morning', 'evening:Night'])
    expect(savedDoc().active).toBe('morning')
    expect(() => validateRoutineDoc(savedDoc())).not.toThrow()
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull())
  })

  it('does not make a new routine active when another one is', async () => {
    render(<RoutinePage />)
    await screen.findByText('1 of 4 done today')
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }))
    fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Warm up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(putRoutines).toHaveBeenCalledTimes(1))
    expect(savedDoc().active).toBe('morning')
    expect(savedDoc().routines.map((r) => r.id)).toEqual(['morning', 'evening', 'warm-up'])
  })

  it('keeps the editor open with a calm hint when the save fails on the network', async () => {
    putRoutines.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<RoutinePage />)
    await screen.findByText('1 of 4 done today')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Evening' }))
    fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Night' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/server is still running/)
    expect(alert.textContent).not.toMatch(/fetch/i)
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Night')
  })

  it('keeps a list step of a chapter not yet reached available, with a Start link', async () => {
    getRoutines.mockResolvedValue({
      routines: [{ id: 'm', name: 'M', steps: [{ kind: 'list', listId: '20-far' }] }],
      active: 'm',
    })
    render(<RoutinePage />)
    expect(await screen.findByText('0 of 1 done today')).toBeTruthy()
    const item = step('Section drill 20-far')
    expect(within(item).getByText('Next up')).toBeTruthy()
    expect(within(item).getByRole('link').getAttribute('href')).toBe('/drill/list/20-far?from=routine')
  })

  it('saves a new routine at the end, and makes it active when none is', async () => {
    getRoutines.mockResolvedValue({ routines: [], active: null })
    render(<RoutinePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New routine' }))
    fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Warm up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(putRoutines).toHaveBeenCalledTimes(1))
    expect(savedDoc()).toEqual({ routines: [{ id: 'warm-up', name: 'Warm up', steps: [] }], active: 'warm-up' })
  })
})

describe('RoutinePage while progress loads', () => {
  it('waits for the practice index before naming steps', async () => {
    fake.value = progress({ status: 'loading', index: [] })
    render(<RoutinePage />)
    await waitFor(() => expect(getRoutines).toHaveBeenCalled())
    expect(screen.getByText('Loading…')).toBeTruthy()
  })
})
