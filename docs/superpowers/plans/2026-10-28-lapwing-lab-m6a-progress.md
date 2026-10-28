# Lapwing Lab M6a: The Progress Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Progress tab that shows the owner their free-type wpm by day, accuracy, consistency (rhythm) inside a run, weekly practice time and strokes, weakest keys, mix-ups, the chapter ladder and a year heatmap with streaks, computed live from the existing archive; and the same rhythm view on every run in History.

**Architecture:** Pure functions in `src/core/` (rhythm of a run, key statistics, week and trend helpers) are used by the server and the client. New read-only archive methods plus one route `GET /api/stats` aggregate per-day quality, key statistics and mix-ups in the server; practice time, strokes and the heatmap reuse `GET /api/days`; the ladder reuses the progress provider's results. Charts are hand-drawn SVG components with a text table behind each. Nothing is written to the archive.

**Tech Stack:** Node 26 (`node:sqlite`), Vite + Preact 11 + TypeScript, Vitest + Testing Library (jsdom). Branch `m6-progress` (from `main` at `9c85a7f`; design commits `fc35c7c`, `19cce3a`).

**Spec:** `docs/superpowers/specs/2026-10-28-lapwing-lab-m6-progress-design.md` (rulings C1–C18 bind this plan; §4 panels 1–9 and Rhythm, §5 definitions, §6 data). M6b (plateau notice and month-end report) is a separate later plan.

## Global Constraints

- Offline, local, private repo. `data/` (the owner's real archive) is never read or written by tests or agents; this milestone adds no writes to `steno.db`, `data/journal` or any other file. The stats routes use the existing archive only and create no file when there is none (like `/api/days`).
- Style: no semicolons, single quotes, 2-space indent, `.ts`/`.tsx` import suffixes, colours only from the `:root` tokens in `src/ui/reader.css`, calm dark UI, no emoji. No new dependencies (no charting library). Client code imports from `server/` and `scripts/` with `import type` only; `src/core/` stays pure (no DOM, no fetch, no `node:*`).
- Preact 11 defers `useEffect` cleanup: guard async state with live flags, use `useLayoutEffect` where cleanup must be synchronous.
- Every chart has a text table (or list) of the numbers behind it, does not rely on colour alone (states carry words), and every dot and bar detail is reachable by keyboard focus.
- A figure that rests on fewer than 3 runs shows a dash and `not enough data yet`; never NaN, Infinity or a made-up zero.
- Every task leaves `npm test`, `npm run typecheck` and `npm run build` green.
- Facts from the code that the plan relies on: `tests.accuracy` is 0..1 and `tests.wpm` is words per minute; a finished run's `meta` holds `kind`, `itemCount` (a placeholder for timed runs), `firstTryCorrect`, `elapsedMs`, `passed`, and for a timed-out run `timedOut: true`; a left-early run has `meta.abandoned: true`; a stroke row's `latency_ms` is the time since the current prompt was shown (reset when a word completes); partial strokes of a multi-stroke word are logged as `correct`; `attempt_no` is misses so far plus one; `LOCAL_DAY` in `server/archive.ts` is the local date of a run's first stroke and is the day convention of the Days tab; existing modes are `free`, `section`, `stage0`, `chapter-test`.

## Planning rulings (made while writing this plan; recorded in the spec in Task 10)

- **R1 (refines C11).** A finished run's completed words are `round(wpm * meta.elapsedMs / 60000)` when `meta.elapsedMs > 0`, else `round(meta.firstTryCorrect / accuracy)` when `accuracy > 0`, else 0. Strokes alone cannot give words (partial strokes of a multi-stroke word are logged as correct), so this is the exact source. Day wpm and accuracy are averages weighted by these words.
- **R2 (refines C13).** A quarter's wpm shares the run's completed words across the four active-time slices in proportion to the correct strokes in each slice, divided by the slice's active minutes. It is an estimate that agrees with the run's stored wpm overall; the panel labels it "estimated".
- **R3 (refines C18, C16).** Days and weeks use the local date of a run's first stroke, exactly as `/api/days` does, so the pages agree.
- **R4.** Mix-ups count a stroke only when exactly one key was pressed that was not needed and exactly one needed key was missing (a clean one-for-one substitution); the needed stroke of a miss is the nearest accepted stroke, as `src/core/review.ts` already does for the Misses table.
- **R5.** Practice time, strokes, the heatmap, streaks and per-week bars come from `/api/days` (no new SQL); the chapter ladder comes from the progress provider; only per-day quality, key statistics, mix-ups and the all-time stroke count come from the new `/api/stats`.

## Review Focus

1. A large archive (200,000 strokes over three years): `/api/stats` answers in well under a second, memory stays small (aggregate in SQL or one pass, never ship strokes to the browser), and the page stays responsive.
2. An empty or tiny archive (no database, no runs, one run, two runs): every panel shows its empty or `not enough data yet` state, nothing renders NaN or Infinity, nothing crashes, and no file is created by reading.
3. Odd runs: left early, unfinished (`ended_at` NULL), timed out, zero strokes, one stroke, equal timestamps, `latency_ms` 0, gaps of days, a clock that goes backwards (`ts_ms` decreasing): rhythm and every average stay finite and non-negative.
4. Time: week boundaries (Monday start), DST changes, a run that crosses midnight (its day is its first stroke's local date), range edges inclusive, `from` and `to` swapped or too far apart (400, like `/api/days`).
5. Chart honesty and access: one dot, all-equal values, a y-axis that starts at zero, outliers (a 90 wpm fluke), the trend line only with at least 3 days, long month labels at narrow widths, keyboard reach, the table behind each chart matching the picture.

---

### Task 1: The rhythm of a run (pure)

**Files:**
- Create: `src/core/rhythm.ts`, `tests/core/rhythm.test.ts`

**Interfaces:**
- Produces (all exported from `src/core/rhythm.ts`, pure, no DOM/fetch/node):
  - `type RhythmStroke = { tsMs: number; correct: boolean; latencyMs: number }`
  - `type RhythmOptions = { breakMs?: number; stallFactor?: number; stallMinMs?: number; minGaps?: number }` with defaults `breakMs = 10_000`, `stallFactor = 2.5`, `stallMinMs = 1_000`, `minGaps = 10` exported as `RHYTHM_DEFAULTS`.
  - `type RhythmGap = { ms: number; kind: 'normal' | 'stall' | 'break' }`
  - `type Rhythm = { gaps: RhythmGap[]; typicalGapMs: number | null; stalls: number; breaks: number; steadiness: number | null; quarters: { activeMs: number; correct: number }[] | null }`
  - `runRhythm(strokes: readonly RhythmStroke[], opts?: RhythmOptions): Rhythm` and `quarterWpm(r: Rhythm, completedWords: number): (number | null)[]` (length 4, `null` per quarter without data).

Rules (spec §5, C4, C13/R2): one gap per stroke, in order: the first stroke's gap is its own `latencyMs`; every later gap is `tsMs` minus the previous stroke's `tsMs`, with a negative difference (clock went backwards) clamped to 0; a gap over `breakMs` has kind `break` and is left out of the typical gap, stalls, steadiness and the active time; the typical gap is the median of the non-break gaps (`null` when there are none); a `stall` is a non-break gap more than `stallFactor` times the typical gap and at least `stallMinMs`; `steadiness` is an integer 0 to 100 from the robust spread of the non-break gaps relative to their median (the builder chooses the formula) and `null` when fewer than `minGaps` non-break gaps; `quarters` cuts the cumulative active time into four equal slices, assigns each stroke to the slice holding the end of its (non-break) gap, and reports each slice's active milliseconds and number of correct strokes (`null` when the run has no active time or fewer than 4 strokes); `quarterWpm` shares `completedWords` across the slices in proportion to their correct strokes and divides by the slice's active minutes.

- [ ] **Step 1: Failing tests** in `tests/core/rhythm.test.ts` (each must be able to fail):
  - 60 strokes 600 ms apart with latency 600: `typicalGapMs === 600`, `stalls === 0`, `breaks === 0`, `steadiness >= 95`.
  - The same run with every second gap doubled (600, 1200, ...): `steadiness` lower than the even run by at least 15 points, and `stalls === 0` (1200 is not 2.5 times 600).
  - One 4,000 ms gap among 49 gaps of 600 ms: `stalls === 1`, and `steadiness` within 10 points of the even run (a single stall does not wreck the score).
  - A 12,000 ms gap is a `break`: not a stall, not in the typical gap, not in `quarters` active time (`sum(activeMs)` equals the sum of non-break gaps).
  - The first gap uses `latencyMs`, later gaps the `tsMs` difference; a decreasing `tsMs` gives a gap of 0 and every output is finite and non-negative.
  - Fewer than 10 non-break gaps: `steadiness === null`; zero strokes: `gaps` empty, `typicalGapMs === null`, `quarters === null`; one stroke does not throw.
  - Equal timestamps (all gaps 0) do not divide by zero: `typicalGapMs` is `0` or `null` as you define and documented in a comment, `steadiness` finite or `null`, no NaN anywhere.
  - `quarters`: four entries whose `activeMs` are within one stroke gap of each other for an even run, `correct` sums to the number of correct strokes; `quarterWpm(r, 40)` for an even run gives four numbers whose mean is about `40 / (activeMinutes)`; a quarter with no correct strokes gives `null`; sharing is proportional to correct strokes.
  - Determinism and not mutating the input array.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** `runRhythm`, `quarterWpm`, `RHYTHM_DEFAULTS`.
- [ ] **Step 4: Run the tests, `npm test`, typecheck; green.** Mutation-check the stall rule, the break exclusion, the first-gap rule and the null threshold one at a time and restore.
- [ ] **Step 5: Commit** `feat: the rhythm of a run`.

---

### Task 2: Archive read methods for stats

**Files:**
- Modify: `server/archive.ts`, `tests/server/archive.test.ts` (or the existing archive test file; follow its fixture helpers)

**Interfaces:**
- Consumes: the existing `WITH_STROKES`, `LOCAL_DAY` fragments and row mappers.
- Produces, added to `Archive`:
  - `type RunRow = { id: number; date: string; mode: string; chapter: number | null; endedAt: number | null; accuracy: number | null; wpm: number | null; words: number; abandoned: boolean; timedOut: boolean; strokes: number; activeMs: number }` and `runsInRange(from: string, to: string): RunRow[]`: every run that has strokes whose local first-stroke date is within `from..to` inclusive (YYYY-MM-DD, validated like `dayStats`), ordered by id; `words` per R1 (0 for a run that never finished); `abandoned` from `meta.abandoned === true`; `timedOut` from `meta.timedOut === true`.
  - `type StrokeTiming = { testId: number; tsMs: number; correct: boolean; latencyMs: number }` and `timingsInRange(from: string, to: string): StrokeTiming[]`: the timing columns of every stroke of every finished, non-abandoned run in the range (same day rule), ordered by test id then stroke id, read in one prepared statement.
  - `type KeyRow = { expected: string[]; pressedMask: number; correct: boolean; n: number }` and `keyRowsInRange(from: string, to: string): KeyRow[]`: the strokes of ALL runs in the range (every mode, left-early included) grouped by `(expected_json, pressed_slots_mask, correct)` with the count `n`, parsed `expected`.
  - `allTimeStrokes(): number` (`SELECT COUNT(*) FROM strokes`).
  Every method validates its dates with the existing `localDate` guard and never creates anything.

- [ ] **Step 1: Failing tests** with a fixture archive in the test's temp dir (follow how the existing archive tests build one; use real `startTest`, `addStroke`, `finishTest` calls): `runsInRange` includes a run in range, excludes one outside, includes an unfinished run (`ended_at` NULL, `words` 0), a left-early run (`abandoned: true`), a timed-out run (`timedOut: true`), computes `words` from `meta.elapsedMs` and `wpm` (for example wpm 30, elapsedMs 120000 gives 60), falls back to `firstTryCorrect / accuracy`, and gives 0 for a run with no meta; a run that crosses midnight is on its first stroke's local date; both range edges are inclusive; `timingsInRange` returns only finished, non-abandoned runs' strokes in order and nothing for the others; `keyRowsInRange` groups identical strokes (three identical misses give one row with `n: 3`) and includes left-early runs; `allTimeStrokes` counts all strokes; swapped or malformed dates throw the same `RangeError` as `dayStats`; an empty database returns empty lists.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the four methods (prepared statements once, like the rest of `openArchive`).
- [ ] **Step 4: Run the file, `npm test`, typecheck, build; green.** Mutation-check the words fallback and the abandoned filter and restore.
- [ ] **Step 5: Commit** `feat: archive reads for the progress stats`.

---

### Task 3: Key statistics and mix-ups (pure)

**Files:**
- Create: `src/core/keystats.ts`, `tests/core/keystats.test.ts`
- Modify: `src/core/review.ts` (export `nearestStroke`; no behavior change), `tests/core/review.test.ts` only if an export test is needed

**Interfaces:**
- Consumes: `nearestStroke(expected: readonly string[], pressed: SlotMask): SlotMask | null` from `./review.ts` (now exported), `maskToSlots`, `Slot`, `SlotMask` from `./steno.ts`.
- Produces: `type KeyStat = { slot: Slot; required: number; missed: number }`, `type Mixup = { pressed: Slot; needed: Slot; count: number }`, `type KeyRowInput = { expected: readonly string[]; pressedMask: number; correct: boolean; n: number }`, `keyStats(rows: readonly KeyRowInput[]): { keys: KeyStat[]; mixups: Mixup[] }`.

Rules (R4, spec panels 6 and 7): for each row (weight `n`), the needed stroke is `nearestStroke(expected, pressedMask)` (for a correct row it equals the pressed mask; skip a row where it is `null`); every slot in the needed stroke gets `required += n`, and `missed += n` when the stroke was not correct and that slot was not pressed; a mix-up is counted (weight `n`) only when exactly one pressed slot was not needed and exactly one needed slot was not pressed, as `{ pressed: the extra slot, needed: the missing slot }`; `keys` lists every slot with `required > 0` in the board's slot order (`SLOTS`); `mixups` sorted by count descending, then pressed, then needed (plain string order). Ranking thresholds (30 required presses; 3 occurrences) are applied by the page, not here.

- [ ] **Step 1: Failing tests:** a correct stroke adds `required` for each of its slots and no `missed`; a miss that pressed `-P` instead of `-B` (expected `-B`-bearing stroke, one extra one missing) gives `required` +1 and `missed` +1 on `-B` only, and a mix-up `{ pressed: '-P', needed: '-B', count: n }`; a miss with two extra keys is not a mix-up but still counts `missed` for the missing key; a miss with a missing key and no extra key is not a mix-up; weights multiply (`n: 3`); a multi-outline `expected` picks the nearest accepted stroke (as `review.test.ts` does); an unparseable outline in `expected` does not throw (that row is skipped); sorting and slot order are deterministic; empty input gives empty output; export of `nearestStroke` leaves the Misses table tests green.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** Mutation-check the one-for-one rule and the weighting.
- [ ] **Step 4: `npm test`, typecheck, build; green.**
- [ ] **Step 5: Commit** `feat: key statistics and mix-ups`.

---

### Task 4: The stats builder, route and client call

**Files:**
- Create: `server/stats.ts`, `tests/server/stats.test.ts`
- Modify: `server/server.ts` (route), `src/api.ts` (client call), `tests/server/server.test.ts` (route tests), `tests/api.test.ts`

**Interfaces:**
- Consumes: Task 2 archive methods, Task 1 `runRhythm`, Task 3 `keyStats`.
- Produces (exported from `server/stats.ts`, importable type-only by the client):
  - `type StatsMode = 'free' | 'drills' | 'all'` (`free` is mode `free`; `drills` is `stage0`, `section`, `chapter-test`; `all` is every mode)
  - `type DayQuality = { date: string; runs: number; words: number; wpm: number | null; accuracy: number | null; steadiness: number | null }` (one entry for each local date in the range that has at least one finished, non-abandoned run in the chosen mode; `wpm` and `accuracy` are the mean of the runs' values weighted by their `words` (R1), `null` when the day's total words is 0; `steadiness` is the median of the runs' non-null steadiness, `null` when none)
  - `type StatsResponse = { from: string; to: string; mode: StatsMode; days: DayQuality[]; keys: KeyStat[]; mixups: Mixup[]; allTimeStrokes: number }` (`keys` and `mixups` always cover every mode, per C10)
  - `buildStats(archive: Archive, q: { from: string; to: string; mode: StatsMode }): StatsResponse`
  - Route `GET /api/stats?from=YYYY-MM-DD&to=YYYY-MM-DD&mode=free|drills|all` (default `mode` is `free`; unknown mode, malformed or swapped dates, or a span over 1,100 days answer 400 like `/api/days`; method other than GET answers 405 with `Allow: GET`; with no database it answers the empty response (`days: []`, `keys: []`, `mixups: []`, `allTimeStrokes: 0`) and creates no file). Client: `getStats(from: string, to: string, mode: StatsMode, fetchFn?)` in `src/api.ts` (same error style as `getDays`).

- [ ] **Step 1: Failing tests:** `buildStats` on a fixture archive: free-mode filter excludes `section` runs from `days` while `keys` still counts them (C10); `drills` includes `stage0`, `section` and `chapter-test`; left-early and unfinished runs never appear in `days`; weighting: two runs the same day (wpm 10 over 20 words, wpm 20 over 60 words) give `wpm` 17.5; `accuracy` weighted the same way; `steadiness` is the median over the day's runs; a run with a steadiness of `null` is ignored; a day whose only run has 0 words has `wpm: null`; `allTimeStrokes` counts every stroke regardless of the range; route tests (follow `/api/days` tests): 200 shape, default mode, 400 for bad mode, bad date, swapped dates, span over 1,100 days, 405 for POST with `Allow`, empty response and no file created when there is no database; a performance test builds an archive with about 200,000 strokes over 600 days (generate in a transaction; keep the fixture build fast) and asserts `buildStats` over the whole range answers in under 1,500 ms and that the response JSON is under 200 KB.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** `buildStats` (group the Task 2 rows by run and day; call `runRhythm` once per finished run from `timingsInRange`; call `keyStats` on `keyRowsInRange`), the route, and `getStats`.
- [ ] **Step 4: `npm test`, typecheck, build; green. Report the measured time of the 200,000-stroke case.**
- [ ] **Step 5: Commit** `feat: the progress stats route`.

---

### Task 5: Progress view helpers (pure)

**Files:**
- Create: `src/core/progressview.ts`, `tests/core/progressview.test.ts`
- Modify: `src/core/days.ts` (add `longestStreak`), `tests/core/days.test.ts`

**Interfaces:**
- Consumes: `addDays`, `localDate`, `currentStreak` from `./days.ts`.
- Produces: `longestStreak(activeDates: ReadonlySet<string>): number` (in `days.ts`); and in `progressview.ts`: `weekStart(date: string): string` (the Monday of the week of a YYYY-MM-DD date, as a date string), `weeksOf(days: readonly DayStat[], from: string, to: string): { start: string; activeMs: number; strokes: number }[]` (every Monday-week from the week of `from` to the week of `to`, zero-filled, ascending), `movingAverage(points: readonly { date: string; value: number }[], windowDays: number): { date: string; value: number }[]` (for each practiced day, the mean of the practiced days' values in the trailing `windowDays` calendar days, including the day itself), `enough(runs: number): boolean` (`runs >= 3`), `change(now: number | null, before: number | null): number | null` (`null` when either side is `null`), `RANGES` (`{ id: '4w' | '3m' | 'all'; label: string; days: number | null }[]` for 4 weeks (28), 3 months (91), all time (1,100 days back)), `rangeBounds(range: '4w' | '3m' | 'all', today: string): { from: string; to: string }`.

- [ ] **Step 1: Failing tests:** `longestStreak` on gaps, an empty set, a single day, ties, and consecutive days across a month and year end; `weekStart` for a Monday, a Sunday (belongs to the week that started six days earlier), month and year boundaries and a leap day; `weeksOf` zero-fills weeks with no practice, sums days into the right week, includes the partial current week and orders ascending; `movingAverage` for one point, a gap longer than the window (the earlier points do not count), unsorted input is sorted, and values stay finite; `change` null handling; `rangeBounds('4w', '2026-10-28')` gives `2026-10-01` to `2026-10-28` (28 days inclusive), and is stable across a DST date; none of these functions read the clock.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** Mutation-check the Sunday rule and the moving-average window.
- [ ] **Step 4: `npm test`, typecheck, build; green.**
- [ ] **Step 5: Commit** `feat: week, trend and streak helpers`.

---

### Task 6: The Progress tab, its shell and the headline tiles

**Files:**
- Create: `src/ui/Progress.tsx`, `src/ui/progress/Tiles.tsx`, `src/ui/progress.css`, `tests/ui/Progress.test.tsx`
- Modify: `src/router.ts` (route `{ name: 'progress' }`, `/progress`, tab `'progress'`), `src/ui/TopBar.tsx` (tab `Progress` between Days and Journal), `src/ui/App.tsx` (render), `tests/router.test.ts`, `tests/ui/TopBar.test.tsx`

**Interfaces:**
- Consumes: Task 4 `getStats`/`StatsResponse`/`StatsMode`, existing `getDays` and `DayStat`, Task 5 helpers, `localDate` from `src/core/days.ts`.
- Produces: `Progress()`: header with the range switch (`4 weeks` default, `3 months`, `All time`) and the mode switch (`Free type` default, `Drills and tests`, `Everything`) as two groups of buttons with `aria-pressed`; it loads `getStats` and `getDays` for the chosen range (the days over a span that always covers the current and the previous Monday-week plus the range) with a live flag, states `Loading…` and `Couldn't load your progress.` + `Try again`, and `No practice recorded yet.` when there are no days at all. A shared hook `useProgressData(range, mode)` returns `{ status, stats, days, today, range, mode }` for the panel components of Tasks 7 to 9. `Tiles` (panel 1): `This week` practice time (`formatDuration` from `src/core/days.ts`), `Strokes this week` with the all-time count beneath, `Free-type 7-day average` (label follows the mode: `Drills and tests 7-day average`, `7-day average`) in wpm with one decimal, and `First-try accuracy` with the stored-accuracy average, each with its change against last week as text (`+1 h 25 m vs last week`, shown only when both weeks have data, else nothing); a tile that rests on fewer than 3 runs in its window shows `—` and `not enough data yet`. The route is `/progress`.

- [ ] **Step 1: Failing tests:** route parsing and tab mapping (`/progress` is the `progress` tab; `/progress/` too; the TopBar shows six tabs in the order Book, Practice, History, Days, Progress, Journal and marks the current one); `Progress` with stubbed `fetch` for `/api/stats` and `/api/days`: the default request is the last 28 days with `mode=free`; clicking `3 months` or `Everything` refetches with the new bounds and mode and shows `aria-pressed` correctly; tile values for a fixture (this week 4 h 36 m, 11,284 strokes, 48,902 all time, 15.4 wpm, 94.6%); a change line appears only with data in both weeks; a tile with fewer than 3 runs shows `—` and `not enough data yet`; loading, failure with `Try again` (refetches), empty state; a late response after unmount or after a newer switch does not overwrite (live flag; test with deferred promises); mocked `Date` does not leak (use an injectable `today` or fake timers restored in `afterEach`).
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the route, tab, `Progress`, `useProgressData`, `Tiles`, CSS (tokens only).
- [ ] **Step 4: `npm test`, typecheck, build; green.** Mutation-check the stale-response guard and the 3-run rule.
- [ ] **Step 5: Commit** `feat: the Progress tab and its headline tiles`.

---

### Task 7: The day charts, accuracy and consistency, and weekly bars

**Files:**
- Create: `src/ui/progress/Chart.tsx` (small shared SVG helpers: axes, scales, a text table component), `src/ui/progress/WpmByDay.tsx`, `src/ui/progress/AccuracyConsistency.tsx`, `src/ui/progress/WeeklyBars.tsx`, tests under `tests/ui/progress/`
- Modify: `src/ui/Progress.tsx`, `src/ui/progress.css`

**Interfaces:**
- Consumes: the data from `useProgressData` (Task 6), `movingAverage`, `weeksOf`, `enough` (Task 5).
- Produces (panels 2, 3 and 5): `WpmByDay` (one dot per day in `stats.days` with a non-null `wpm`, a connecting line, a dashed 7-day trend line only with at least 3 practiced days, a y-axis starting at 0, the best day named in text); `AccuracyConsistency` (first-try accuracy line in percent and day steadiness bars from `stats.days`, with the day-to-day band: for the last 14 days the min-to-max of the daily value as a shaded band, only with at least 5 days); `WeeklyBars` (Monday-weeks from `weeksOf` over the range, bars of practice time with strokes as a label under each, the current week drawn lighter and labelled `so far`; titled `all modes`). Each panel shows its title, a one-line plain-words explanation of what it measures, the chart, and a `<details>` or table with the numbers behind it; each dot or bar is focusable (`tabindex="0"`) with a text label (`Oct 23: 14.0 wpm over 3 runs`) as `aria-label` and a visible tooltip on hover or focus. Empty or under 3 runs: a dash and `not enough data yet`, no chart.

- [ ] **Step 1: Failing tests** (render with fixture data): the points and their coordinates scale with values and start the y-axis at 0; one practiced day draws one dot, no line, no trend; two days draw a line, no trend; three days draw the trend; days with `wpm: null` are skipped; all-equal values draw a flat line without NaN coordinates; an outlier does not squash the axis to nothing (axis max is the data max rounded up); the table behind each chart lists the same numbers as the picture (same row count and values); focus reaches each dot and bar and its label reads as the example above; the best day is named; the current week bar is labelled `so far`; weekly bars zero-fill empty weeks; fewer than 3 runs shows the dash text; no NaN or Infinity appears in any `d`, `points`, `cx`, `cy`, `x`, `y`, `height` or `width` attribute for any fixture (assert by scanning rendered attributes for `NaN` and `Infinity`).
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the helpers and the three panels (tokens only; no chart library).
- [ ] **Step 4: `npm test`, typecheck, build; green.** Mutation-check the zero-based axis, the 3-day trend rule and the NaN guard.
- [ ] **Step 5: Commit** `feat: wpm by day, accuracy and consistency, weekly bars`.

---

### Task 8: Heatmap and streaks, weakest keys, mix-ups, chapter ladder

**Files:**
- Create: `src/ui/progress/Heatmap.tsx`, `src/ui/progress/WeakKeys.tsx`, `src/ui/progress/Mixups.tsx`, `src/ui/progress/Ladder.tsx`, tests under `tests/ui/progress/`
- Modify: `src/ui/Board.tsx` and `src/ui/board.css` (an optional `heat?: Partial<Record<Slot, number>>` prop, 0 to 1, drawing a token-coloured overlay per slot; the existing prop combinations render exactly as before, covered by the existing Board tests staying unchanged and green), `src/ui/Progress.tsx`, `src/ui/progress.css`

**Interfaces:**
- Consumes: `stats.keys`, `stats.mixups`, `useProgressData` days, `longestStreak` and `currentStreak` (`days.ts`), `useProgress()` (`chapters`, `results`) from `src/state/progress.tsx`, existing `levelOf` shading steps of `Days.tsx` (extract the function to `src/core/days.ts` as `dayLevel(activeMs)` if needed, keeping the Days tests green).
- Produces: `Heatmap` (panel 9: the last 52 Monday-weeks as a grid of cells with `data-level` shading and an `aria-label` per cell, plus `Current streak: N days` and `Longest streak: N days`; titled `all modes`; the days come from a 365-day `getDays` the page requests regardless of the range); `WeakKeys` (panel 6: the `Board` with `heat` set from `missed / required` for every key with at least 30 required presses, and a list of the worst five with their percentage and counts; below the threshold `not enough data yet`; titled `all modes`); `Mixups` (panel 7: the top eight pairs with at least 3 occurrences as `-P instead of -B · 9 times`, else `no repeated mix-ups yet`); `Ladder` (panel 8: one row per chapter with a test (gate `test` or `stage0` in `useProgress().chapters`), the best result (accuracy first, then wpm, as `sectionResults` ranks) against the pass mark with the words `met` or `not yet` and the same `formatWpm`/`formatAccuracy` rounding rules as the chapter panels; chapters with no attempt show `not tried yet`; ignores the mode switch and says so in its title).

- [ ] **Step 1: Failing tests:** heatmap grid has 52 columns by 7 rows with a leading blank for the first day's weekday, shading steps match the Days tab for the same practice time, a day without practice is level 0, streaks match `currentStreak` and `longestStreak`; weak keys: only keys with at least 30 required presses are shaded and listed, the worst five are sorted by percentage then required count, a key at 0% is not listed, `heat` values are in 0..1; `Board` with no `heat` prop renders exactly the same DOM as before (snapshot-free: assert the same class lists and attributes on every cell for a fixed prop set) and with `heat` adds an overlay only on the keys given; mix-ups threshold and formatting, ordering, the `no repeated mix-ups yet` state; ladder rows for stage0 and test chapters only, `met`/`not yet` wording with the pass mark, `not tried yet`, rounding next to a mark follows `formatWpm`/`formatAccuracy` (a 9.96 wpm result against a 10 wpm mark shows `9.9 wpm` and `not yet`); every panel has its table or list equivalent and no `NaN` attributes.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`, typecheck, build; green.** Mutation-check the 30-press and 3-occurrence thresholds and the Board no-heat equivalence.
- [ ] **Step 5: Commit** `feat: heatmap, weak keys, mix-ups and the chapter ladder`.

---

### Task 9: Rhythm on the Progress page and on every run in History

**Files:**
- Create: `src/ui/progress/RhythmView.tsx`, `src/ui/progress/RhythmPanel.tsx`, tests under `tests/ui/progress/`
- Modify: `src/ui/TestDetail.tsx` (a `Rhythm` section), `src/ui/Progress.tsx`, `src/ui/progress.css`, `tests/ui/TestDetail.test.tsx`

**Interfaces:**
- Consumes: Task 1 `runRhythm`, `quarterWpm`, `RHYTHM_DEFAULTS`; existing `getTest(id)` and `listTests({ limit })` from `src/api.ts`; a run's `wpm`, `accuracy`, `meta`.
- Produces: `RhythmView({ test, strokes })` (shared): the four figures (`Steadiness` as `78 / 100` with the plain-words meaning, `Stalls`, `Typical gap` in seconds with two decimals, `Start vs finish` as the wpm difference of the last quarter against the first, shown only when both are known), the stroke strip (one bar per stroke in order, height by gap on a scale capped so a break does not flatten the rest, stalls drawn red with the word `stall` in the label, breaks drawn as a dotted marker, the dashed typical-gap line), the quarters bars (estimated wpm, labelled `estimated`, with the run's stored wpm shown beside them, R2), and a table equivalent (stroke number, gap, kind); each bar focusable with an `aria-label` like `Stroke 14: 3.2 s pause, stall`; `not enough strokes to show rhythm` when `steadiness` is `null` and the run has fewer than 10 gaps (the strip may still be drawn). `RhythmPanel` (panel 4): a run picker listing the 20 latest finished, non-abandoned runs of the current mode (label: date, mode/section, wpm) defaulting to the newest, loading its strokes with `getTest` (live-flag guarded; a failure shows `Couldn't load this run.` + `Try again`), rendering `RhythmView`; with no run: `No finished run yet.`. `TestDetail` shows the same `RhythmView` section under the stats for a finished, non-abandoned run that has strokes (a left-early or unfinished run shows `Rhythm is shown for finished runs.`).

- [ ] **Step 1: Failing tests:** `RhythmView` with a fixture of 60 even strokes shows steadiness at least 95, zero stalls, a typical gap of `0.60 s`; with one 4 s gap shows one stall, the red marker's label contains `stall` and the strip has one bar per stroke; a break shows the dotted marker and is not counted as a stall; fewer than 10 gaps shows `not enough strokes to show rhythm`; quarters bars are four, labelled `estimated`, with the stored wpm shown; the table equivalent has one row per stroke; bars are focusable with the label format above; no `NaN` attributes; `RhythmPanel`: defaults to the newest run, the picker lists at most 20 runs and refetches strokes when another is picked, a late response from the previous pick does not overwrite (deferred promises), failure and retry, empty state; the Progress page renders the panel in the Task 7 layout; `TestDetail` shows `Rhythm` for a finished run and the note for a left-early run, and the existing TestDetail tests stay green unchanged.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`, typecheck, build; green.** Mutation-check the stall marker, the break handling and the stale-pick guard.
- [ ] **Step 5: Commit** `feat: rhythm on the Progress page and in History`.

---

### Task 10: Docs and the end-to-end check

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-27-lapwing-lab-design.md` (§4.4, §9, §11, a short "Amended by M6" sentence each), `docs/superpowers/specs/2026-10-28-lapwing-lab-m6-progress-design.md` (record R1 to R5 as a short section "Rulings made while planning M6a", and amend C11, C13 and C18 with a one-line pointer to R1, R2 and R3), `docs/superpowers/m0-m1-followups.md` (a `## Left open by M6a` section from the controller's deferred minors)
- Create: `docs/superpowers/m6a-checklist.md`

- [ ] **Step 1: README:** the Progress tab (six tabs now), the two switches and what each changes (C10), each panel in a line (what it measures, in plain words), rhythm definitions (gap, stall, break, steadiness, estimated quarters), where each number comes from, that nothing is written, that left-early runs count toward time and strokes only, the `not enough data yet` rule, and the `/api/stats` route. Every claim must be verifiable from the code or tests; use the real test count.
- [ ] **Step 2: `m6a-checklist.md`:** second person, numbered, one action and expected result each: the Progress tab opens and shows your real recent days; free-type wpm by day matches what History shows for a day you remember; switching mode and range refetches and changes only the panels C10 says; the tiles agree with the Days tab for the same week (time and strokes); open any run in History and see its Rhythm; the strip's tallest red bar is the pause you remember; weakest keys lights the keys you know you miss; mix-ups match the Misses table; the ladder agrees with the chapter panels; the heatmap matches the Days month; keyboard Tab reaches the dots and the table equivalents; the narrow window; a fresh, empty archive shows the empty states (use a copy of `data` in a scratch folder: do NOT delete the owner's data). Say honestly what could not be tested without a real browser and real history.
- [ ] **Step 3: Verify:** `npm test`, `npm run typecheck`, `npm run build` green. Then run `NO_OPEN=1 PORT=5804 node server/main.ts` in the background (PID saved under the scratchpad directory), record `ls -la data` before, GET only `/`, `/api/health`, `/api/stats?from=<28 days ago>&to=<today>&mode=free` (200, JSON with `days`, `keys`, `mixups`, `allTimeStrokes`), `/api/stats?mode=bad` (400), `/api/days?...` (200), `/progress` (200, the app shell); stop the server with `kill <pid>` (never `pkill -f`); confirm `ls -la data` is unchanged and no file was created. Do not read the contents of `data/`.
- [ ] **Step 4: Commit** `docs: M6a readme and real-history checklist`.
