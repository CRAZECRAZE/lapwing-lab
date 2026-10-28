// Preact defers passive effects and unmount cleanups until after the next frame (a ~35 ms timer, see
// preact/hooks afterNextFrame). One queued as a jsdom file ends fires after Vitest deleted the jsdom globals, so
// code such as removeEventListener() in a cleanup threw an uncaught ReferenceError (exit code 1). Draining the
// queue inside `act` (it swaps in a synchronous options.requestAnimationFrame) runs it before teardown.
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { useEffect } from 'preact/hooks'
import { afterAll } from 'vitest'

if (typeof document !== 'undefined') {
  // Mounting and unmounting a probe inside act schedules a flush; the queues are module-wide, so it drains every pending effect.
  const Probe = (): null => {
    useEffect(() => {}, [])
    return null
  }
  afterAll(async () => {
    const root = document.createElement('div')
    await act(() => render(h(Probe, null), root))
    await act(() => render(null, root))
  })
}
