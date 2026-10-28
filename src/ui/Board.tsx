import type { JSX } from 'preact'
import { UNI_GRID, leverSlot } from '../core/uni.ts'
import type { Lever } from '../core/uni.ts'
import { SLOTS, slotMask } from '../core/steno.ts'
import type { Slot, SlotMask } from '../core/steno.ts'
import './board.css'

export type BoardProps = {
  size?: number // key edge in px, default 18
  target?: SlotMask // slots drawn lit as "needed"
  pressed?: readonly Lever[] // levers physically down
  diff?: { missing: SlotMask; extra: SlotMask } // mistake overlay
  heat?: Partial<Record<Slot, number>> // 0..1 per slot: how hot a key is drawn (red), e.g. how often it is missed
}

const VOWELS: readonly Lever[] = ['A-', 'O-', '-E', '-U']
const RIGHT_NUMBER: Lever = '#2'

function hand(lever: Lever): 'left' | 'vowel' | 'right' {
  if (VOWELS.includes(lever)) return 'vowel'
  if (lever === RIGHT_NUMBER) return 'right'
  const slot = leverSlot(lever)
  return SLOTS.indexOf(slot) < SLOTS.indexOf('-F') ? 'left' : 'right'
}

function label(lever: Lever): string {
  const slot = leverSlot(lever)
  return hand(lever) === 'right' && slot !== '#' ? slot : slot.replace('-', '')
}

/** A heat rounded to 2 decimals and held to 1; 0 when it is not a positive number (the key is not shaded). */
function heatOf(heat: BoardProps['heat'], lever: Lever): number {
  const value = heat?.[leverSlot(lever)]
  if (value === undefined || !(value > 0)) return 0
  return Math.round(Math.min(value, 1) * 100) / 100
}

export function Board({ size = 18, target = 0, pressed = [], diff, heat }: BoardProps): JSX.Element {
  const lit = (mask: SlotMask, lever: Lever): boolean =>
    (mask & slotMask(leverSlot(lever))) !== 0

  return (
    <div
      class="board"
      role="img"
      aria-label="Uni v4 board"
      style={{ '--s': `${size}px` }}
    >
      {UNI_GRID.flatMap((row, r) =>
        row.map((lever, c) => {
          const gap = c === 5 ? ' board__cell--gap' : ''
          if (lever === null) return <div key={`${r}-${c}`} class={`board__spacer${gap}`} />
          const classes = ['key', `key--${hand(lever)}`]
          if (lit(target, lever)) classes.push('key--target')
          if (pressed.includes(lever)) classes.push('key--down')
          if (diff && lit(diff.missing, lever)) classes.push('key--missing')
          if (diff && lit(diff.extra, lever)) classes.push('key--extra')
          const hot = heatOf(heat, lever)
          if (hot > 0) classes.push('key--heat')
          return (
            <div
              key={lever}
              class={classes.join(' ') + gap}
              data-lever={lever}
              aria-hidden="true"
              style={hot > 0 ? { '--heat': String(hot) } : undefined}
            >
              {label(lever)}
            </div>
          )
        }),
      )}
    </div>
  )
}
