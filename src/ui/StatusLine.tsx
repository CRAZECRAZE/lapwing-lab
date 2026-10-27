import type { JSX } from 'preact'
import { useUni } from '../state/uni-context.tsx'

export function StatusLine(): JSX.Element {
  const { available, connected, reason, connect } = useUni()
  return (
    <footer class="status" aria-label="Device status">
      {!available && (
        <p class="status__device">
          <span class="status__dot" aria-hidden="true">○</span> Connecting a Uni needs a Chromium-based browser (Chrome, Edge,
          Brave). Reading the book works anywhere.
        </p>
      )}
      {available && connected && (
        <p class="status__device status__device--on">
          <span class="status__dot" aria-hidden="true">●</span> Uni v4 connected
        </p>
      )}
      {available && !connected && (
        <p class="status__device">
          <span class="status__dot" aria-hidden="true">○</span> Not connected
          <button type="button" class="status__connect" onClick={() => void connect()}>
            Connect
          </button>
          {reason && <span class="status__reason" role="status">{reason}</span>}
        </p>
      )}
      <p class="status__note">Plover output: turn it off while practicing</p>
    </footer>
  )
}
