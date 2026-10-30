# Lapwing Lab M6b: plateau notice, month-end report, truer rhythm

Date: 2026-10-30. Builds on M6a (`docs/superpowers/specs/2026-10-28-lapwing-lab-m6-progress-design.md`, already on `main`). Read that spec's rhythm, mode-scope and date conventions (R1-R6, C10); this one reuses them and does not repeat them.

## 1. Why

The owner (learning steno on a Uni v4 with Lapwing theory, started 2026-10-26) wants the app to show progress honestly and to stop him fooling himself in either direction. M6a shows the numbers. M6b adds three things around them:

1. A **month-end report** he can open on the last day of a month (or any time later), with his own notes written next to the numbers. It is a look-back, not a scoreboard.
2. A **plateau notice** that says plainly when his free-type speed has gone flat, and what is improving meanwhile, so a flat stretch does not read as failure.
3. Two **fixes to the Rhythm numbers** found in the M6a review: the first bar of a run, and chapter-test steadiness.

Success: after a month he can open one page, see the month in six numbers and one chart, write what he thinks, and find it again in a plain file.

Anti-goals: nothing nags, scolds, or tells him what to practise (the app gives him total control of how he learns). No streak pressure, goals, targets or badges. No exports, PDF, weekly or custom-range reports, no comparing two arbitrary months. Notes are plain text, not rendered.

## 2. Rhythm fixes (`src/core/rhythm.ts` and its callers)

**R7. The first bar is `start`.** (Wins over `fresh` below: the first stroke of a chapter test is both, and is `start`.) The first stroke's gap (time from the prompt appearing to the first key) gets kind `start`. It is shown, labelled and timed, but left out of the typical gap, stalls, breaks, steadiness and the quarters' active time. It is never a stall or a break, however long. `RhythmGap['kind']` becomes `'normal' | 'stall' | 'break' | 'start'`. A one-stroke run has only a `start` gap and no steadiness.

**R8. Chapter tests are scored on repeats.** A chapter test shows each of 45 words 3 times in a row (`CHAPTER_TEST`). The first showing of a word includes reading time. A stroke in the first showing of its word is `fresh`; its gap gets kind `fresh`, shown paler on the strip and labelled "first showing", and is left out of the typical gap, stalls and steadiness (it still counts as active time for the quarters, because those words are part of the run's wpm). A `fresh` gap longer than `breakMs` is the owner stepping away, not reading: it becomes kind `break` (break wins over `fresh`; `start` still wins over both), is counted in `breaks` and adds no active time. A `fresh` gap at or under `breakMs` stays `fresh`. (Amended after the final review.) Showings are found from the stroke rows by replaying them through a `DrillSession` (`firstShowings`, which takes each row's `correct` too: the live drill never logs an undo, so a row that is `correct` where the replay says miss re-syncs the replay after the unlogged undo), and item k (0-based, counted in order) is a first showing when `k % CHAPTER_TEST.repetitions === 0`. Only runs with mode `chapter-test` do this; every other mode has no `fresh` strokes. `RhythmStroke` gains optional `fresh?: boolean`; a shared pure helper (`src/core/rhythm.ts` or beside `chaptertest.ts`) derives it from stroke rows so the server's per-day steadiness and the client's Rhythm view agree. `StrokeTiming` (server) therefore also carries `attemptNo`. Wherever steadiness for a chapter test run is shown, it is labelled "repeats only". Per-day steadiness in the Drills and tests and Everything modes mixes chapter tests with other runs; there the steadiness panel carries one line: "Chapter tests count their repeats only."

M6a's explanatory notes about chapter-test steadiness (RhythmView, the accuracy panel line, README, M6a spec section 5) are replaced by this behaviour: the notes are removed or reworded to "Chapter tests are scored on the second and third showing of each word." Per-day steadiness (`server/stats.ts`) uses the same rules, so past days change slightly (documented in the README).

## 3. Plateau notice

**Detection (pure, `src/core/plateau.ts`).** Input: the free-mode `DayQuality[]` for the last 56 days and today's local date. Cut the 56 days into eight 7-day weeks ending today (week 0 is the latest). A week's wpm is the words-weighted mean wpm of its free-type runs; the week counts only with at least 2 free-type runs, else it is a gap. Tolerance for week 0's value v is `max(2 wpm, 4% of v)`. The plateau length N is the number of weeks, from week 0 backwards, that have a value within tolerance of week 0, stopping at the first week that has a value outside tolerance. A gap week (fewer than 2 free-type runs, e.g. a week off) is skipped: it does not count towards N and does not end the plateau, so a single skipped week never hides the notice. The notice fires when N >= 3. The notice looks only at free type over the fixed 56 days; it ignores the Progress page's Mode and Range switches (this replaces M6a's C10 line about a plateau following the mode switch). Week 0 needs a value. So it cannot fire before about 3 weeks of regular free-type practice. "The oldest plateau week" is the oldest counted week; if its steadiness or accuracy is missing, that metric gets no "meanwhile" line. The body names this week and up to two other counted weeks (the most recent ones), however long the plateau is. Accuracy and steadiness for "meanwhile" use the same weeks (accuracy words-weighted; steadiness the median of the days' values, as M6a does); a "meanwhile" line appears only for a metric that rose from the oldest plateau week to week 0 by at least 3 steadiness points or 1.5 accuracy points. No "meanwhile" line when nothing improved. Never a line about anything that got worse.

**Words.** Title: "Your speed has been flat for N weeks". Body: "Free-type wpm: 41 this week, 42 and 40 the weeks before." plus "Plateaus like this are common while learning steno." Optional second line: "Meanwhile your steadiness rose from 44 to 53 and your accuracy from 91% to 94%." Links: "Weakest keys" and "Mix-ups" (scroll to those Progress panels), and a button "Not now (14 days)". It states facts only; no advice, no instruction.

**Where.** (B, chosen by the owner) On the Progress page above the tiles, and as a small gold line in the reader's `ChapterPanel` header ("Speed flat for 3 weeks, see Progress", linking to Progress), so on chapter pages only, not on the home page or appendices. One cheap fetch of `/api/stats` (free mode, last 56 days) when the Progress page or the reader mounts; if it fails or returns nothing, no notice and no error shown.

**Snooze.** "Not now (14 days)" hides both places until 14 days later. It is stored in `data/settings.json` as `plateauSnoozedUntil` (a `YYYY-MM-DD` string or absent), through the existing settings read/write path, which gains the field with the same validate-or-ignore handling as the other keys. The notice stops by itself when the plateau ends.

## 4. Month-end report

**Where.** A "Reports" link on the Progress page opens `/progress/reports`: the months from the first practice month to the current one, newest first, each row showing the month, practice time, strokes and a mark if a note exists. A row opens `/progress/reports/YYYY-MM`. The top bar keeps six tabs; both routes belong to the Progress tab. An invalid month (not `YYYY-MM`, month 00 or 13, or a month with no practice and in the future) shows a plain not-found message. A past month with no practice days opens as a report with empty tiles.

**Banner.** On the Progress page, when today is the last day of a month or later and the latest such month has practice but the owner has not opened its report, a quiet line says "October is done. Your report is ready." linking to it. Opening a report stores `reportSeen` (`YYYY-MM`) in `data/settings.json`, the same way as the snooze, but only when that month is complete (today is its last day or later) and only if it is later than the stored value: opening an older month never lowers it, and opening the current month before its last day stores nothing. The banner shows for the latest complete-or-ending month with practice only if it is later than `reportSeen`. It never shows for the current month before its last day.

**Layout (B, chosen by the owner).** Header: month name and year with the number of practice days, e.g. "October 2026 · 6 practice days". Six tiles, then the wpm-by-day chart, then one notes box.

| Tile | Value | Subline |
|---|---|---|
| Practice time | all modes, from `/api/days` | change vs the previous month; none for the first month |
| Strokes | all modes, from `/api/days` | same |
| Free-type wpm | words-weighted mean of the month's free-type runs | vs the previous month; first month: "first day 22, last day 41" |
| Accuracy | free type, one decimal as on the Progress tiles | same rule |
| Steadiness | median of the month's days with a value | change vs the previous month if both exist |
| Chapters passed | count of chapters first passed in the month | their numbers, e.g. "ch 4 on the 30th" |

"First month" means no earlier month has any practice. The previous month is the calendar month before, even if empty (then no comparison). The accuracy tile follows the wpm tile's first-month rule; the steadiness tile has no first-month subline. A tile with too little data (fewer than the M6a `enough` threshold of 3 free-type runs in the month, counting `DayQuality.runs`; the steadiness tile also needs at least one day with a steadiness value) shows an em dash and "not enough runs yet". Changes use the M6a `change` wording and colouring, and a worse change is shown plainly in the neutral colour, not red. "Passed in the month" uses the Ladder's own pass rule (a chapter test meeting its mark, a drills gate, or a progress mark) with the date of the first time it was met, in local time. The chart is M6a's wpm-by-day chart for the month, free type, with the same "Show the numbers" table. A small line states the scopes: "Time and strokes cover every mode; speed, accuracy and steadiness cover free type."

**Notes.** One text box ("Your notes") that autosaves (the `useAutosave` pattern the journal and notes use) to `data/reports/YYYY-MM.md`, a plain UTF-8 file. A new `server/reports.ts` mirrors `server/notes.ts`: month validated by `^\d{4}-(0[1-9]|1[0-2])$` before any filesystem access, reads never create anything (missing file or folder is an empty note), writes are atomic (temp file then rename) and create the folder on the first save. `GET /api/reports` lists months that have non-empty notes (`{month, chars}`); `GET /api/reports/:month` returns `{text}`; `PUT /api/reports/:month` with `{text}` saves. Same size limit and error shapes as `/api/notes`. The numbers are never stored: they are recomputed from the archive each time, so notes are the only report data on disk.

**Numbers come from existing endpoints, plus one small addition.** The month's `/api/stats` (free mode) and `/api/days`, the previous month's for comparison, and the progress provider for chapters. The one server change: `SectionResult` (`server/archive.ts`, served by `/api/results`) gains `firstPassedAt: number | null`, the earliest `ended_at` of a run of that section whose `meta.passed` is true. The page works out each chapter's pass date as the earliest of: the `firstPassedAt` of its test (Chapter 4: the Stage 0 `pseudo-test`; other test chapters: their `testListId`, as the Ladder finds them) and the `at` of any progress mark for it (`read` or `override`). A chapter whose only evidence is the Ladder's best-result rule (no run with `meta.passed`, no mark) has no date and counts in no month. A chapter with a `drills` gate counts by its progress mark only. A mark that is later removed stops counting. Chapters are listed by number, each once.

**M6a's own month-end report plan is superseded.** M6a's spec section 4 and its calls C7 and C17 (a section at the bottom of Progress, with a month picker and a key/mix-up/streak summary) were never built. This report replaces them: no keys, mix-ups or streak on it, and Progress gets no report section, only the link and the banner.

## 5. Constraints

Private, offline, no new runtime dependency. `data/` is the owner's real archive and must never be read, written or committed by agents or tests; tests use temp directories. Only `data/reports/*.md` and two settings fields are new writes. Reading must not create files. Local-date conventions, the Monday week start and the 800 -> 1,100 day span limit from M6a apply. Accessible as M6a: every number is text, charts have the table, one tab stop per chart. Layout works down to 360 px.

## 6. Left to the builder

Component and file names, the exact route parsing, how the reader's lesson header reads the notice, the wording of empty states, the month-list fetch strategy (one `/api/days` call over the last 36 months is fine), tile responsive layout, and test layout. Follow the surrounding code's style.

## 7. Checks the owner will do (become the milestone checklist)

The `start` bar shows and no longer counts as a stall; a chapter test's steadiness says "repeats only" and no longer reads erratic; the notice appears on Progress and in the reader when flat for 3 weeks, snoozes for 14 days, and says nothing when there is no plateau; the report for October opens with six tiles, a chart and a notes box, the note survives a reload and appears in `data/reports/2026-10.md`; the banner appears once and not again after the report is opened; nothing is written by opening Progress or a report except `reportSeen`.
