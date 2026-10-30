// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TEXT_CHARS } from '../../src/core/realtext.ts'
import { getPasted, setPasted } from '../../src/state/pastedtext.ts'
import { Text } from '../../src/ui/Text.tsx'
import { __resetDictionaryCacheForTests } from '../../src/ui/tools/Lookup.tsx'
import { stubContent } from './helpers/practice-rig.tsx'

vi.mock('../../src/api.ts', () => ({ listTexts: vi.fn(), putText: vi.fn(), deleteText: vi.fn() }))
const api = await import('../../src/api.ts')
const listTexts = vi.mocked(api.listTexts)
const putText = vi.mocked(api.putText)
const deleteText = vi.mocked(api.deleteText)

const DICTIONARY = {
  commit: 'x',
  letters: {},
  cards: [
    { t: 'sap', r: [{ o: 'SAP' }] },
    { t: 'tap', r: [{ o: 'TAP' }] },
  ],
}
const CONTENT = { '/content/dictionary.json': DICTIONARY }
const SAVED = [
  { id: 'moby', name: 'Moby Dick', chars: 1200 },
  { id: 'my-text', name: 'My text', chars: 40 },
]

beforeEach(() => {
  history.replaceState(null, '', '/practice/text')
  __resetDictionaryCacheForTests()
  stubContent(CONTENT)
  setPasted('')
  listTexts.mockReset().mockResolvedValue(SAVED)
  putText.mockReset().mockImplementation(async (id, body) => ({ id, ...body }))
  deleteText.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const textarea = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Text' })
const nameField = (): HTMLInputElement => screen.getByRole('textbox', { name: 'Name' })
const enter = (text: string): void => {
  fireEvent.input(textarea(), { target: { value: text } })
}

/** Mounts the page and waits for the dictionary, so Check is ready. */
async function mount(): Promise<void> {
  render(<Text />)
  await waitFor(() => expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(false))
}

async function check(text: string): Promise<void> {
  await mount()
  enter(text)
  fireEvent.click(screen.getByRole('button', { name: 'Check' }))
}

describe('Text page: checking', () => {
  it('has a text box, a name field and Check', async () => {
    await mount()
    expect(textarea()).toBeTruthy()
    expect(nameField()).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('shows the coverage line, the skipped count and the missing words with counts', async () => {
    await check('sap tap xyzzy foo xyzzy 42 !!')
    expect(await screen.findByText('2 of 5 words can be stroked (40%)')).toBeTruthy()
    expect(screen.getByText('Numbers and symbols skipped: 2')).toBeTruthy()
    const missing = [...document.querySelectorAll('.text__missing li')]
    expect(missing.map((li) => li.textContent)).toEqual(['xyzzy ×2', 'foo ×1'])
  })

  it('lists only the first 20 missing words and says how many more', async () => {
    const odd = Array.from({ length: 25 }, (_, i) => `qq${String.fromCharCode(97 + (i % 26))}x`).join(' ')
    await check(`sap ${odd}`)
    await screen.findByText('1 of 26 words can be stroked (4%)')
    expect(document.querySelectorAll('.text__missing li')).toHaveLength(20)
    expect(screen.getByText('and 5 more')).toBeTruthy()
  })

  it('says there is no text, and offers no Start, for empty or blank text', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByRole('status').textContent).toMatch(/no text/i)
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    enter('  \n\t ')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByRole('status').textContent).toMatch(/no text/i)
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('says there are no words to practise, and offers no Start, for text with no words', async () => {
    await check('42 !!! 3.14')
    expect(await screen.findByText(/no words to practise/i)).toBeTruthy()
    expect(screen.queryByText(/can be stroked/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('shows the coverage but no Start or Save when no word can be stroked', async () => {
    await check('xyzzy foo')
    expect(await screen.findByText('0 of 2 words can be stroked (0%)')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('refuses text over the limit with a message, and sends and opens nothing', async () => {
    const push = vi.spyOn(history, 'pushState')
    await check('a'.repeat(MAX_TEXT_CHARS + 1))
    expect(putText).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(location.pathname).toBe('/practice/text')
    expect(getPasted()).toBe('')
    expect(screen.getByRole('alert').textContent).toMatch(/200,000/)
    expect(screen.queryByText(/can be stroked/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('accepts text of exactly the limit', async () => {
    await check(`${'sap '.repeat(MAX_TEXT_CHARS / 4 - 1)}tap`.padEnd(MAX_TEXT_CHARS, ' '))
    expect(await screen.findByText(/words can be stroked \(100%\)/)).toBeTruthy()
  })

  it('drops a result the text no longer matches', async () => {
    await check('sap tap')
    await screen.findByText('2 of 2 words can be stroked (100%)')
    enter('sap tap tap')
    expect(screen.queryByText(/can be stroked/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('shows a calm error when the dictionary will not load, and Try again reloads it', async () => {
    stubContent({})
    render(<Text />)
    expect(await screen.findByText(/Couldn't load the dictionary/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true)
    stubContent(CONTENT)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(false),
    )
    expect(screen.queryByText(/Couldn't load the dictionary/)).toBeNull()
  })
})

describe('Text page: Start and Save', () => {
  it('Start keeps the pasted text and opens part 1', async () => {
    await check('sap tap xyzzy')
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    expect(getPasted()).toBe('sap tap xyzzy')
    expect(location.pathname).toBe('/practice/text/run/pasted/1')
  })

  it('Save needs a name of 1 to 60 characters', async () => {
    await check('sap tap')
    const save = (await screen.findByRole('button', { name: 'Save' })) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.input(nameField(), { target: { value: '   ' } })
    expect(save.disabled).toBe(true)
    fireEvent.input(nameField(), { target: { value: 'x'.repeat(61) } })
    expect(save.disabled).toBe(true)
    fireEvent.input(nameField(), { target: { value: 'x'.repeat(60) } })
    expect(save.disabled).toBe(false)
    expect(putText).not.toHaveBeenCalled()
  })

  it('Save stores the text under an id made from the name, avoiding taken ids, and lists it', async () => {
    await check('sap tap')
    await screen.findByText('2 of 2 words can be stroked (100%)')
    await waitFor(() => expect(screen.getByRole('link', { name: 'My text' })).toBeTruthy())
    fireEvent.input(nameField(), { target: { value: ' My text ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(putText).toHaveBeenCalledWith('my-text-2', { name: 'My text', text: 'sap tap' }))
    const list = screen.getByRole('list', { name: 'Saved texts' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3))
    const links = within(list).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toContain('/practice/text/run/my-text-2/1')
  })

  it.each(['Pasted', 'pasted', ' PASTED '])('never saves a text named %j under the id pasted', async (name) => {
    await check('sap tap')
    await screen.findByRole('link', { name: 'Moby Dick' })
    fireEvent.input(nameField(), { target: { value: name } })
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(putText).toHaveBeenCalledWith('pasted-2', { name: name.trim(), text: 'sap tap' }))
    expect(putText.mock.calls.map((c) => c[0])).not.toContain('pasted')
  })

  it('says why Save is disabled: no name, a name that is too long, a list still loading or failed', async () => {
    let arrive!: (v: typeof SAVED) => void
    listTexts.mockReturnValueOnce(new Promise((resolve) => (arrive = resolve)))
    await check('sap tap')
    await screen.findByText('2 of 2 words can be stroked (100%)')
    fireEvent.input(nameField(), { target: { value: 'Mine' } })
    expect(screen.getByText('Waiting for your saved texts to load.')).toBeTruthy()
    await act(async () => arrive(SAVED))
    expect(screen.queryByText('Waiting for your saved texts to load.')).toBeNull()
    expect(screen.queryByText(/Add a name/)).toBeNull()
    fireEvent.input(nameField(), { target: { value: '  ' } })
    expect(screen.getByText('Add a name to save it.')).toBeTruthy()
    fireEvent.input(nameField(), { target: { value: 'x'.repeat(61) } })
    expect(screen.queryByText('Add a name to save it.')).toBeNull()
    expect(screen.getByText('Names can be up to 60 characters.')).toBeTruthy()
    fireEvent.input(nameField(), { target: { value: 'ok' } })
    expect(screen.queryByText(/Names can be up to|Add a name/)).toBeNull()
  })

  it('says why Save is not available when the saved texts could not be loaded', async () => {
    listTexts.mockRejectedValue(new Error('offline'))
    await check('sap tap')
    fireEvent.input(nameField(), { target: { value: 'Mine' } })
    expect(await screen.findByText("Saving isn't available while your saved texts can't be loaded.")).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says so calmly when the save fails, and keeps the text', async () => {
    putText.mockRejectedValue(new Error('offline'))
    await check('sap tap')
    fireEvent.input(nameField(), { target: { value: 'Mine' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't save the text/)
    expect(textarea().value).toBe('sap tap')
  })

  it('does not offer Save once 50 texts are saved', async () => {
    listTexts.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ id: `t-${i}`, name: `T ${i}`, chars: 5 })))
    await check('sap tap')
    fireEvent.input(nameField(), { target: { value: 'Mine' } })
    await screen.findByText(/50 saved texts/)
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Text page: saved texts', () => {
  it('lists the saved texts with links to part 1, and a plain click navigates', async () => {
    await mount()
    const link = await screen.findByRole('link', { name: 'Moby Dick' })
    expect(link.getAttribute('href')).toBe('/practice/text/run/moby/1')
    expect(fireEvent.click(link)).toBe(false)
    expect(location.pathname).toBe('/practice/text/run/moby/1')
  })

  it('says so when nothing is saved', async () => {
    listTexts.mockResolvedValue([])
    await mount()
    expect(await screen.findByText('No saved texts yet.')).toBeTruthy()
  })

  it('deletes only after the confirmation', async () => {
    await mount()
    await screen.findByRole('link', { name: 'Moby Dick' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Moby Dick' }))
    const dialog = screen.getByRole('alertdialog')
    expect(deleteText).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(deleteText).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Moby Dick' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Moby Dick' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteText).toHaveBeenCalledWith('moby'))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Moby Dick' })).toBeNull())
    expect(screen.getByRole('link', { name: 'My text' })).toBeTruthy()
  })

  it('keeps the row and says so calmly when a delete fails', async () => {
    deleteText.mockRejectedValue(new Error('offline'))
    await mount()
    await screen.findByRole('link', { name: 'Moby Dick' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Moby Dick' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't delete/)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('link', { name: 'Moby Dick' })).toBeTruthy()
  })

  it('drops the delete-failure message when another delete starts', async () => {
    deleteText.mockRejectedValue(new Error('offline'))
    await mount()
    await screen.findByRole('link', { name: 'Moby Dick' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Moby Dick' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await screen.findByText(/Couldn't delete/)
    fireEvent.click(screen.getByRole('button', { name: 'Delete My text' }))
    expect(screen.queryByText(/Couldn't delete/)).toBeNull()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('shows a calm error when the list will not load, and Try again reloads it', async () => {
    listTexts.mockRejectedValueOnce(new Error('offline'))
    await mount()
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't load your saved texts/)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Moby Dick' })).toBeTruthy()
  })
})
