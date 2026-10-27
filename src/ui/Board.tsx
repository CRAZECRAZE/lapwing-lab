import type { JSX } from 'preact'
import { UNI_GRID, leverSlot } from '../core/uni.ts'
import type { Lever } from '../core/uni.ts'
import { SLOTS } from '../core/steno.ts'
import type { SlotMask } from '../core/steno.ts'
import './board.css'

export type BoardProps = {
  size?: number // key edge in px, default 18
  target?: SlotMask // slots drawn lit as "needed"
  pressed?: readonly Lever[] // levers physically down
  diff?: { missing: SlotMask; extra: SlotMask } // mistake overlay
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

export function Board({ size = 18, target = 0, pressed = [], diff }: BoardProps): JSX.Element {
  const lit = (mask: SlotMask, lever: Lever): boolean =>
    (mask & (1 << SLOTS.indexOf(leverSlot(lever)))) !== 0

  return (
    <div
      class="board"
      role="img"
      aria-label="Uni v4 board"
      style={{ '--s': `${size}px` }}
    >
      {UNI_GRID.flatMap((row, r) =>
        row.map((lever, c) => {
          const gap = c === 4 ? ' board__cell--gap' : ''
          if (lever === null) return <div key={`${r}-${c}`} class={`board__spacer${gap}`} />
          const classes = ['key', `key--${hand(lever)}`]
          if (lit(target, lever)) classes.push('key--target')
          if (pressed.includes(lever)) classes.push('key--down')
          if (diff && lit(diff.missing, lever)) classes.push('key--missing')
          if (diff && lit(diff.extra, lever)) classes.push('key--extra')
          return (
            <div key={lever} class={classes.join(' ') + gap} data-lever={lever} aria-hidden="true">
              {label(lever)}
            </div>
          )
        }),
      )}
    </div>
  )
}
