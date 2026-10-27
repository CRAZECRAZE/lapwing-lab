import type { JSX } from 'preact'
import { useId, useLayoutEffect, useRef } from 'preact/hooks'
import './confirmdialog.css'

export type ConfirmDialogProps = {
  title: string
  message: string
  confirmLabel: string
  /** Defaults to `Cancel`. */
  cancelLabel?: string
  /** A write is in flight: both buttons are disabled, and Esc and the backdrop do nothing. */
  busy?: boolean
  onConfirm(): void
  onCancel(): void
}

/**
 * An "Are you sure?" modal, rendered inline by whoever owns the button: a backdrop over the whole viewport and a
 * small panel. The focus starts on Cancel (the safe choice), Tab stays inside, Esc or a click outside cancels, and
 * the focus goes back to whatever had it before once the dialog is gone.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)

  // Layout effects so the focus moves, and comes back, in the same commit that opens or closes the dialog.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancel.current?.focus()
    return () => {
      if (opener && opener.isConnected) opener.focus()
    }
  }, [])

  // A disabled button drops the focus, which would let Tab and Esc escape: hold it on the panel while busy.
  useLayoutEffect(() => {
    const box = panel.current
    if (!box) return
    const active = document.activeElement
    if (busy) {
      if (active === document.body || active === null || box.contains(active)) box.focus()
    } else if (active === box) {
      cancel.current?.focus()
    }
  }, [busy])

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (!busy) onCancel()
      return
    }
    if (e.key !== 'Tab') return
    e.preventDefault()
    const buttons = [cancel.current, confirm.current].filter((b): b is HTMLButtonElement => b !== null && !b.disabled)
    if (buttons.length === 0) {
      panel.current?.focus()
      return
    }
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const step = e.shiftKey ? -1 : 1
    const next = at === -1 ? (e.shiftKey ? buttons.length - 1 : 0) : (at + step + buttons.length) % buttons.length
    buttons[next].focus()
  }

  return (
    <div
      class="confirm-dialog"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div
        ref={panel}
        class="confirm-dialog__panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-message`}
        tabIndex={-1}
      >
        <h2 id={`${id}-title`} class="confirm-dialog__title">
          {title}
        </h2>
        <p id={`${id}-message`} class="confirm-dialog__message">
          {message}
        </p>
        <div class="confirm-dialog__actions">
          <button ref={cancel} type="button" class="stage0-button" disabled={busy} onClick={() => !busy && onCancel()}>
            {cancelLabel}
          </button>
          <button
            ref={confirm}
            type="button"
            class="stage0-button confirm-dialog__confirm"
            disabled={busy}
            onClick={() => !busy && onConfirm()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
