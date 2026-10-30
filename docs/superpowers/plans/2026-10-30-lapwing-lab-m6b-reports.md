# Lapwing Lab M6b: Month-end Report, Plateau Notice, Truer Rhythm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Label a run's first bar `start`, score chapter tests on their repeats, show a plateau notice when free-type speed is flat, and give the owner a month-end report page with six tiles, a wpm chart and a notes box saved to `data/reports/YYYY-MM.md`.

**Architecture:** Pure functions in `src/core/` (rhythm kinds, first-showing detection, plateau detector, month math) are shared by server and client. The only server changes are a `firstPassedAt` field on section results, a `reports` notes store with two routes, two settings fields, and first-showing flags computed in `server/stats.ts` for chapter-test runs. The report page recomputes its numbers from existing endpoints (`/api/stats`, `/api/days`, the progress provider); only the notes are stored.

**Tech Stack:** Node 26 (`node:sqlite`), Vite + Preact 11 + TypeScript, Vitest + Testing Library (jsdom). Branch `m6b-reports` (from `main` at `cb941fe`; spec commit `f599731`).

**Spec:** `docs/superpowers/specs/2026-10-30-lapwing-lab-m6b-reports-design.md` (R7, R8, sections 3-5 bind this plan). It builds on `docs/superpowers/specs/2026-10-28-lapwing-lab-m6-progress-design.md` (R1-R6, C10).

## Global Constraints

- Offline, local, private repo. `data/` (the owner's real archive, journal, settings) is never read, written or committed by tests or agents; tests use temp directories. Reading never creates a file or folder. The only new writes are `data/reports/YYYY-MM.md` and the settings fields `plateauSnoozedUntil` and `reportSeen`.
- Style: no semicolons, single quotes, 2-space indent, `.ts`/`.tsx` import suffixes, colours only from the `:root` tokens in `src/ui/reader.css`, calm dark UI, no emoji, no new dependencies. Client code imports from `server/` and `scripts/` with `import type` only; `src/core/` stays pure (no DOM, no fetch, no `node:*`).
- Preact 11 defers `useEffect` cleanup: guard async state with live flags, use `useLayoutEffect` where cleanup must be synchronous.
- Every chart has a text table; no state relies on colour alone; a figure on fewer than 3 runs shows a dash and `not enough runs yet`; never NaN or Infinity.
- Copy never scolds or gives advice; a worse change is shown in the neutral colour, not red. Layout works down to 360 px.
- Every task leaves `npm test`, `npm run typecheck` and `npm run build` green.
- Facts the plan relies on: `DrillSession` (`src/core/drill.ts`) is pure and replayable (`submit({mask,...})` returns `partial | correct | miss | undo | ignored`; `undo`/`ignored` strokes are never logged); a stroke row keeps `expected` (the item's outlines), `pressedMask`, `attemptNo`, `latencyMs`; a chapter test is 45 words x 3 showings in a row (`CHAPTER_TEST`); a section result's `passed` is true when a run's `meta.passed` is true; `Settings` in `server/settings.ts` has a validate-or-default pattern per field and `src/api.ts` mirrors it (`DEFAULT_SETTINGS`, `getSettings`, `putSettings`); notes are autosaved through `useAutosave(store, key, enabled)` with an `AutosaveStore`.

## Planning rulings

- **P1.** The first-showing rule replays the run's strokes through `DrillSession` one item at a time (a new single-item session from the row's `expected` whenever the previous item completed or the row's `expected` differs), so multi-stroke words and misses are handled exactly as the live drill handled them. Item k is a first showing when `k % CHAPTER_TEST.repetitions === 0`.
- **P2.** `server/stats.ts` computes first showings only for `chapter-test` runs and only reads `expected`/`pressedMask` for those runs, so the 189k-stroke case stays fast and small.
- **P3.** (Amended in the final fix wave.) A fresh gap longer than `breakMs` is the owner stepping away, not reading: it becomes kind `break` (break wins over `fresh`; `start` still wins over both), is counted in `breaks`, adds no active time and is left out of the typical gap, stalls and steadiness. A fresh gap at or under `breakMs` stays `fresh`.

## Review Focus

1. A chapter test with a multi-stroke word, a miss mid-word, and an abandoned last item: first showings are found correctly and nothing throws (Task 1, Task 2).
2. A run of one stroke, or where every stroke is `start`/`fresh`: no steadiness, no NaN, strip still draws (Task 1, Task 3).
3. A skipped week, a brand-new learner (under 3 weeks), a snooze set in the past, a malformed settings value: the notice behaves, nothing crashes (Tasks 4, 5, 6).
4. Reports: a month string like `2026-13`, `../x`, `2026-1`; a missing `data/reports`; a future month; a month with no practice; opening Progress or a report must create nothing but `reportSeen` (Tasks 7, 9, 10).
5. Month edges: a run that starts at 23:59 on the last day, DST months, February in a leap year, a practice-free previous month (Tasks 8, 10).

---

### Task 1: Rhythm kinds `start` and `fresh`, and first-showing detection

**Files:** Modify `src/core/rhythm.ts`, `src/core/chaptertest.ts`, `src/ui/progress/RhythmView.tsx` (minimal, keep typecheck green only). Test: `tests/core/rhythm.test.ts`, `tests/core/chaptertest.test.ts`.

**Interfaces:**
- Produces: `RhythmStroke` gains `fresh?: boolean`; `RhythmGap['kind']` is `'normal' | 'stall' | 'break' | 'start' | 'fresh'`; `firstShowings(strokes: readonly { expected: string[]; pressedMask: number; correct: boolean }[], repetitions?: number): boolean[]` exported from `src/core/chaptertest.ts` (one flag per stroke, same order).

- [ ] **Step 1: Write failing tests** in `tests/core/rhythm.test.ts`: (a) stroke 0's gap is `{kind:'start'}` even at 30000 ms, never counted in `stalls`, `breaks`, `typicalGapMs` or `steadiness` (start 4000, then 14 gaps of 500: typical 500, steadiness 100, stalls 0); (b) a one-stroke run gives `gaps` of one `start` and `steadiness` null; (c) a `fresh: true` stroke 3000 ms after the previous gets kind `fresh`, is excluded from typical gap, stalls and steadiness, and a `fresh` gap of 12000 ms is a `break` (counted in `breaks`, no active time; see P3 as amended), while a `fresh` gap of 3000 ms does add active time to `quarters`; (d) stroke 0 with `fresh: true` is `start`; (e) `minGaps` counts only scored gaps (9 normal gaps + start + fresh gives steadiness null; 10 normal gives a number); (f) `quarters` active time excludes the start gap. In `tests/core/chaptertest.test.ts`: `firstShowings` over 3 showings each of a one-stroke word and a two-stroke word (outlines `['KAT','KAT/PHREU']` style from a real `DrillItem`), with a miss in the middle of one showing, returns true exactly for the strokes of showings 1, 4, 7... (item index 0, 3, 6); returns a flag per stroke; an incomplete last item does not throw; empty input gives `[]`.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/core/rhythm.test.ts tests/core/chaptertest.test.ts`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** per spec R7/R8 and P1/P3 (start wins over fresh; `kept` and `breaks` and `typicalGapMs` and `steadiness` use only gaps that are neither `start` nor `fresh` nor over `breakMs`). `firstShowings` replays strokes through a single-item `DrillSession` built from each row's `expected`, building `RawStroke` objects from `pressedMask` as `DrillSession.submit` needs (read `src/core/uni.ts`); a `correct` result ends the item. In `RhythmView.tsx` only make the new kinds render like `normal` so `npm run typecheck` passes.
- [ ] **Step 4: Run to verify pass:** the command from Step 2 plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: rhythm start and fresh gaps, first-showing detection`.

### Task 2: Server uses the new rhythm: first showings in per-day steadiness

**Files:** Modify `server/archive.ts` (`StrokeTiming`, `selectTimings`), `server/stats.ts`. Test: `tests/server/archive.test.ts`, `tests/server/stats.test.ts`.

**Interfaces:**
- Consumes: Task 1 `firstShowings`, `RhythmStroke.fresh`.
- Produces: `StrokeTiming` gains `expected?: string[]` and `pressedMask?: number`, present only for rows of `chapter-test` runs (P2); `buildStats` days' `steadiness` now follows R7/R8.

- [ ] **Step 1: Write failing tests:** archive: `timingsInRange` returns `expected` and `pressedMask` for a `chapter-test` run and leaves them undefined for a `free` run. stats: a seeded chapter-test archive (45 words x 3 showings is too long: use a 4-word list x 3) whose first showings are slow (1500 ms) and repeats steady (400 ms) reports `steadiness` 100 for that day in `drills` mode, while the same strokes in a `free` run (no first-showing flag) report a low score; a free run's day steadiness ignores its first (`start`) gap.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/server/archive.test.ts tests/server/stats.test.ts`.
- [ ] **Step 3: Implement:** extend the timings SQL to return `expected_json` and `pressed_slots_mask` only where `t.mode = 'chapter-test'` (CASE expression), parse `expected_json` only for those rows; in `buildStats` set `fresh` from `firstShowings` for each chapter-test run before calling `runRhythm`.
- [ ] **Step 4: Run to verify pass:** the Step 2 command plus the existing stats and perf tests (`npx vitest run tests/server`).
- [ ] **Step 5: Commit** `feat: per-day steadiness skips start and first showings`.

### Task 3: Rhythm view shows `start` and `first showing`; chapter-test notes replaced

**Files:** Modify `src/ui/progress/RhythmView.tsx`, `src/ui/progress/AccuracyConsistency.tsx`, `src/ui/progress/progress.css` / `src/ui/progress.css`, `README.md` (`## Progress`), `docs/superpowers/specs/2026-10-28-lapwing-lab-m6-progress-design.md` (section 5 note). Test: `tests/ui/progress/RhythmView.test.tsx`, `tests/ui/progress/AccuracyConsistency.test.tsx`.

**Interfaces:** Consumes Task 1 (`firstShowings`, gap kinds). `RhythmView({test, strokes})` keeps its props; it derives `fresh` for `test.mode === 'chapter-test'` itself from the stroke rows.

- [ ] **Step 1: Write failing tests:** the strip labels the first bar `start` and its text reads `Started after 3.2 s`; for a chapter-test run, first-showing bars are drawn paler and labelled `first showing`, the steadiness figure is labelled `repeats only`, and the M6a "chapter tests look erratic" note is gone; a free run has no `fresh` bars and no `repeats only` label; in `drills` and `all` mode the accuracy/consistency panel carries the single line `Chapter tests count their repeats only.` and not in `free` mode; start and fresh bars carry words (not colour alone) in the data table and `aria-label`s; stall and break counts exclude them.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/ui/progress/RhythmView.test.tsx tests/ui/progress/AccuracyConsistency.test.tsx`.
- [ ] **Step 3: Implement** the rendering and copy per spec section 2; add `--start` / fresh styling from existing tokens; update README and the M6a spec section 5 to the new wording; note in README that past days' steadiness may change slightly.
- [ ] **Step 4: Run to verify pass:** the Step 2 command plus `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: rhythm strip shows start and first showings, drop chapter-test caveats`.

### Task 4: Settings fields `plateauSnoozedUntil` and `reportSeen`

**Files:** Modify `server/settings.ts`, `src/api.ts` (`DEFAULT_SETTINGS`, `getSettings`), `server/server.ts` only if the settings route whitelists keys. Test: `tests/server/settings.test.ts`, `tests/api.test.ts`.

**Interfaces:** Produces `Settings` gains `plateauSnoozedUntil: string | null` (a valid `YYYY-MM-DD`) and `reportSeen: string | null` (a valid `YYYY-MM`); defaults `null`; `writeSettings(file, patch)` accepts both (patch may set `null` to clear), rejects other strings with an Error like the existing fields; `readSettings` ignores invalid stored values per field.

- [ ] **Step 1: Write failing tests:** defaults are null; a patch of `{plateauSnoozedUntil:'2026-11-13'}` round-trips and keeps `boardVisibility`/`hints`; `'2026-13-01'`, `'tomorrow'`, `'2026-11'` throw for the snooze; `'2026-13'`, `'2026-1'` throw for `reportSeen`; an old file with only `boardVisibility` still reads; garbage values in the file read as null; the client `getSettings` falls back per field.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/server/settings.test.ts tests/api.test.ts`.
- [ ] **Step 3: Implement** with real-calendar validation (reject `2026-02-30`).
- [ ] **Step 4: Run to verify pass:** the Step 2 command plus `npx vitest run tests/server/server.test.ts`.
- [ ] **Step 5: Commit** `feat: settings remember a plateau snooze and the last report seen`.

### Task 5: Plateau detector

**Files:** Create `src/core/plateau.ts`. Test: `tests/core/plateau.test.ts`.

**Interfaces:**
- Consumes: `DayQuality` (type import from `server/stats.ts`), `addDays`/`daysBetween` from `src/core/days.ts` and `progressview.ts`.
- Produces: `export type Plateau = { weeks: number; thisWeek: number; others: number[]; meanwhile: { steadiness?: { from: number; to: number }; accuracy?: { from: number; to: number } } }` and `export function detectPlateau(days: readonly DayQuality[], today: string): Plateau | null`.

- [ ] **Step 1: Write failing tests** (spec section 3): eight 7-day weeks ending `today`; week value = words-weighted mean wpm of days in it with at least 2 runs in the week, else a gap; flat weeks 41, 42, 40 with tolerance `max(2, 4%)` give `weeks: 3`, `thisWeek: 41`, `others: [42, 40]`; weeks 41, 44, 41 (44 is 3 away from 41, tolerance is 2) stop at the first out-of-tolerance week, so `weeks` is 1 and the result is null; a gap week between flat weeks is skipped and does not end the plateau (41, gap, 42, 40 gives weeks 3); week 0 without a value gives null; only 2 flat weeks gives null; `others` has at most two entries (the most recent counted weeks) however long the plateau; `meanwhile` includes steadiness only when it rose by at least 3 from the oldest counted week and accuracy only when it rose by at least 1.5 points (accuracy stored 0..1, reported as whole percent points), and omits a metric whose oldest-week value is missing; never reports a decline; input empty or unsorted gives null or a stable answer; no NaN.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/core/plateau.test.ts`.
- [ ] **Step 3: Implement** `detectPlateau` as specified (pure).
- [ ] **Step 4: Run to verify pass:** same command plus `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: plateau detector`.

### Task 6: Plateau notice on Progress and in the chapter panel

**Files:** Create `src/ui/progress/PlateauNotice.tsx`, `src/ui/progress/usePlateau.ts`; modify `src/ui/Progress.tsx`, `src/ui/ChapterPanel.tsx`, `src/ui/progress.css`, `src/ui/chapterpanel.css`. Test: `tests/ui/progress/PlateauNotice.test.tsx`, `tests/ui/Progress.test.tsx`, `tests/ui/ChapterPanel.test.tsx`.

**Interfaces:**
- Consumes: Task 4 settings, Task 5 `detectPlateau`, `getStats(from, to, 'free')`, `rangeBounds`-style 56-day window ending `today`.
- Produces: `usePlateau(today: string): { plateau: Plateau | null; snooze: () => Promise<void> }` (fetches once on mount; a failure or empty answer gives `plateau: null` silently; `plateau` is null while snoozed, i.e. `plateauSnoozedUntil > today`); `PlateauNotice({ plateau, onSnooze, variant }: { plateau: Plateau; onSnooze: () => void; variant: 'panel' | 'line' })`.

- [ ] **Step 1: Write failing tests:** with a mocked flat history the Progress page shows `Your speed has been flat for 3 weeks`, the numbers line (`41 this week, 42 and 40 the weeks before`), `Plateaus like this are common while learning steno.`, the `meanwhile` line only when present, links `Weakest keys` and `Mix-ups`, and a `Not now (14 days)` button that stores `plateauSnoozedUntil = today + 14 days` through `putSettings` and hides both places; a snooze in the past shows the notice, a snooze today+1 hides it; the chapter panel shows the one-line variant `Speed flat for 3 weeks, see Progress` linking to `/progress`; neither renders while the fetch is pending or fails; no text gives advice; the Mode/Range switches do not change the notice.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/ui/progress/PlateauNotice.test.tsx tests/ui/Progress.test.tsx tests/ui/ChapterPanel.test.tsx`.
- [ ] **Step 3: Implement** per spec section 3; the gold colour comes from an existing token (add one to `:root` in `reader.css` only if none fits).
- [ ] **Step 4: Run to verify pass:** the Step 2 command plus `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: plateau notice on Progress and in the chapter panel`.

### Task 7: Reports notes store and routes

**Files:** Create `server/reports.ts`; modify `server/server.ts` (`reportsDir: join(dataDir, 'reports')` in the context, routes), `src/api.ts` (`listReports`, `getReport`, `putReport`), `src/ui/useAutosave.ts` (`reportsStore`). Test: `tests/server/reports.test.ts`, `tests/server/server.test.ts`, `tests/api.test.ts`, `tests/ui/useAutosave.test.tsx`.

**Interfaces:** Produces `isReportMonth(month: string): boolean` (`^\d{4}-(0[1-9]|1[0-2])$`), `readReport(dir, month): string`, `writeReport(dir, month, text): void`, `listReports(dir): { month: string; chars: number }[]` (ascending, non-empty notes only, ignores stray files and directories); `GET /api/reports`, `GET /api/reports/:month` -> `{month, text}`, `PUT /api/reports/:month` `{text}` -> `{month, text}`, same body validation, size limit and error shapes as `/api/notes`; `reportsStore: AutosaveStore` keyed by `YYYY-MM`.

- [ ] **Step 1: Write failing tests:** mirror `tests/server/notes.test.ts` for months: invalid months (`2026-13`, `2026-00`, `2026-1`, `../x`, `2026-10/../..`, empty) throw before any filesystem access and give HTTP 400; reads of a missing folder return empty and create nothing; write creates the folder, is atomic, round-trips unicode; a directory named `2026-10.md` is not a note; `GET /api/reports` lists only non-empty notes; PUT over the size limit is refused as `/api/notes` does; `reportsStore` refuses a non-month key.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/server/reports.test.ts tests/server/server.test.ts tests/api.test.ts tests/ui/useAutosave.test.tsx`.
- [ ] **Step 3: Implement** by following `server/notes.ts` and the `/api/notes` handlers.
- [ ] **Step 4: Run to verify pass:** the Step 2 command.
- [ ] **Step 5: Commit** `feat: report notes store and routes`.

### Task 8: `firstPassedAt` and the pure month-report math

**Files:** Modify `server/archive.ts` (`SectionResult`, `sectionResults`); create `src/core/report.ts`. Test: `tests/server/archive.test.ts`, `tests/core/report.test.ts`.

**Interfaces:**
- Produces: `SectionResult` gains `firstPassedAt: number | null` (earliest `ended_at` among the section's runs with `meta.passed` true, else null). In `src/core/report.ts`: `monthKey(date: string): string`, `monthBounds(month: string): { from: string; to: string; lastDay: string }`, `previousMonth(month: string): string`, `monthsBetween(first: string, last: string): string[]` (ascending), `isMonthComplete(month: string, today: string): boolean` (today is the month's last day or later), `chapterPassDates(chapters: ChapterInfo[], results: ResultsByMode, marks: ProgressMark[]): Map<number, string>` (chapter -> local date of its earliest evidence per spec section 4: Stage 0 `pseudo-test` for the `stage0` gate, `testListId` for `test`, any mark's `at` for any chapter, `drills` gate by mark only; no evidence means absent), `reportTiles(input): ReportTiles` where input holds the month's and previous month's `DayQuality[]` (free), `DayStat[]` (all modes), `chapters: number[]` passed in the month with their dates, and `firstMonth: boolean`; each tile is `{ value: string | null; subline: string | null }` with the wording and thresholds of spec section 4 (value null and `not enough runs yet` under 3 free-type runs; neutral wording for worse changes; first month uses `first day X, last day Y` for wpm and accuracy).

- [ ] **Step 1: Write failing tests:** archive: `firstPassedAt` is the earliest passing run's `ended_at`, null when no run passed, unaffected by a later failing run; core: month bounds for `2026-02` in 2028 (leap) and `2026-12`; `previousMonth('2026-01')` is `'2025-12'`; `monthsBetween('2026-10','2027-01')` has 4 entries; `isMonthComplete` on the last day true, the day before false; `chapterPassDates` takes the earliest of test and mark, ignores a drills chapter's test results, ignores a chapter with no evidence, uses local dates; `reportTiles`: first month has no change sublines but wpm `first day 22, last day 41`; a second month shows `+19 wpm vs September`-style changes; under 3 runs gives null value; steadiness has no first-month subline; a worse change contains no `-` styling hint beyond the number (the component decides colour) and no scolding words; all outputs finite.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/server/archive.test.ts tests/core/report.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass:** the Step 2 command, `npx vitest run tests/server`, `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: first-passed dates and month report math`.

### Task 9: Reports routes, month list, Progress link and banner

**Files:** Modify `src/router.ts` (`{ name: 'reports' }`, `{ name: 'report'; month: string }`, both belong to the `progress` tab), `src/ui/App.tsx`, `src/ui/Progress.tsx`; create `src/ui/Reports.tsx`, `src/ui/reports.css`. Test: `tests/router.test.ts`, `tests/ui/Reports.test.tsx`, `tests/ui/Progress.test.tsx`, `tests/ui/App.test.tsx`.

**Interfaces:** Consumes Task 7 `listReports`, Task 8 `monthsBetween`/`isMonthComplete`, Task 4 settings. Produces routes `/progress/reports` and `/progress/reports/YYYY-MM` (a single path segment that is not a `YYYY-MM` parses to the `report` route, and `Report` says `No such month.` with a link back to the list; amended in the final fix wave); `Reports()` lists months (first practice month to the current one, newest first; one `getDays` call over the last 36 months) with time, strokes and a note mark, each a link; a `Reports` link on Progress; `ReportBanner({ today })` on Progress: `October is done. Your report is ready.` for the latest complete-or-ending month that has practice and is later than `reportSeen`, never for the current month before its last day.

- [ ] **Step 1: Write failing tests:** router parses both paths and the trailing slash, rejects `2026-13` and `2026-1`; `tabOf` gives `progress`; the list orders newest first, marks months with notes, shows an empty state with no practice and no error; the banner appears on the last day for a month with practice, not on the day before, not for a month at or before `reportSeen`, not when the month has no practice; Progress shows the `Reports` link; a failed fetch shows no banner and no error.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/router.test.ts tests/ui/Reports.test.tsx tests/ui/Progress.test.tsx tests/ui/App.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass:** the Step 2 command plus `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: reports list, Progress link and month-end banner`.

### Task 10: The report page

**Files:** Create `src/ui/Report.tsx`, `src/ui/ReportTiles.tsx` (or one file if small); modify `src/ui/App.tsx`, `src/ui/reports.css`. Test: `tests/ui/Report.test.tsx`.

**Interfaces:** Consumes Tasks 4, 7, 8, the M6a `WpmByDay`/`DataTable`/`ChartSvg` pieces (extend or wrap, do not fork), `useAutosave(reportsStore, month, true)`. Produces `Report({ month, today? })`: header `October 2026 · 6 practice days`, six tiles in the order of spec section 4, the wpm-by-day chart for the month with its `Show the numbers` table, the scopes line (`Time and strokes cover every mode; speed, accuracy and steadiness cover free type.`), and one `Your notes` textarea with the autosave status; opening a complete month stores `reportSeen` (only forward, only when the month is complete).

- [ ] **Step 1: Write failing tests:** a seeded October with 6 practice days renders the header, six tiles with the values `reportTiles` gives, a chart with a table, the scopes line; the first month has no comparison sublines; a September+October pair shows changes; a month with no practice renders empty tiles and an empty chart state, no crash; an invalid month shows `not-found` text; typing a note autosaves through `putReport` and survives a remount; opening October on 2026-10-31 calls `putSettings({reportSeen:'2026-10'})`, opening it on 2026-10-20 does not, opening September when `reportSeen` is `2026-10` does not lower it; a failed note load shows an error with a retry and the textarea does not overwrite anything; chapters tile lists `ch 4 on the 30th` from a Stage 0 result with `firstPassedAt` on that date; keyboard: chart is one tab stop; tiles and chart are readable at 360 px (CSS-source guard like the M6a guards, no horizontal scroll rule).
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/ui/Report.test.tsx`.
- [ ] **Step 3: Implement.** Fetch the month and the previous month with `getStats(from, to, 'free')` and `getDays`, plus `useProgress()` for results and marks; loading and error states as `Progress` does.
- [ ] **Step 4: Run to verify pass:** the Step 2 command, `npm test`, `npm run typecheck`, `npm run build`.
- [ ] **Step 5: Commit** `feat: month-end report page with notes`.

### Task 11: Docs and the milestone checklist

**Files:** Create `docs/superpowers/m6b-checklist.md`; modify `README.md` (a `## Reports and the plateau notice` section: what they show, where notes live, snooze, what is written to `data/`), `docs/superpowers/m0-m1-followups.md` (`## Left open by M6b` with any deferred minors, including that the notice needs about 3 weeks of data), the M6a spec (the superseded section 4 and C7/C17 marked as replaced by M6b, C10 plateau line pointing to the M6b spec).

- [ ] **Step 1:** Write the checklist from spec section 7 (about 15 concrete checks the owner does against his real history, each with the expected result).
- [ ] **Step 2:** Update the README, follow-ups and M6a spec notes; run `npm test`, `npm run typecheck`, `npm run build` and confirm `git status` is clean and `data/` was never touched.
- [ ] **Step 3: Commit** `docs: M6b README, checklist, follow-ups`.
