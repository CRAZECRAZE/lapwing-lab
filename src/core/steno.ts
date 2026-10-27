export const SLOTS = [
  '#', 'S-', 'T-', 'K-', 'P-', 'W-', 'H-', 'R-', 'A-', 'O-', '*',
  '-E', '-U', '-F', '-R', '-P', '-B', '-L', '-G', '-T', '-S', '-D', '-Z',
] as const

export type Slot = typeof SLOTS[number]
/** Bit i is set when SLOTS[i] is pressed. */
export type SlotMask = number

const FIRST_RIGHT = SLOTS.indexOf('-F')
const FIRST_VOWEL = SLOTS.indexOf('A-')
const VOWEL_END = SLOTS.indexOf('-U') // last of A- O- * -E -U

const letterOf = (slot: Slot): string => slot.replace('-', '')

export function slotMask(...slots: Slot[]): SlotMask {
  let mask = 0
  for (const slot of slots) mask |= 1 << SLOTS.indexOf(slot)
  return mask
}

export function maskToSlots(mask: SlotMask): Slot[] {
  return SLOTS.filter((_, i) => mask & (1 << i))
}

export class StenoParseError extends Error {}

export function parseStroke(text: string): SlotMask {
  let mask = 0
  let pointer = 0
  for (const ch of text) {
    if (ch === '-') {
      pointer = Math.max(pointer, FIRST_RIGHT)
      continue
    }
    let i = pointer
    while (i < SLOTS.length && letterOf(SLOTS[i]) !== ch) i++
    if (i === SLOTS.length) {
      throw new StenoParseError(`Invalid stroke ${JSON.stringify(text)}: unexpected ${JSON.stringify(ch)}`)
    }
    mask |= 1 << i
    pointer = i + 1
  }
  if (mask === 0) throw new StenoParseError(`Invalid stroke ${JSON.stringify(text)}: no keys`)
  return mask
}

export function tryParseStroke(text: string): SlotMask | null {
  try {
    return parseStroke(text)
  } catch (e) {
    if (e instanceof StenoParseError) return null
    throw e
  }
}

export function parseOutline(text: string): SlotMask[] {
  return text.split('/').map(parseStroke)
}

export function formatStroke(mask: SlotMask): string {
  const pressed = (i: number): boolean => (mask & (1 << i)) !== 0
  const range = (from: number, to: number): number[] =>
    Array.from({ length: to - from + 1 }, (_, k) => from + k)
  const hasRight = range(FIRST_RIGHT, SLOTS.length - 1).some(pressed)
  const hasVowel = range(FIRST_VOWEL, VOWEL_END).some(pressed)
  let needHyphen = hasRight && !hasVowel
  let out = ''
  for (let i = 0; i < SLOTS.length; i++) {
    if (!pressed(i)) continue
    if (needHyphen && i >= FIRST_RIGHT) {
      out += '-'
      needHyphen = false
    }
    out += letterOf(SLOTS[i])
  }
  return out
}
