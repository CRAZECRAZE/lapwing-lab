import { createContext } from 'preact'
import type { ComponentChildren, JSX } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Lever, RawStroke } from '../core/uni.ts'
import { UniLink } from '../hid/uni-link.ts'
import type { HidLike } from '../hid/uni-link.ts'

export type UniState = {
  /** WebHID is present in this browser. */
  available: boolean
  connected: boolean
  /** Why the last attach failed; null when it has not, or after a clean (dis)connect. */
  reason: string | null
  /** Levers physically down right now. */
  pressed: readonly Lever[]
  /** Shows the browser's device picker; call it from a click handler. */
  connect(): Promise<void>
  /** Subscribes to finished strokes; returns the unsubscribe function. */
  onStroke(cb: (stroke: RawStroke) => void): () => void
}

const INERT: UniState = {
  available: false,
  connected: false,
  reason: null,
  pressed: [],
  connect: async () => {},
  onStroke: () => () => {},
}

const UniContext = createContext<UniState>(INERT)

export function useUni(): UniState {
  return useContext(UniContext)
}

const browserHid = (): HidLike | null =>
  (typeof navigator === 'undefined' ? undefined : (navigator as { hid?: HidLike }).hid) ?? null

/** `hid` defaults to `navigator.hid`; `null` means WebHID is unavailable. */
export function UniProvider({ hid, children }: { hid?: HidLike | null; children: ComponentChildren }): JSX.Element {
  const device = hid === undefined ? browserHid() : hid
  const [connected, setConnected] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [pressed, setPressed] = useState<readonly Lever[]>([])
  const link = useRef<UniLink | null>(null)
  const subscribers = useRef(new Set<(stroke: RawStroke) => void>())

  useEffect(() => {
    if (!device) return
    let live = true
    const uni = new UniLink(device, {
      onSnapshot: (levers) => live && setPressed(levers),
      onStroke: (stroke) => live && [...subscribers.current].forEach((cb) => cb(stroke)),
      onStatus: (status) => {
        if (!live) return
        setConnected(status.state === 'connected')
        setReason(status.reason ?? null)
        if (status.state === 'disconnected') setPressed([])
      },
    })
    link.current = uni
    void uni.autoConnect()
    return () => {
      live = false
      link.current = null
      void uni.close()
    }
  }, [device])

  const connect = useCallback(async () => {
    setReason(null)
    await link.current?.request()
  }, [])

  const onStroke = useCallback((cb: (stroke: RawStroke) => void) => {
    subscribers.current.add(cb)
    return () => void subscribers.current.delete(cb)
  }, [])

  const value = useMemo<UniState>(
    () => ({ available: device !== null, connected, reason, pressed, connect, onStroke }),
    [device, connected, reason, pressed, connect, onStroke],
  )
  return <UniContext.Provider value={value}>{children}</UniContext.Provider>
}
