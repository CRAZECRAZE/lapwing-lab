import type { JSX } from 'preact'
import { isPlainClick, navigate } from '../router.ts'
import type { Tab } from '../router.ts'
import { useDockOptional } from '../state/dock.tsx'
import type { DockTool } from '../state/dock.tsx'
import { useTourOptional } from '../state/tour.tsx'

const TABS: ReadonlyArray<{ tab: Tab; label: string; href: string }> = [
  { tab: 'book', label: 'Book', href: '/' },
  { tab: 'practice', label: 'Practice', href: '/practice' },
  { tab: 'history', label: 'History', href: '/history' },
  { tab: 'days', label: 'Days', href: '/days' },
  { tab: 'progress', label: 'Progress', href: '/progress' },
  { tab: 'journal', label: 'Journal', href: '/journal' },
]

const TOOLS: ReadonlyArray<{ tool: DockTool; label: string; key: string }> = [
  { tool: 'lookup', label: 'Lookup', key: '/' },
  { tool: 'chart', label: 'Key chart', key: 'K' },
  { tool: 'briefs', label: 'Briefs', key: 'B' },
  { tool: 'notes', label: 'Notes', key: 'N' },
]

export function TopBar({ current }: { current: Tab }): JSX.Element {
  // Without a DockProvider (a bare TopBar) the tools are simply left out.
  const dock = useDockOptional()
  // Likewise the Tour button: it needs a TourProvider.
  const tour = useTourOptional()
  const onClick = (e: MouseEvent): void => {
    if (!isPlainClick(e)) return
    e.preventDefault()
    navigate((e.currentTarget as HTMLAnchorElement).getAttribute('href')!)
  }

  return (
    <nav class="topbar" aria-label="Sections">
      <ul class="topbar__tabs">
        {TABS.map(({ tab, label, href }) => (
          <li key={tab}>
            <a href={href} aria-current={tab === current ? 'page' : undefined} onClick={onClick}>
              {label}
            </a>
          </li>
        ))}
      </ul>
      {(dock || tour) && (
        <div class="topbar__tools" role="group" aria-label="Tools">
          {dock &&
            TOOLS.map(({ tool, label, key }) => (
              <button
                key={tool}
                type="button"
                class="topbar__tool"
                aria-label={label}
                aria-pressed={dock.tool === tool}
                aria-keyshortcuts={key === '/' ? '/ Alt+/' : `${key} Alt+${key}`}
                title={`${label} (${key} — Alt+${key} while drilling)`}
                onClick={() => dock.toggle(tool)}
              >
                <span class="topbar__tool-label">{label}</span>
                <kbd class="topbar__key" aria-hidden="true">
                  {key}
                </kbd>
              </button>
            ))}
          {tour && (
            // No key chip: the browser may keep Ctrl+Shift+T for itself, so the button is the way in that always works.
            <button
              type="button"
              class="topbar__tool"
              aria-keyshortcuts="Control+Shift+T"
              title={tour.disabled ? 'Quick tour (not during a run)' : 'Quick tour (Ctrl+Shift+T)'}
              disabled={tour.disabled}
              onClick={() => tour.start()}
            >
              Tour
            </button>
          )}
        </div>
      )}
    </nav>
  )
}
