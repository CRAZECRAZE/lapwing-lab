// mdBook-style heading ids: lowercase, letters/digits/_/- kept, whitespace becomes "-", the rest dropped.
export function slugify(heading: string): string {
  let id = ''
  for (const ch of heading.trim()) {
    if (/\s/u.test(ch)) id += '-'
    else if (/[\p{L}\p{N}_-]/u.test(ch)) id += ch.toLowerCase()
  }
  return id
}

export function makeSlugger(): (heading: string) => string {
  const seen = new Map<string, number>()
  return (heading) => {
    const base = slugify(heading)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  }
}
