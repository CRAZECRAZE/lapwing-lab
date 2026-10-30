export type TourStep = {
  id: string
  title: string
  body: string
  /** A CSS selector for the element to ring; no ring when nothing matches. */
  target?: string
}

const tab = (href: string): string => `.topbar__tabs a[href="${href}"]`

/** The quick tour, in order: one short stop per feature. Titles are up to 5 words, bodies up to 40. */
export const TOUR_STEPS: ReadonlyArray<TourStep> = [
  {
    id: 'welcome',
    title: 'Welcome to Lapwing Lab',
    body:
      'A short look at what is here, one stop per feature. Skip closes it at any point. ' +
      'Ctrl+Shift+T or the Tour button in the top bar brings it back.',
  },
  {
    id: 'book',
    title: 'The book',
    body:
      'All 33 pages of the book are here and read offline. Strokes in the text light up the keys on the board ' +
      'when hovered or clicked.',
    target: tab('/'),
  },
  {
    id: 'practice',
    title: 'Practice',
    body: "Free type, the Stage 0 drills, and the current chapter's drills and test, in the Where you are panel.",
    target: tab('/practice'),
  },
  {
    id: 'more-practice',
    title: 'Fix-up, text and routines',
    body:
      'Cards on the Practice tab lead to more. Fix-up drills the words missed most. Real text takes a pasted text ' +
      'and practises its words. Routines hold a checklist of steps, ticked off as runs finish.',
    target: tab('/practice'),
  },
  {
    id: 'ghosts',
    title: 'Ghosts',
    body: "A ghost is an earlier run's pace, shown in a run as a quiet line. The Ghost picker offers best, last or off.",
  },
  {
    id: 'history',
    title: 'History',
    body: 'Every test is listed with its accuracy and speed. Opening one shows its rhythm, its misses and its slowest words.',
    target: tab('/history'),
  },
  {
    id: 'days',
    title: 'Days',
    body: "A month calendar shaded by practice time, with totals. Picking a day lists its tests and its journal note.",
    target: tab('/days'),
  },
  {
    id: 'progress',
    title: 'Progress',
    body:
      'Speed, accuracy and steadiness over time, the keys and mix-ups that hold typing back, and month-end reports. ' +
      'A plateau notice appears when free-type speed stays flat for a few weeks.',
    target: tab('/progress'),
  },
  {
    id: 'journal',
    title: 'Journal',
    body: "One note per day, saved as it is typed. A result card can also add a line to today's note.",
    target: tab('/journal'),
  },
  {
    id: 'tools',
    title: 'The tools',
    body:
      'Lookup (/), Key chart (K), Briefs (B) and Notes (N) open as a drawer. Alt plus the key works from anywhere, ' +
      'which is the form to use while drilling. Esc closes the drawer.',
    target: '.topbar__tools',
  },
  {
    id: 'data',
    title: 'Your data',
    body: 'Everything stays on this computer, in the data folder. Copying that folder makes a backup.',
  },
  {
    id: 'done',
    title: "That's all",
    body: 'That is the whole tour. Ctrl+Shift+T or the Tour button opens it again.',
  },
]
