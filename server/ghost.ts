// The two ghosts of a mode and section, built from its latest runs in the archive.
import { completionTimes, GHOST_CANDIDATES, pickGhosts } from '../src/core/ghost.ts'
import type { Ghost } from '../src/core/ghost.ts'
import type { Archive } from './archive.ts'

export function buildGhosts(archive: Archive, mode: string, section: string): { best: Ghost | null; last: Ghost | null } {
  return pickGhosts(
    archive.ghostRuns(mode, section, GHOST_CANDIDATES).map((run) => ({
      testId: run.testId,
      endedAt: run.endedAt,
      wpm: run.wpm,
      completions: completionTimes(run.rows),
    })),
  )
}
