// The pasted text of the real-text page, kept for the run that follows it. It lives only in memory:
// a reload forgets it, and nothing is ever written to disk for a text that was not saved.
let pasted = ''

export function setPasted(text: string): void {
  pasted = text
}

export function getPasted(): string {
  return pasted
}
