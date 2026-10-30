/** The routine page, where a step opened from a routine leads back to. */
export const ROUTINE_HREF = '/practice/routine'

/** Where a practice page leads back to: the routine when it was opened from one (`?from=routine`), else `href`. */
export function backTarget(href: string, label: string): { href: string; label: string } {
  if (new URLSearchParams(location.search).get('from') === 'routine')
    return { href: ROUTINE_HREF, label: 'Back to routine' }
  return { href, label }
}
