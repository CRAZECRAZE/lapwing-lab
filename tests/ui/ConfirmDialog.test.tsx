// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../../src/ui/ConfirmDialog.tsx'

afterEach(cleanup)

const onConfirm = vi.fn<() => void>()
const onCancel = vi.fn<() => void>()

function show(busy = false) {
  onConfirm.mockReset()
  onCancel.mockReset()
  return render(
    <ConfirmDialog
      title="Move on anyway?"
      message="Mark Chapter 5 as done without clearing it? You can undo this later."
      confirmLabel="Move on anyway"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )
}

const dialog = (): HTMLElement => screen.getByRole('alertdialog')
const backdrop = (): HTMLElement => document.querySelector('.confirm-dialog') as HTMLElement
const cancel = (): HTMLButtonElement => screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement
const confirm = (): HTMLButtonElement => screen.getByRole('button', { name: 'Move on anyway' }) as HTMLButtonElement

describe('ConfirmDialog', () => {
  it('is a modal alertdialog named by its title and described by its message', () => {
    show()
    const box = dialog()
    expect(box.getAttribute('aria-modal')).toBe('true')
    const title = document.getElementById(box.getAttribute('aria-labelledby')!)
    const message = document.getElementById(box.getAttribute('aria-describedby')!)
    expect(title?.textContent).toBe('Move on anyway?')
    expect(message?.textContent).toBe('Mark Chapter 5 as done without clearing it? You can undo this later.')
    expect(screen.getByRole('alertdialog', { name: 'Move on anyway?' })).toBe(box)
    expect(box.contains(cancel())).toBe(true)
    expect(box.contains(confirm())).toBe(true)
  })

  it('takes a cancel label', () => {
    render(<ConfirmDialog title="T" message="M" confirmLabel="Yes" cancelLabel="Keep it" onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('puts the focus on Cancel when it opens', () => {
    show()
    expect(document.activeElement).toBe(cancel())
  })

  it('cancels on Esc and writes nothing', () => {
    show()
    fireEvent.keyDown(cancel(), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not let Esc reach anything outside it', () => {
    const outer = vi.fn()
    onCancel.mockReset()
    render(
      <div onKeyDown={outer}>
        <ConfirmDialog title="T" message="M" confirmLabel="Yes" onConfirm={onConfirm} onCancel={onCancel} />
      </div>,
    )
    fireEvent.keyDown(cancel(), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('cancels on a click on the backdrop, but not on a click inside the panel', () => {
    show()
    fireEvent.click(dialog())
    fireEvent.click(document.getElementById(dialog().getAttribute('aria-describedby')!)!)
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(backdrop())
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps Tab inside the dialog, wrapping between its two buttons both ways', () => {
    show()
    expect(document.activeElement).toBe(cancel())
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(confirm())
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(cancel())
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm())
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel())
  })

  it('brings Tab back inside when the focus is on the panel itself', () => {
    show()
    dialog().focus()
    fireEvent.keyDown(dialog(), { key: 'Tab' })
    expect(document.activeElement).toBe(cancel())
  })

  it('calls onConfirm once per click', () => {
    show()
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('while busy, disables both buttons, ignores Esc and the backdrop, and keeps the focus inside', () => {
    show(true)
    expect(confirm().disabled).toBe(true)
    expect(cancel().disabled).toBe(true)
    fireEvent.click(confirm())
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    fireEvent.click(backdrop())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(dialog().contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(dialog().contains(document.activeElement)).toBe(true)
  })

  it('moves the focus off Cancel onto the panel when it turns busy, and back to Cancel after', () => {
    const view = show()
    expect(document.activeElement).toBe(cancel())
    view.rerender(<ConfirmDialog title="T" message="M" confirmLabel="Move on anyway" busy onConfirm={onConfirm} onCancel={onCancel} />)
    expect(document.activeElement).toBe(dialog())
    view.rerender(<ConfirmDialog title="T" message="M" confirmLabel="Move on anyway" onConfirm={onConfirm} onCancel={onCancel} />)
    expect(document.activeElement).toBe(cancel())
  })
})

describe('ConfirmDialog focus return', () => {
  function Opener(): JSX.Element {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          Open it
        </button>
        {open && <ConfirmDialog title="Sure?" message="M" confirmLabel="Yes" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />}
      </div>
    )
  }

  it('gives the focus back to the element that opened it when it closes', () => {
    render(<Opener />)
    const opener = screen.getByRole('button', { name: 'Open it' })
    opener.focus()
    fireEvent.click(opener)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(opener)

    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})
