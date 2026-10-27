import type { JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { useDock } from '../state/dock.tsx'
import type { DockTool } from '../state/dock.tsx'
import { KeyChart } from './tools/KeyChart.tsx'
import { Lookup } from './tools/Lookup.tsx'
import './dock.css'

export type DockToolView = { title: string; Body: () => JSX.Element }

const Soon = (): JSX.Element => <p class="dock-drawer__soon">Coming in this milestone.</p>

/** The tools' titles and bodies; each tool's own task replaces its placeholder body here. */
export const TOOLS: Readonly<Record<DockTool, DockToolView>> = {
  lookup: { title: 'Lookup', Body: Lookup },
  chart: { title: 'Key chart', Body: KeyChart },
  briefs: { title: 'Briefs so far', Body: Soon },
  notes: { title: 'My notes', Body: Soon },
}

/**
 * The open tool as a drawer over the right-hand side of the page, below the top bar. Non-modal: Tab moves on to the
 * page, and Esc (handled by the DockProvider) closes it. The focus moves into the drawer when a tool opens (or
 * another one replaces it) and goes back to whatever had it before once the drawer closes.
 */
export function DockHost({ tools = TOOLS }: { tools?: Readonly<Record<DockTool, DockToolView>> }): JSX.Element | null {
  const { tool, close } = useDock()
  const drawer = useRef<HTMLDivElement>(null)
  /** The element focused before the drawer opened; kept while one tool replaces another. */
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)

  // A layout effect, so the focus moves in the same commit that opens, switches or closes the drawer.
  useLayoutEffect(() => {
    if (tool === null) {
      if (!wasOpen.current) return
      wasOpen.current = false
      const back = opener.current
      opener.current = null
      if (back?.isConnected) back.focus()
      return
    }
    if (!wasOpen.current) {
      wasOpen.current = true
      const active = document.activeElement
      opener.current = active instanceof HTMLElement ? active : null
    }
    const box = drawer.current
    if (!box) return
    const target = box.querySelector<HTMLElement>('.dock-drawer__body [data-autofocus]') ?? box
    target.focus()
  }, [tool])

  if (tool === null) return null
  const { title, Body } = tools[tool]
  return (
    // A div, not an aside: ARIA in HTML does not allow the dialog role on an aside.
    <div ref={drawer} class="dock-drawer" data-dock role="dialog" aria-label={title} tabIndex={-1}>
      <header class="dock-drawer__head">
        <h2 class="dock-drawer__title">{title}</h2>
        <button type="button" class="dock-drawer__close" onClick={close}>
          Close
        </button>
      </header>
      <div class="dock-drawer__body">
        <Body key={tool} />
      </div>
    </div>
  )
}
