# Lapwing Lab M2 — The Lab Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the lab's tabs (Practice with free type, History, Days with streak, Journal with result-card notes) on top of the M0+M1 reader and drills, and stop abandoned drills from writing ghost rows.

**Architecture:** Same stack as M0+M1. The server gains read routes over the existing SQLite archive (test list, test detail, per-day totals) and plain-markdown journal files under `data/journal/`. The client gains a top bar, five route families, and a `flow` view plus time limit on the existing `Drill` component, so free type reuses the one judging/logging engine instead of a second one.

**Tech Stack:** Node 26 (`node:sqlite`, runs `.ts` directly), Preact 11 + Vite, TypeScript, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-27-lapwing-lab-design.md` — §3.5 (lab tabs), §3.6 (practice time), §4.4, §4.5, §9 (M2). Prior work: `docs/superpowers/plans/2026-10-27-lapwing-lab-m0-m1.md`, `docs/superpowers/m0-m1-followups.md`.

## Global Constraints

- Offline and private: the server listens on `127.0.0.1` only; no network calls, no new runtime dependencies (Preact only), no new dev dependencies.
- Data lives under `data/`, created lazily: **no read path may create** `data/`, `data/steno.db` or `data/journal/`. Only a write creates them.
- Never send strokes to Plover, type text, or touch Plover's config. The board is read only.
- The drill stays prompt-first; the board-visibility setting (`always` / `hover` / `hidden`) is honored everywhere a board can appear.
- Dates are local calendar days written `YYYY-MM-DD`; weeks start on Monday; times are 24-hour `HH:MM`.
- Style: follow the surrounding code (no semicolons, single quotes, 2-space indent, `.ts` import suffixes, type-only imports from `server/` in client code). Colors come from the `:root` tokens in `src/ui/reader.css`; calm and dark; no emoji in UI text.
- Preact 11 defers `useEffect` cleanup; use `useLayoutEffect` for any subscription or flush that must run synchronously at unmount.
- Every commit leaves `npm test`, `npm run typecheck` and `npm run build` green.
- Branch: `m2-lab-shell` (off `m0-m1`). Do not push, merge or delete branches.

## Review Focus

Inputs and conditions the spec implies but that most easily break, most likely first. Each has a test in the task named:

1. Opening a drill and leaving without a stroke leaves no rows; old empty tests are never listed (Tasks 1, 2).
2. Leaving a drill mid-way keeps its strokes and closes the test as a partial, abandoned result — no unfinished row from a normal exit (Task 1).
3. Journal dates and paths: `../x`, `2026-02-30`, `2026-1-1` are refused and nothing is written outside `data/journal/`; reading never creates files (Tasks 3, 4).
4. Day boundaries: a test whose first stroke is just after local midnight belongs to the new day; the streak counts from yesterday while today is still empty (Tasks 2, 5).
5. The journal editor never loses text: a failed load never allows a save over the existing note; a failed save keeps the text and retries; switching days saves each day's text to its own file (Task 12).

---

### Task 1: Lazy logging and finish-on-exit

**Files:**
- Modify: `src/ui/Drill.tsx`
- Modify: `tests/ui/Drill.test.tsx` (the existing test "calls logger.start once with the test fields…" at ~line 555 changes meaning)

**Interfaces:**
- Consumes: `TestLogger` from `src/api.ts` (`start`, `stroke`, `finish`, `onUnsaved`) — unchanged.
- Produces (behavior of `Drill`): `logger.start(...)` is called at most once, immediately before the first `logger.stroke(...)`, on the first *judged* stroke (not an undo, not an ignored lone star). `logger.finish(...)` is called at most once: on completion exactly as today, or when the Drill unmounts with at least one stroke logged and the drill not done, with `{ wpm: stats.wpm, accuracy: stats.accuracy, meta }` where `meta = { kind, itemCount, completed, firstTryCorrect, elapsedMs, passed: null, abandoned: true }`. A drill with zero items still reports `onDone` at mount and never touches the logger.

- [ ] **Step 1: Write the failing tests** (in `tests/ui/Drill.test.tsx`, using its `fakeLogger`/`mountDrill` rig):
  - `does not start the logger when mounted` — `logger.starts` is empty after mount.
  - `starts the logger on the first judged stroke, once, before logging it` — after one stroke: `starts` has one entry equal to `{ mode, chapter, section, itemCount }`, and it was recorded before `strokes[0]`; a second stroke does not add a start.
  - `an ignored lone star does not start the test`.
  - `exiting before any stroke writes nothing` — click Exit: no starts, no finishes.
  - `exiting after strokes finishes the test as abandoned with its partial stats` — one correct stroke of a 2-item drill, then Exit: exactly one finish with `meta` matching `{ abandoned: true, completed: 1, itemCount: 2, passed: null }` and numeric `wpm`/`accuracy` (`accuracy` between 0 and 1).
  - `completing the drill finishes once and unmounting afterwards does not finish again`.
  - Rewrite the old start-on-mount test as: input is accepted while `start` is still pending (`startPending`), and `starts` has one entry after the first stroke.
- [ ] **Step 2: Run** `npx vitest run tests/ui/Drill.test.tsx` — the new tests fail.
- [ ] **Step 3: Implement in `Drill.tsx`:** remove the start call from the mount path; keep a `started` ref and call `void logger.start({ ...latest.current.logTest, itemCount: items.length }).catch(() => {})` right before `logger.stroke` the first time; in the layout-effect cleanup, if `started.current && !done.current`, call `void logger.finish({...}).catch(() => {})` with the abandoned meta (compute stats from `session.stats()`; set `done.current = true` first so no stroke can follow).
- [ ] **Step 4: Run** `npm test && npm run typecheck` — all green.
- [ ] **Step 5: Commit** `fix: log a drill from its first stroke and close early exits as abandoned`.

### Task 2: Archive reads for History and Days

**Files:**
- Modify: `server/archive.ts`
- Modify: `tests/server/archive.test.ts`

**Interfaces:**
- Produces (exported from `server/archive.ts`):
  ```ts
  export type TestSummary = TestRow & { strokeCount: number; firstStrokeAt: number; lastStrokeAt: number }
  export type DayStat = { date: string; tests: number; strokes: number; activeMs: number }
  // added to Archive:
  listTests(q: { limit: number; beforeId?: number; date?: string }): TestSummary[]
  getTest(id: number): { test: TestRow; strokes: StrokeRecord[] } | undefined
  dayStats(from: string, to: string): DayStat[]
  ```
- Semantics: a test with no strokes never appears in `listTests` or `dayStats`. `listTests` is newest first by `id DESC`; `beforeId` means `id < beforeId`; `date` (`YYYY-MM-DD`) keeps tests whose **first stroke's local date** equals it; `limit` must be an integer 1–200 (else `RangeError`). `dayStats` is inclusive of both ends, ascending by date, omits days with no strokes; `date` is the local date of each test's first stroke (SQLite `date(ms/1000, 'unixepoch', 'localtime')`); `tests` counts tests, `strokes` sums strokes, `activeMs` sums (last stroke − first stroke) per test (spec §3.6).

- [ ] **Step 1: Write the failing tests** (build timestamps with `new Date(2026, 9, 27, h, m).getTime()` so they are timezone-independent):
  - `listTests hides tests that have no strokes` (one started-only test, one with a stroke).
  - `listTests is newest first and pages with beforeId`.
  - `listTests includes an unfinished test with its stroke count and null wpm`.
  - `listTests date filter uses the local day of the first stroke` — test started 23:58 on the 26th with first stroke 00:02 on the 27th is listed for `2026-10-27`, not `2026-10-26`.
  - `listTests rejects a limit of 0 and 201`.
  - `getTest returns strokes in insertion order, and undefined for an unknown id`.
  - `dayStats groups by local day, sums, omits empty days, and includes both ends`.
  - `dayStats activeMs is last minus first stroke; a one-stroke test counts as a test with 0 ms`.
- [ ] **Step 2: Run** `npx vitest run tests/server/archive.test.ts` — fails.
- [ ] **Step 3: Implement** the three methods with prepared statements; reuse `toTest`/`toStroke`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** `feat: archive reads for test history and per-day totals`.

### Task 3: Journal storage

**Files:**
- Create: `server/journal.ts`
- Create: `tests/server/journal.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function isJournalDate(s: string): boolean            // YYYY-MM-DD and a real calendar date
  export function readEntry(dir: string, date: string): string // '' when the file or folder is missing
  export function writeEntry(dir: string, date: string, text: string): void
  export function appendEntry(dir: string, date: string, block: string): string // returns the new full text
  export function listEntries(dir: string): { date: string; chars: number }[]   // newest first, non-blank entries only
  ```
- Semantics: an invalid date throws `RangeError` before any filesystem access (including in `readEntry`). Files are `<dir>/<date>.md`. `writeEntry` creates `dir`, writes a temp file then renames, and removes the temp file if the rename fails. `appendEntry`: existing text with trailing whitespace trimmed, then a blank line, then `block` trimmed, then `\n`; an empty or missing file gets just `block` trimmed + `\n`. `listEntries` ignores any file not named `YYYY-MM-DD.md`; a missing folder gives `[]`; `chars` is the text length.

- [ ] **Step 1: Write the failing tests** (temp dirs):
  - `isJournalDate` accepts `2026-10-27` and leap day `2028-02-29`; refuses `2026-02-29`, `2026-13-01`, `2026-1-1`, `20261027`, `../2026-10-27`, `2026-10-27/x`, `''`.
  - `readEntry` on a missing folder returns `''` and does not create the folder.
  - write → read round-trips Unicode and `\r\n` unchanged; leaves no `.tmp` file; creates the folder.
  - `appendEntry` formatting for empty and non-empty files (exact strings), and returns the new text.
  - `listEntries` sorts newest first, skips blank entries and non-matching files (`x.bak`, `2026-10-27.md.tmp`), and returns `[]` for a missing folder.
  - Every function throws `RangeError` for `../x`.
- [ ] **Step 2: Run** `npx vitest run tests/server/journal.test.ts` — fails.
- [ ] **Step 3: Implement** `server/journal.ts` (sync `node:fs`).
- [ ] **Step 4: Run** `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** `feat: journal storage as one markdown file per day`.

### Task 4: HTTP routes for history, days and journal

**Files:**
- Modify: `server/server.ts` (`ApiContext` gains `journalDir`, set to `join(dataDir, 'journal')`)
- Modify: `tests/server/server.test.ts` (new `describe('lab routes')`, seeding through the existing POST routes)

**Interfaces:**
- Consumes: `Archive.listTests/getTest/dayStats` (Task 2), `server/journal.ts` (Task 3).
- Produces (all JSON; all reads use `existingArchive()` and never create files):
  ```
  GET  /api/tests?limit=&beforeId=&date=      -> TestSummary[]   (limit default 50, max 200; [] when no archive yet)
  GET  /api/tests/:id                         -> { test: TestRow, strokes: StrokeRecord[] }   (404 if unknown)
  GET  /api/days?from=YYYY-MM-DD&to=YYYY-MM-DD -> DayStat[]      (both required, valid dates, from <= to, span <= 800 days; else 400)
  GET  /api/journal                           -> { date, chars }[]
  GET  /api/journal/:date                     -> { date, text }
  PUT  /api/journal/:date    { text: string } -> { date, text }  (text may be '' but at most 200000 chars)
  POST /api/journal/:date/append { text }     -> { date, text }  (text non-blank, at most 200000 chars)
  ```
  Existing `POST /api/tests`, `/api/tests/last` and `/api/tests/:id/(strokes|finish)` behave exactly as before (`/api/tests/last` stays ahead of `/api/tests/:id`). Wrong methods answer 405 with an `allow` header; bad parameters 400; an invalid journal date 400.

- [ ] **Step 1: Write the failing tests:**
  - On a fresh data dir, `GET /api/tests`, `/api/days?...`, `/api/journal`, `/api/journal/2026-10-27` answer with empty results and `data/` still does not exist.
  - `GET /api/tests` lists seeded tests newest first; honors `limit`, `beforeId`, `date`; `limit=0`, `limit=abc`, `date=2026-02-30` give 400.
  - `GET /api/tests/:id` returns strokes; unknown id 404; `/api/tests/last` still works.
  - `/api/days` requires both params, rejects `from > to` and a span over 800 days (400), and returns seeded totals.
  - Journal: PUT then GET round-trips; append adds a stamped block and returns full text; list shows the date; `PUT {text: 5}` 400; blank append 400; over-long text 400; invalid date 400; `GET /api/journal/..%2Fsettings` is never 200 and nothing is written outside `data/journal/`; `DELETE /api/journal/2026-10-27` is 405 with `allow`.
- [ ] **Step 2: Run** `npx vitest run tests/server/server.test.ts` — fails.
- [ ] **Step 3: Implement** the routes in `route()`, reusing `asObject`, `bad`, `allow`; add a `journalText(o)` helper (string, length-capped, may be empty) and a date-param helper using `isJournalDate`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** `feat: routes for test history, per-day totals and the journal`.

### Task 5: Client data layer and date helpers

**Files:**
- Modify: `src/api.ts`
- Create: `src/core/days.ts`
- Create: `tests/core/days.test.ts`
- Modify: `tests/api.test.ts`

**Interfaces:**
- Consumes: Task 4 routes; types `TestSummary`, `DayStat`, `TestRow`, `StrokeRecord` (type-only imports from `server/archive.ts`).
- Produces in `src/api.ts` (each takes an optional trailing `fetchFn` like the existing ones; all **reject** on failure so views can show an error line; `request` now throws `HttpStatusError` with a numeric `status`, other callers unchanged):
  ```ts
  listTests(q?: { limit?: number; beforeId?: number; date?: string }): Promise<TestSummary[]>
  getTest(id: number): Promise<{ test: TestRow; strokes: StrokeRecord[] } | null>   // null on 404
  getDays(from: string, to: string): Promise<DayStat[]>
  listJournal(): Promise<{ date: string; chars: number }[]>
  getJournal(date: string): Promise<string>
  putJournal(date: string, text: string): Promise<void>
  appendJournal(date: string, text: string): Promise<void>
  ```
- Produces in `src/core/days.ts`:
  ```ts
  export function localDate(ms: number): string
  export function addDays(date: string, n: number): string          // DST-proof (compute at local noon)
  export function currentStreak(activeDates: ReadonlySet<string>, today: string): number
  export function monthWeeks(year: number, month: number): (string | null)[][]   // month 1-12; Monday first; null pads; rows of 7
  export function formatDuration(ms: number): string                // '<1 min', '12 min', '1 h 05 min'
  export function dayLabel(date: string): string                    // 'Tue 27 Oct 2026'
  ```
  `currentStreak`: consecutive active days ending today; if today is not active, ending yesterday; 0 if neither.

- [ ] **Step 1: Write the failing tests:**
  - `days.test.ts`: `localDate` of local `00:00:00.000` and `23:59:59.999` gives that day; `addDays('2026-03-01', -1)` is `2026-02-28`, `addDays('2026-12-31', 1)` is `2027-01-01`; `currentStreak` for today active (3 days), today empty but yesterday active, neither, a gap breaking the run, and an empty set; `monthWeeks(2026, 10)` has 5 rows of 7, starts with three `null` then `2026-10-01` (a Thursday), ends with `2026-10-31` then one `null`; `formatDuration(0)` `<1 min`, `45 s`→`<1 min`, `12 * 60000`→`12 min`, `65 * 60000`→`1 h 05 min`; `dayLabel('2026-10-27')` is `Tue 27 Oct 2026`.
  - `api.test.ts`: each new call builds the right URL/method/body (use the existing fake `fetchFn` pattern); `getTest` returns `null` on 404 and rejects on 500; `putJournal` rejects on a non-2xx.
- [ ] **Step 2: Run** `npx vitest run tests/core/days.test.ts tests/api.test.ts` — fails.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** `feat: client calls for history and journal, and local-date helpers`.

### Task 6: Tab shell and routes

**Files:**
- Modify: `src/router.ts`, `src/ui/App.tsx`, `src/ui/reader.css`
- Create: `src/ui/TopBar.tsx`, `tests/router.test.ts`, `tests/ui/TopBar.test.tsx`

**Interfaces:**
- Produces in `router.ts`:
  ```ts
  export type Route =
    | { name: 'page'; id: string } | { name: 'drill'; id: string }
    | { name: 'practice' } | { name: 'free'; source: string; mode: string }
    | { name: 'history' } | { name: 'test'; id: number }
    | { name: 'days'; date?: string } | { name: 'journal'; date?: string }
    | { name: 'notfound' }
  export type Tab = 'book' | 'practice' | 'history' | 'days' | 'journal'
  export function tabOf(route: Route): Tab   // free -> practice, test -> history; page/drill/notfound -> book
  ```
  Paths: `/practice`, `/practice/free/:source/:mode` (segments `[A-Za-z0-9-]+`), `/history`, `/history/:id` (digits), `/days`, `/days/:date`, `/journal`, `/journal/:date` (`\d{4}-\d{2}-\d{2}`; calendar validity is the view's job). Trailing slash tolerated; everything existing unchanged.
- `TopBar({ current: Tab })`: `<nav aria-label="Sections">` with anchors Book (`/`), Practice, History, Days, Journal; plain click calls `navigate`; the current one has `aria-current="page"`.
- `App`: renders `TopBar`; the chapter `Nav` appears only when `tabOf(route) === 'book'`; other tabs use the full width (a `.app--wide` modifier; the status line's `left` offset becomes 0 there). Views not built yet render a one-line placeholder (`The <name> tab is coming in this milestone.`) that Tasks 7, 10, 12, 13 replace.

- [ ] **Step 1: Write the failing tests:** `router.test.ts` for every path above (`/practice/free/ch-8/time-60` → `{ name: 'free', source: 'ch-8', mode: 'time-60' }`, `/history/abc` → notfound, `/days/oops` → notfound, `/history/12` → `{ name: 'test', id: 12 }`) plus `tabOf`; `TopBar.test.tsx`: five links, the current one marked, plain click navigates (pushState), modified click does not.
- [ ] **Step 2: Run** the two files — fail.
- [ ] **Step 3: Implement.** The bar spans the full width above both columns and stays visible; the Book tab otherwise looks as before. Check the nav's sticky offset and the 760 px and 1300 px breakpoints in `reader.css` still behave.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: top-bar tabs and routes for the lab`.

### Task 7: History tab

**Files:**
- Create: `src/core/review.ts`, `src/ui/TestList.tsx`, `src/ui/History.tsx`, `src/ui/TestDetail.tsx`, `src/ui/history.css`
- Create: `tests/core/review.test.ts`, `tests/ui/History.test.tsx`, `tests/ui/TestDetail.test.tsx`
- Modify: `src/ui/App.tsx` (replace the History placeholder and the `test` route)

**Interfaces:**
- Consumes: `listTests`, `getTest` (Task 5); `dayLabel`, `formatDuration` (Task 5); `parseOutline`, `formatStroke`, `maskToSlots` from `src/core/steno.ts`; `diffMasks` from `src/core/drill.ts`; `STAGE0_INFO`.
- Produces in `review.ts`:
  ```ts
  export type Miss = { prompt: string; expected: string; pressed: string; missing: Slot[]; extra: Slot[] }
  export function misses(strokes: readonly StrokeRecord[]): Miss[]
  export function slowest(strokes: readonly StrokeRecord[], n: number): { prompt: string; latencyMs: number }[]
  export function describeTest(t: Pick<TestRow, 'mode' | 'section' | 'chapter'>): string
  ```
  `misses`: one entry per stroke with `correct === false`; `expected` is the accepted-outline stroke (from any outline in `expected`) nearest by differing-key count to the pressed mask (exact for single-stroke items; for multi-stroke outlines it is the closest stroke of any accepted outline); `pressed` is `formatStroke(pressedMask)`. `slowest`: correct strokes only, by `latencyMs` descending, ties keep log order. `describeTest`: `stage0` → `Chapter 4 · <STAGE0_INFO title or the section id>`; any other mode → `<mode> · <section>` (Task 10 adds `free`).
- `TestList({ tests: TestSummary[] })`: a `<ul>`; each row is an anchor to `/history/<id>` showing local time `HH:MM` and date label, `describeTest`, `92% · 41 wpm` (`Unfinished` and no numbers when `endedAt` is null; `Left early` appended when `meta.abandoned`), and `N strokes`.
- `History`: loads `listTests({ limit: 50 })`; shows `Loading…`, rows via `TestList`, `Show older` (requests `beforeId` = last id; shown only when the last page was full), an error line with `Try again`, and `Nothing practiced yet. Try a drill from the Practice tab.` when empty.
- `TestDetail({ id })`: stats (accuracy, speed, strokes, time practiced), a **Misses** table (prompt, required, pressed, missing keys, extra keys) or `No misses.`, a **Slowest words** list (top 5), `Left early` note, `No such test.` on null, error + retry on failure.

- [ ] **Step 1: Write the failing tests:**
  - `review.test.ts` (build masks with `parseStroke`): pressing `STAP` for `SAP` → extra `T`, missing none; pressing `SP` for `SAP` → missing `A`; with two outlines the nearer one is chosen; correct strokes and an empty list give `[]`; `slowest` ordering, `n` limit, incorrect strokes excluded; `describeTest` for a stage0 section and an unknown mode.
  - `History.test.tsx` (mock `src/api.ts`): rows render newest first with accuracy/wpm; an unfinished row shows `Unfinished`; `Show older` appears only after a full page and passes `beforeId`; failure shows the error and `Try again` reloads; empty state text; rows link to `/history/<id>`.
  - `TestDetail.test.tsx`: stats and miss table content; `No misses.`; slowest list of 5; `Left early`; `No such test.`; failure + retry.
- [ ] **Step 2: Run** the three files — fail.
- [ ] **Step 3: Implement** and wire into `App`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: History tab with test detail`.

### Task 8: Practice-list index in the content build

**Files:**
- Modify: `scripts/build-content.ts`
- Modify: `tests/scripts/build-content.test.ts`

**Interfaces:**
- Produces: `content/build/practice-index.json` = `PracticeIndexEntry[]` where `export type PracticeIndexEntry = { id: string; chapter: number; items: number }`, one per practice list, sorted by `chapter` then `id`. `chapter` is the integer before the first `-` of the list id; a list id without a leading integer fails the build with a clear error. Served at `/content/practice-index.json` by the existing mount.

- [ ] **Step 1: Write the failing tests** (the file builds the vendored book once): the index has 57 entries; every `chapter` is between 5 and 17; sorted; `5-basic-left-hand` has the same item count as `practice/5-basic-left-hand.json`; a list id without a leading number makes `buildContent` reject (use a temp copy or a unit test of the exported helper — implementer's choice).
- [ ] **Step 2: Run** `npx vitest run tests/scripts/build-content.test.ts` — fails.
- [ ] **Step 3: Implement** inside the existing practice-list loop and write the file next to `book.json`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build` (then `ls content/build/practice-index.json`).
- [ ] **Step 5: Commit** `feat: practice-list index in the content build`.

### Task 9: Drill flow view and time limit

**Files:**
- Modify: `src/ui/Drill.tsx`, `src/ui/drill.css`
- Modify: `tests/ui/Drill.test.tsx`

**Interfaces:**
- Consumes: Task 1's lazy logging and abandoned finish.
- Produces — two optional `DrillProps` and nothing else changed:
  ```ts
  view?: 'prompt' | 'flow'   // default 'prompt' (today's look)
  timeLimitMs?: number       // stop after this much session-clock time from the first judged stroke
  ```
  `flow`: instead of the big prompt, a single flowing line shows the last 3 completed prompts (dimmed), the current prompt (marked `aria-current="true"`, emphasized) and the next 10 in order, on the same calm palette; the hint/miss line, board, stats line, sink and Esc behavior are unchanged. With `timeLimitMs`, the stats line shows the remaining time (`0:42 left`) instead of `n / total`, counting down from the full limit before the first stroke. When the remaining time reaches 0 the drill finishes like a normal completion (`onDone`, `logger.finish`) with `meta` extended by `timeLimitMs` and `timedOut: true`, `passed: null`; strokes after that are ignored. The countdown uses the drill's existing session clock, so it is frozen while the board is disconnected and does not run before the first stroke. If items run out first it completes normally. Interval is cleaned up synchronously at unmount.

- [ ] **Step 1: Write the failing tests** (fake timers where needed):
  - flow view shows the current prompt marked and the following prompts in order, and no `.drill__prompt` element; after a correct stroke the mark moves to the next prompt and the previous one is dimmed.
  - `timeLimitMs`: nothing happens before the first stroke even after the limit's worth of time passes; after the first stroke and the limit, `onDone` is called once with `meta.timedOut === true`, `logger.finishes` has one entry, and a later stroke is not logged.
  - the countdown is frozen while disconnected (disconnect, advance past the limit: no finish; reconnect, advance the rest: finish).
  - time up with zero completed words finishes with `wpm 0` and `accuracy 0` (a wrong first stroke started the test).
  - unmounting after a time-out does not finish a second time (and Task 1's abandoned path still works for a flow drill left early).
- [ ] **Step 2: Run** `npx vitest run tests/ui/Drill.test.tsx` — the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: flowing-line view and time limit for the drill`.

### Task 10: Free type and the Practice tab

**Files:**
- Create: `src/freetype/free.ts`, `src/ui/FreeRoute.tsx`, `src/ui/Practice.tsx`, `src/ui/VisibilityPicker.tsx`, `src/ui/practice.css`
- Create: `tests/freetype/free.test.ts`, `tests/ui/FreeRoute.test.tsx`, `tests/ui/Practice.test.tsx`
- Modify: `src/ui/Stage0Route.tsx` (use `VisibilityPicker`), `src/core/review.ts` (`describeTest` for `free`), `src/ui/App.tsx` (replace the Practice placeholder; route `free`)

**Interfaces:**
- Consumes: `Drill` with `view`/`timeLimitMs` (Task 9); `/content/practice-index.json` and `/content/practice/<id>.json` (`PracticeList`), `/content/stage0.json` (`Stage0Words`); `createTestLogger`, `getSettings`, `putSettings`, `getLastTest`; `STAGE0_INFO`/`Stage0Panel`.
- Produces in `free.ts`:
  ```ts
  export type FreeMode = { id: string; label: string; words?: number; seconds?: number }
  export const FREE_MODES: readonly FreeMode[]   // words-25 '25 words', words-50 '50 words', time-30 '30 seconds', time-60 '60 seconds'
  export function parseMode(id: string): FreeMode | undefined
  export type FreeSource = { id: string; label: string; chapter: number; kind: DrillKind }
  export const PSEUDO_SOURCE: FreeSource         // id 'pseudo', 'Chapter 4 pseudo-words', chapter 4, kind 'stroke'
  export function sourcesFor(index: readonly PracticeIndexEntry[]): FreeSource[]  // pseudo, then one 'ch-N' per distinct chapter N>=5 (N=5 'Chapter 5 word lists', else 'Chapters 5–N word lists'), kind 'word'
  export function parseSource(id: string, index: readonly PracticeIndexEntry[]): FreeSource | undefined
  export function listIdsFor(source: FreeSource, index: readonly PracticeIndexEntry[]): string[]   // ids of lists with chapter <= source.chapter; [] for pseudo
  export function poolFor(source: FreeSource, data: { words?: Stage0Words; lists?: PracticeList[] }): DrillItem[]  // pseudo: test+extra words as {prompt:w, outlines:[w]}; else list items; deduped by prompt, first wins
  export function itemCountFor(mode: FreeMode): number   // words -> words; seconds -> 400
  export function buildFreeItems(pool: readonly DrillItem[], count: number, random?: () => number): DrillItem[]
  export function describeFree(section: string): string // 'pseudo/words-25' -> 'Free type · Chapter 4 pseudo-words · 25 words'; unknown ids fall back to the raw section
  ```
  `buildFreeItems`: exactly `count` items (empty pool → `[]`), made of whole shuffled passes over the pool (so with `count <= pool.length` there are no repeats), with no two equal prompts adjacent when the pool has at least 2 distinct prompts, including across a pass boundary.
- `VisibilityPicker({ value, onPick })`: the existing Board `always/hover/hidden` button group extracted from `Stage0Route` with the same markup and test ids so `Stage0Route`'s tests stay green.
- `FreeRoute({ source, mode })` for `/practice/free/:source/:mode`: loads settings, then the data for the source; unknown source or mode, or an empty pool, shows a message with a link back to `/practice`; otherwise runs `Drill` with `view="flow"`, `kind={source.kind}`, `timeLimitMs` for the time modes, `logTest={{ mode: 'free', chapter: source.chapter, section: `${source.id}/${mode.id}` }}`, `onExit` → `/practice`. A finished run shows a result card (Accuracy, Speed, Words, Time) with `Again` (fresh logger and fresh items, as in `Stage0Route`) and `Back to Practice`.
- `Practice`: a **Free type** section (source `<select>` from `sourcesFor`, default pseudo; mode as a radio group, default 25 words; `Start` navigates to the free route; shows `Last: 92% · 41 wpm` for the chosen combination via `getLastTest('free', section)` and `—` when none) and the existing `Stage0Panel` under **Chapter 4 drills**.
- [ ] **Step 1: Write the failing tests:**
  - `free.test.ts`: modes and `parseMode`; `sourcesFor` on a small index (pseudo + chapters 5, 6, 8 → three chapter sources, labels exact); `parseSource` accepts `pseudo`, `ch-8`, refuses `ch-7` (no lists) and `ch-4`; `listIdsFor` filters by chapter; `poolFor` dedupes and keeps first; `itemCountFor`; `buildFreeItems` (exact length, no repeats within a pass, no adjacent equal prompts across a boundary, deterministic with a seeded `random`, empty pool, one-item pool); `describeFree`.
  - `FreeRoute.test.tsx`: unknown mode and unknown source show the message and link; empty pool shows the message; a pseudo-source run passes the right `logTest` and `timeLimitMs` (stub fetch and `Drill`'s logger via `vi.mock('../../src/api.ts')`); `Again` creates a new logger.
  - `Practice.test.tsx`: Start navigates to the chosen source/mode path; changing the source updates the "Last" line; the Chapter 4 list is present.
  - `Stage0Route` tests still pass unchanged.
- [ ] **Step 2: Run** the new files — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: free type and the Practice tab`.

### Task 11: Notes on result cards

**Files:**
- Create: `src/core/journal.ts`, `src/ui/QuickNote.tsx`
- Create: `tests/core/journal.test.ts`, `tests/ui/QuickNote.test.tsx`
- Modify: `src/ui/Stage0Route.tsx` (Summary), `src/ui/FreeRoute.tsx` (result card)

**Interfaces:**
- Consumes: `appendJournal`, `localDate` (Task 5).
- Produces:
  ```ts
  // src/core/journal.ts
  export function formatNoteBlock(now: Date, title: string, stats: { accuracy: number; wpm: number } | null, text: string): string
  ```
  → `### 18:42 — <title> · 92% · 41 wpm` + blank line + trimmed text; with `stats === null` the heading is `### 18:42 — <title>`; time is local `HH:MM` zero-padded; accuracy is `Math.round(accuracy * 100)` and wpm `Math.round(wpm)`.
- `QuickNote({ title, stats })`: a collapsed `Add a note` button that opens a labelled textarea (`Note for today`) with `Save` and `Cancel`. `Save` is disabled while the text is blank or a save is in flight; it appends to today's journal (`appendJournal(localDate(Date.now()), formatNoteBlock(...))`). On success: `Saved to today's journal` with a link to `/journal`. On failure: `Couldn't save the note. Your text is still here.`, the text is kept and `Save` works again. Used by the Stage0 summary and the free-type result card (stats from the result).

- [ ] **Step 1: Write the failing tests:** `formatNoteBlock` exact strings (with stats, `null` stats, `09:05` padding, text trimmed); `QuickNote`: blank disables Save; success calls `appendJournal` once with today's date and the block, then shows the saved line; failure keeps the text and shows the error; a double click on Save sends once; Cancel discards and collapses.
- [ ] **Step 2: Run** the two files — fail.
- [ ] **Step 3: Implement** and add `QuickNote` to both result cards.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: add a note to today's journal from a result card`.

### Task 12: Journal tab

**Files:**
- Create: `src/ui/Journal.tsx`, `src/ui/journal.css`
- Create: `tests/ui/Journal.test.tsx`
- Modify: `src/ui/App.tsx` (replace the Journal placeholder; render `<Journal key={date} date={date} />`)

**Interfaces:**
- Consumes: `listJournal`, `getJournal`, `putJournal`, `listTests` (Task 5); `TestList`, `dayLabel`, `formatDuration`, `localDate`, `addDays`.
- Produces: `Journal({ date?: string })`; `date` defaults to today. An invalid calendar date shows `No such day.`.
  - Left list: today first (always shown), then days that have notes (newest first), each linking to `/journal/<date>`.
  - Main: heading `dayLabel`, links to the previous and next day, a textarea, a save status (`Saved`, `Saving…`, `Not saved — will retry`), and below it **Results this day**: `TestList` of that day's tests plus a totals line (tests, time practiced), loaded with `listTests({ limit: 200, date })`; empty text `No practice recorded this day.`
  - The textarea is read-only until the note has loaded. If loading fails it stays read-only with an error and `Try again`; nothing is ever written in that state.
  - Autosave: 800 ms after the last keystroke, on blur, on `visibilitychange` to hidden, and at unmount (the pending text goes to **that day's** date). A failed save keeps the text, shows `Not saved — will retry`, and retries every 5 s while the text is unsaved.

- [ ] **Step 1: Write the failing tests** (mock `src/api.ts`, fake timers):
  - loads and shows the stored note; typing then waiting 800 ms calls `putJournal(date, text)` once and shows `Saved`.
  - blur saves immediately; unmounting with unsaved text saves to the original date (render for `2026-10-26`, type, rerender/unmount → `putJournal('2026-10-26', …)`).
  - a failed load shows the error, the textarea is read-only, and `putJournal` is never called (also after typing attempts and unmount); `Try again` loads and enables it.
  - a failed save keeps the text, shows `Not saved — will retry`, and a later retry succeeds.
  - `No such day.` for `2026-02-30`; the left list shows today even when it has no note; results and totals render; empty results text.
- [ ] **Step 2: Run** `npx vitest run tests/ui/Journal.test.tsx` — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: Journal tab with autosave`.

### Task 13: Days tab and the streak

**Files:**
- Create: `src/ui/Days.tsx`, `src/ui/days.css`, `src/state/streak.ts`
- Create: `tests/ui/Days.test.tsx`, `tests/state/streak.test.ts`
- Modify: `tests/ui/StatusLine.test.tsx` (extend), `src/ui/StatusLine.tsx`, `src/ui/App.tsx` (replace the Days placeholder; pass `refreshKey={location.pathname}` to `StatusLine`)

**Interfaces:**
- Consumes: `getDays`, `listTests`, `getJournal`, `listJournal` (Task 5); `monthWeeks`, `currentStreak`, `addDays`, `localDate`, `formatDuration`, `dayLabel`; `TestList` (Task 7).
- Produces:
  ```ts
  // src/state/streak.ts
  export function useStreak(refreshKey: string): number | null   // null while loading or on failure
  ```
  Loads `getDays(addDays(today, -400), today)` and returns `currentStreak` of the days that have strokes; reloads when `refreshKey` changes.
- `StatusLine({ refreshKey })`: shows `Streak: N days` (`Streak: 1 day`) on the right when N >= 1; shows nothing for 0, loading or failure.
- `Days({ date?: string })`:
  - Month view (no date): title `October 2026`, previous and next month buttons, Monday-first grid from `monthWeeks`; every day is a link to `/days/<date>` with a `data-level` of 0 (no practice), 1 (under 10 min), 2 (under 30 min) or 3 (30 min or more), today marked, and a dot on days with a note. A totals line: `N days practiced · <duration> · M tests`; a streak line `Streak: N days`. Loads `getDays(monthStart, monthEnd)` for the viewed month and `listJournal()` once.
  - Day view (`/days/<date>`): heading `dayLabel`, that day's tests (`TestList` from `listTests({ limit: 200, date })`), the day's note read-only (`getJournal`, preserved line breaks) with `Open in Journal` (to `/journal/<date>`), and `Back to month`; `No such day.` for an invalid calendar date; empty texts `No practice recorded this day.` and `No note for this day.`.

- [ ] **Step 1: Write the failing tests:** `Days` month view: cells and levels for given stats, today marked, note dot, totals and streak lines, previous/next month reloads with the right range, day link href; day view: tests, note text, links, invalid date, empty states, a failed load shows an error line with `Try again`. `StatusLine`: `Streak: 3 days`, `Streak: 1 day`, nothing at 0 or on failure, existing connection tests unchanged. `useStreak`: counts from yesterday when today is empty.
- [ ] **Step 2: Run** the new/extended files — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: Days tab with calendar and streak`.

### Task 14: Docs and end-to-end check

**Files:**
- Modify: `README.md`, `docs/superpowers/m0-m1-followups.md`
- Create: `docs/superpowers/m2-checklist.md`

- [ ] **Step 1: README:** describe the tabs, free type (and that it draws only on taught words), where notes live (`data/journal/YYYY-MM-DD.md`, plain markdown, easy to back up), and that "time practiced" is approximate. Keep every claim to what is verified.
- [ ] **Step 2: Follow-ups doc:** mark "Abandoned tests" as resolved by M2 (explain the new meaning of `ended_at IS NULL`: the tab was closed mid-drill), note that M3 plans start from the remaining items.
- [ ] **Step 3: `m2-checklist.md`** — checks only the owner can do on the real board: a timed free-type run starts on the first stroke and ends cleanly; unplugging mid-timed-run freezes the countdown; a left-early drill appears in History as `Left early`; the miss table matches what was pressed; a result-card note appears in Journal and in Days; the streak changes the next day; free type with Plover Output on swallows stray text.
- [ ] **Step 4: Verify:** `npm test`, `npm run typecheck`, `npm run build` all green. Then `NO_OPEN=1 PORT=5800 node server/main.ts` in the background, fetch `/`, `/api/days?from=2026-10-01&to=2026-10-31`, `/api/journal`, `/api/tests`, `/content/practice-index.json`, confirm each answers (200) and `ls data` shows no new folder created by the reads (`data/journal` absent), then stop that server.
- [ ] **Step 5: Commit** `docs: M2 readme, follow-ups and real-board checklist`.
