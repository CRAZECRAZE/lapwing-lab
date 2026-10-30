# Lapwing Lab M5b: Fix-up Drill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the owner's own mistakes into a slow Focus drill: a Fix-up page with a Words tab and a Patterns tab (top 10 each, tick boxes), a drill that shows one item at a time until it is typed cleanly ten times in a row, recorded as an ordinary run of a new mode `fixup`.

**Architecture:** Pure functions in `src/core/` rank the lists from archived strokes (one shared replay core also serves chapter-test first showings). The server adds one archive read and `GET /api/fixup`. A pure `FixupSession` implements the ten-in-a-row rule behind a small `DrillRun` interface that the existing `Drill` component now accepts, so board, pickers, logging and abandon handling are reused. "Fixed" is never stored; it is recomputed from history.

**Tech Stack:** Node 26 (`node:sqlite`), Vite + Preact 11 + TypeScript, Vitest + Testing Library (jsdom). Branch `m5b-fixup` (from `main` at `8548078`; spec commit `7432d69`).

**Spec:** `docs/superpowers/specs/2026-10-30-lapwing-lab-m5b-fixup-drill-design.md` (binds this plan; where the plan names a constant or rule, the spec's value is the one used).

## Global Constraints

- Offline, local, private repo. `data/` (the owner's real archive, journal, settings) is never read, written or committed by tests or agents; tests use temp directories. Reading never creates a file, folder or archive. No new files under `data/`, no new settings.
- Style: no semicolons, single quotes, 2-space indent, `.ts`/`.tsx` import suffixes, colours only from the `:root` tokens in `src/ui/reader.css`, calm dark UI, no emoji, no new dependencies. Client code imports from `server/` and `scripts/` with `import type` only; `src/core/` stays pure (no DOM, no fetch, no `node:*`).
- Preact 11 defers `useEffect` cleanup: guard async state with live flags, use `useLayoutEffect` where cleanup must be synchronous.
- Copy never scolds or gives advice; it states facts ("missed 24%", "6 clean in a row"). No timer and no wpm shown anywhere in the fix-up drill or its result. Layout works down to 360 px. Every visual has a text equivalent (the ten dots: "6 clean in a row").
- Constants (spec values): `FIXUP_WINDOW_DAYS = 30`, `MIN_WORD_ATTEMPTS = 5`, `FIXED_STREAK = 10`, `LIST_SIZE = 10`, `PATTERN_WORDS = 12`, `MIN_PATTERN_WORDS = 4`, `FIXUP_MAX_SHOWINGS = 500`; patterns reuse `MIN_KEY_PRESSES` (30) and `MIN_MIXUP_COUNT` (3) from `src/core/keystats.ts`.
- Every task leaves `npm test`, `npm run typecheck` and `npm run build` green.
- Facts the plan relies on: `DrillSession` (`src/core/drill.ts`) is pure; `submit({levers, mask})` returns `partial | correct | miss | undo | ignored`, `correct` carries `firstTry`; the live `Drill` logs one stroke row per judged stroke (`correct` false on a miss, `attemptNo` = misses + 1, undo/ignored never logged); `firstShowings` in `src/core/chaptertest.ts` already replays archived rows through single-item `DrillSession`s (with undo resync); `keyStats(rows)` in `src/core/keystats.ts` returns `{keys: {slot, required, missed}[], mixups: {pressed, needed, count}[]}` where a mix-up also adds to the needed key's `missed`; `nearestStroke(expected, pressedMask)` is in `src/core/review.ts`; `createTestLogger()` and `logTest: {mode, chapter, section}` are how a `Drill` records a run; `useProgress()` gives `chapters`, `states`, `index`; `taughtChapter(chapters, states)` in `src/core/progress.ts` is the newest taught chapter; a practice list file `/content/practice/<id>.json` is `PracticeList` (`scripts/lib/practice.ts`, `{id, items: DrillItem[]}`) and `/content/practice-index.json` entries are `{id, chapter, items}`; the server validates a date range with `journalDate`/`MAX_DAYS_SPAN` and answers `[]`/empty when `ctx.existingArchive()` is null.

## Planning rulings

- **P1.** The replay core in `firstShowings` is extracted once as `replayItems(rows)` (item index and whether the row completed the item, per row); `firstShowings` becomes a thin wrapper with identical output, and `wordAttempts` uses the same core. No second copy of the replay logic.
- **P2.** A word attempt is clean when every row of its item has `correct` true. Items that never completed (run ended mid-word) are dropped. Rows of different runs are never replayed together.
- **P3.** A pattern attempt is a row whose needed stroke (the pressed mask if correct, else `nearestStroke`; rows with none skipped) contains the pattern's needed key; it is clean when that key was pressed. A mix-up and a missing-key pattern with the same needed key therefore share fixed status. Missing-key counts are net of mix-ups (`missed` minus the mix-up counts whose `needed` is that key).
- **P4.** "Last seen" is the time of the latest attempt, shown as `today`, `yesterday` or `N days ago` by local calendar date.
- **P5.** The client computes the 30-day window (`localDate(Date.now())` back 29 days) and passes `from`/`to`, as `/api/stats` does; the server has no clock.
- **P6.** The ticked items travel to the drill in the URL as repeated `pick` query parameters (`/practice/fixup/run/words?pick=the&pick=would`), values `encodeURIComponent`-ed by `URLSearchParams`. The run route refetches the lists and keeps picks that are still listed.
- **P7.** Item kind is per item: `DrillItem` gains optional `kind?: 'word' | 'stroke'`; `Drill` uses `item.kind ?? props.kind`. The fix-up lists set `stroke` when an item's only outline equals its prompt.
- **P8.** A fix-up run stores `wpm` 0 (the logger requires a number) and never displays it; `accuracy` is the clean-showing share.

## Review Focus

1. Empty or missing archive, fresh install: `/api/fixup` answers empty lists, the page and the Practice card say "Nothing to fix", no NaN, and nothing is created on disk (Tasks 3, 7, 9).
2. The same word repeated back-to-back (a fix-up run, a chapter test), a miss then a retype, and an unlogged undo star: each showing is one attempt, a miss is one miss (Tasks 1, 4).
3. Prompts that are punctuation or contain `,`, `/`, `&`, `%`, `#`, spaces: they survive the `pick` query round trip and the drill (Tasks 7, 8).
4. Unticking everything, an item fixed in another tab before Start, the 500-showing cap, a pattern with fewer than 4 words, lists that fail to load: calm messages, no crash (Tasks 4, 7, 8).
5. `fixup` runs are excluded from wpm/accuracy aggregates and rhythm but counted in Days activity; History and test detail never print "0 wpm" for one (Tasks 6, 8).

---

### Task 1: Shared replay core and word attempts

**Files:** Modify `src/core/chaptertest.ts`. Create `src/core/fixup.ts`. Test: `tests/core/chaptertest.test.ts`, `tests/core/fixup.test.ts`.

**Interfaces:**
- Produces in `chaptertest.ts`: `replayItems(strokes: readonly { expected: string[]; pressedMask: number; correct: boolean }[]): { item: number; completes: boolean }[]` (one entry per stroke; `item` counts from 0; `completes` is true on the row that finished its item, including the resync branch); `firstShowings` keeps its signature and output.
- Produces in `fixup.ts`: constants `FIXUP_WINDOW_DAYS`, `MIN_WORD_ATTEMPTS`, `FIXED_STREAK`, `LIST_SIZE`; `type FixupRow = { testId: number; tsMs: number; prompt: string; expected: string[]; pressedMask: number; correct: boolean }`; `type WordAttempt = { prompt: string; expected: string[]; clean: boolean; tsMs: number }`; `wordAttempts(rows: readonly FixupRow[]): WordAttempt[]`; `type FixupWord = { prompt: string; outlines: string[]; kind: 'word' | 'stroke'; attempts: number; misses: number; rate: number; lastTsMs: number }`; `rankWords(attempts: readonly WordAttempt[]): FixupWord[]`; `itemKind(prompt: string, outlines: readonly string[]): 'word' | 'stroke'`; `lastSeenText(tsMs: number, nowMs: number): string`.

- [ ] **Step 1: Write failing tests.** `chaptertest.test.ts`: `replayItems` over a one-stroke word shown three times in a row returns items 0,1,2 with `completes` true on each; over a two-stroke word with a miss between returns one item with `completes` only on the last row; an undo-resync case copied from the existing `firstShowings` tests gives the same item numbers; every existing `firstShowings` test still passes unchanged. `fixup.test.ts`: (a) `wordAttempts` on rows of two runs (different `testId`) gives attempts per run and never merges items across runs; (b) the same word typed cleanly 10 times back-to-back gives 10 clean attempts; (c) a miss row (`correct` false) then a correct retype gives ONE attempt with `clean` false; (d) a two-stroke word is one attempt; (e) a last item with no completing row is dropped; (f) an unparseable `expected` row is skipped without throwing; (g) `rankWords`: a word with 4 attempts is excluded (`MIN_WORD_ATTEMPTS`), a word with 5+ attempts and no miss is excluded, a word whose latest 10 attempts are clean is excluded (fixed) while the same word with a miss inside its latest 10 is listed, sorting is rate desc then attempts desc then prompt asc, at most `LIST_SIZE` returned, `rate` = misses / attempts, `outlines` come from the latest attempt, `lastTsMs` is the latest attempt's `tsMs`; (h) `itemKind('a', ['a'])` is `'stroke'`, `itemKind('the', ['-T'])` and `itemKind('a', ['a','b'])` are `'word'`; (i) `lastSeenText` gives `today`, `yesterday`, `3 days ago` by local calendar date, `today` for a future `tsMs`.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/core/chaptertest.test.ts tests/core/fixup.test.ts`. Expected: FAIL (missing exports).
- [ ] **Step 3: Implement.** Extract the loop body of `firstShowings` into `replayItems` (P1) and make `firstShowings` map `item % every === 0`. In `fixup.ts`, `wordAttempts` splits rows by `testId`, calls `replayItems` per run, groups rows by item, and keeps completed items (P2; `prompt`/`expected` from the item's first row, `tsMs` from its last row). `rankWords` groups by `prompt`, applies the window-independent rules of the spec (attempts, a miss, not fixed = latest `FIXED_STREAK` attempts all clean), and ranks. `lastSeenText` uses `localDate` from `src/core/days.ts` and `daysBetween` from `src/core/progressview.ts`.
- [ ] **Step 4: Run to verify pass:** the command from Step 2 plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: shared replay core and fix-up word ranking`.

### Task 2: Pattern ranking and pattern words

**Files:** Modify `src/core/fixup.ts`. Create `src/core/fixupwords.ts`. Test: `tests/core/fixup.test.ts`, `tests/core/fixupwords.test.ts`.

**Interfaces:**
- Consumes: Task 1 `FixupRow`, `LIST_SIZE`, `FIXED_STREAK`; `keyStats`, `MIN_KEY_PRESSES`, `MIN_MIXUP_COUNT`; `nearestStroke`; `maskToSlots`, `slotMask`, `SLOTS`, `parseOutline`, type `Slot`.
- Produces in `fixup.ts`: `type PatternKey = { kind: 'mixup'; pressed: Slot; needed: Slot } | { kind: 'missing'; needed: Slot }`; `type FixupPattern = PatternKey & { id: string; count: number; required: number; rate: number; lastTsMs: number }`; `patternId(key: PatternKey): string` (`mixup:<pressed>><needed>` or `missing:<needed>`); `rankPatterns(rows: readonly FixupRow[]): FixupPattern[]`; `type FixupLists = { from: string; to: string; words: FixupWord[]; patterns: FixupPattern[] }`; `buildLists(rows: readonly FixupRow[]): { words: FixupWord[]; patterns: FixupPattern[] }` (`rankWords(wordAttempts(rows))` and `rankPatterns(rows)`).
- Produces in `fixupwords.ts`: `PATTERN_WORDS = 12`, `MIN_PATTERN_WORDS = 4`; `type ListWords = { chapter: number; items: readonly DrillItem[] }`; `patternWords(needed: Slot, lists: readonly ListWords[], reachedChapter: number, random?: () => number): DrillItem[]`.

- [ ] **Step 1: Write failing tests.** `fixup.test.ts`: (a) a key pressed in place of another 5 times out of 40 required presses of the needed key lists `{kind:'mixup'}` with `count` 5, `required` 40, `rate` 0.125; (b) P3 net counting: the same rows do NOT also list `{kind:'missing', needed}` unless it has `MIN_MIXUP_COUNT` misses beyond the mix-ups; a key left out with nothing pressed in its place 4 times lists `{kind:'missing'}` with `count` 4; (c) a needed key with under `MIN_KEY_PRESSES` required presses is excluded; a pattern with `count` 2 is excluded; (d) ranking is by `rate` not `count` (a key with 10/200 ranks below one with 4/40), ties by higher count then `SLOTS` order; (e) a pattern whose needed key was pressed in its latest 10 attempts is excluded as fixed, and listed again once a miss appears in the latest 10; (f) rows with no nearest stroke are skipped; (g) `patternId` is stable and distinguishes the two kinds; (h) `buildLists([])` gives empty lists. `fixupwords.test.ts`: (i) only words with an outline stroke containing the needed key are returned; (j) lists of chapters above `reachedChapter` are ignored; (k) at most 12, drawn round-robin across lists (two lists of 30 matching words give 6 + 6), no duplicate prompts; (l) a seeded `random` makes the order deterministic; (m) an item with an unparseable outline is skipped, not thrown; (n) fewer than `MIN_PATTERN_WORDS` is still returned as is (the caller decides).
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/core/fixup.test.ts tests/core/fixupwords.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per P3 and the spec's "Patterns" section. `rankPatterns` feeds `keyStats` one row per archive row (`n: 1`), computes net missing, applies thresholds, computes fixed status from the ordered rows, sorts and slices to `LIST_SIZE`. `patternWords` shuffles each eligible list, filters, then takes round-robin until 12.
- [ ] **Step 4: Run to verify pass:** the command from Step 2 plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: fix-up pattern ranking and pattern words`.

### Task 3: Archive read, `GET /api/fixup`, client call

**Files:** Modify `server/archive.ts`, `server/server.ts`, `src/api.ts`. Create `server/fixup.ts`. Test: `tests/server/archive.test.ts`, `tests/server/fixup.test.ts`, `tests/server/server.test.ts`, `tests/api.test.ts`.

**Interfaces:**
- Consumes: Task 2 `FixupRow`, `FixupLists`, `buildLists`.
- Produces: `Archive.fixupRowsInRange(from: string, to: string): FixupRow[]` (every stroke of every run whose first stroke falls on a local date in range, finished or not, abandoned or not, ordered by `test_id` then stroke id; rows with unparseable `expected_json` skipped); `buildFixup(archive: Archive, q: { from: string; to: string }): FixupLists` and `emptyFixup(q): FixupLists` in `server/fixup.ts`; `GET /api/fixup?from=&to=` (same validation, span cap and method handling as `/api/stats`; no archive answers `emptyFixup`); `getFixup(from: string, to: string, fetchFn?): Promise<FixupLists>` in `src/api.ts`.

- [ ] **Step 1: Write failing tests.** archive: rows come back in run then stroke order with `prompt`, `expected`, `pressedMask`, `correct`, `testId`, `tsMs`; an abandoned run's and an unfinished run's rows are included; a stroke outside the range is not; a row with malformed `expected_json` is skipped. fixup: a seeded archive with one word missed often yields it in `words` and the repeated mix-up in `patterns`; an empty archive yields empty lists. server: `GET /api/fixup?from=2026-10-01&to=2026-10-30` answers 200 with `{from, to, words, patterns}`; a missing archive answers empty lists and creates no file (check the temp data dir listing); bad dates and a span over `MAX_DAYS_SPAN` answer 400; `POST` answers 405. api: `getFixup` builds `/api/fixup?from=..&to=..`.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/server/archive.test.ts tests/server/fixup.test.ts tests/server/server.test.ts tests/api.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse the `WITH_STROKES`/`LOCAL_DAY` fragments and `dateRange`/`parseJson` helpers of `timingsInRange`/`keyRowsInRange`; type import of `FixupRow` from `src/core/fixup.ts` (type-only import, as `archive.ts` already does for core types).
- [ ] **Step 4: Run to verify pass:** the command from Step 2 plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: fix-up archive read and /api/fixup`.

### Task 4: The Focus session

**Files:** Modify `src/core/drill.ts`. Create `src/core/fixupdrill.ts`. Test: `tests/core/drill.test.ts`, `tests/core/fixupdrill.test.ts`.

**Interfaces:**
- Produces in `drill.ts`: `type DrillKind = 'stroke' | 'word'` (moved here; `src/ui/Drill.tsx` keeps exporting it by re-export); `DrillItem` gains `kind?: DrillKind`; `interface DrillRun { readonly total: number; readonly index: number; readonly current: DrillItem | undefined; readonly finished: boolean; submit(stroke: RawStroke): StrokeResult; stats(): DrillStats }` which `DrillSession` satisfies unchanged.
- Produces in `fixupdrill.ts`: `FIXUP_MAX_SHOWINGS = 500`; `type FixupTarget = { id: string; label: string; items: DrillItem[] }` (`items` non-empty, shown cyclically); `class FixupSession implements DrillRun` with `constructor(targets: readonly FixupTarget[], clock?: () => number)`, `progress(): { target: FixupTarget | undefined; position: number; total: number; streak: number; fixed: number; showings: number; capped: boolean }`, `fixedIds(): string[]`, and `stats()` where `completed` = showings, `firstTryCorrect` = clean showings, `accuracy` = clean / showings (0 with none), `elapsedMs` from the first submit to the last completion, `wpm` always 0. `total` = number of targets, `index` = current target index.

- [ ] **Step 1: Write failing tests** in `tests/core/fixupdrill.test.ts` (strokes built with `parseOutline` masks and `levers: []`): (a) ten clean showings of a one-word target move to the next target and mark the first fixed (`fixedIds()`); `streak` counts 0..9 along the way; (b) a miss at streak 6 sets `streak` 0, the item stays current, the retype returns `correct` with `firstTry` false and does NOT add to the streak, so ten more clean showings are needed; (c) a two-stroke word counts one showing per word, `partial` between strokes; (d) a target with 3 items cycles `items[0], items[1], items[2], items[0]...` per showing; (e) the star undo returns `undo` and does not touch the streak; (f) after the last target is fixed `finished` is true and `current` undefined; (g) `FIXUP_MAX_SHOWINGS` showings end the run with `capped` true and `finished` true even with items unfixed; (h) an empty target list is finished at once; (i) an item with no outlines or an invalid outline throws at construction with the same messages as `DrillSession`; (j) `stats()` never reports a wpm other than 0 and never NaN; (k) replaying the same strokes on a fresh session with the same fake clock gives identical results. `drill.test.ts`: an item with `kind` set type-checks and `DrillSession` still passes every existing test.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/core/drill.test.ts tests/core/fixupdrill.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `FixupSession` keeps one inner single-item `DrillSession` per showing (new one after each `correct`), maps its results: `correct` increments showings, adds to the streak only when `firstTry`, fixes the target at `FIXED_STREAK` (import from `src/core/fixup.ts`) and advances; `miss` zeroes the streak; the rest pass through. Update imports of `DrillKind` in `src/ui/Drill.tsx` to the new home with a re-export so existing imports keep working.
- [ ] **Step 4: Run to verify pass:** the command from Step 2 plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: fix-up focus session`.

### Task 5: `Drill` accepts a custom run, a status slot, extra meta and per-item kind

**Files:** Modify `src/ui/Drill.tsx`, `src/ui/drill.css` (only if a class is needed). Test: `tests/ui/Drill.test.tsx`.

**Interfaces:**
- Consumes: Task 4 `DrillRun`, `DrillItem.kind`.
- Produces: `DrillProps` gains `makeSession?: (clock: () => number) => DrillRun` (replaces `new DrillSession(items, clock)` when present), `renderStatus?: (run: DrillRun) => ComponentChildren` (replaces the `drill__stats` paragraph when present), `extraMeta?: () => Record<string, unknown>` (merged into the meta of both `finish` and the abandoned close); the word/stroke decision uses `item?.kind ?? kind`. `items` stays required (item count in the log, flow view). Without the new props nothing changes.

- [ ] **Step 1: Write failing tests** (reuse the fake-board helpers in `tests/ui/helpers`): (a) with `makeSession` returning a session that never finishes, the drill uses it (its `current.prompt` is on screen, strokes reach its `submit`); (b) `renderStatus` output replaces the stats line and updates after each stroke; (c) `extraMeta` keys appear in the `meta` passed to `logger.finish` on finish AND when the drill is left mid-way (abandoned); (d) an item with `kind: 'stroke'` inside a `kind="word"` drill shows its target stroke from the start while a plain item hides it until a miss; (e) with none of the new props every existing test passes unchanged.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/ui/Drill.test.tsx`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the four additions in `Drill.tsx`; keep the diff small (the session ref line, the status paragraph, the two meta objects, one `itemKind` local).
- [ ] **Step 4: Run to verify pass:** the command from Step 2 plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Drill takes a custom run, a status slot and extra meta`.

### Task 6: `fixup` runs in the aggregates and the run lists

**Files:** Modify `server/stats.ts`, `src/ui/progress/useRhythm.ts`, `src/core/review.ts`, `src/ui/TestList.tsx`, `src/ui/TestDetail.tsx`. Test: `tests/server/stats.test.ts`, `tests/core/review.test.ts`, `tests/ui/History.test.tsx`, `tests/ui/TestDetail.test.tsx`, `tests/ui/progress/RhythmPanel.test.tsx`.

**Interfaces:**
- Consumes: the mode string `fixup`, section `words` or `patterns`.
- Produces: in `buildStats` the `all` mode no longer includes `fixup` runs (neither does `drills` or `free`); the same exclusion in the rhythm hook; `describeTest` names them `Fix-up · words` / `Fix-up · patterns`; the History list and test detail show the accuracy but a dash instead of a wpm for a `fixup` run.

- [ ] **Step 1: Write failing tests:** stats: a seeded `fixup` run (finished, wpm 0, accuracy 0.9) leaves `days` in `all` mode untouched (no run, no words) while `dayStats`-based activity (`/api/days`) still counts its strokes and time; rhythm hook: `all` mode ignores a `fixup` run; `describeTest` names; History row for a `fixup` test reads `90% · —` (no `0 wpm`); test detail shows `—` in the speed row.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/server/stats.test.ts tests/core/review.test.ts tests/ui/History.test.tsx tests/ui/TestDetail.test.tsx tests/ui/progress/RhythmPanel.test.tsx`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement.** One shared `COUNTED_IN_ALL` rule: `inMode('all')` is true for every mode except `fixup`; mirror it in `useRhythm.ts` (import the mode name from one place if a shared constant is cheap, else comment the pairing). Do not touch `dayStats`, `sectionResults`, `RESULT_MODES`, plateau or the report math: audit with `grep -rn "'free'\|mode" server src --include=*.ts --include=*.tsx` that no other aggregate sums wpm across modes and note the result in the commit body.
- [ ] **Step 4: Run to verify pass:** the command from Step 2 plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: fix-up runs stay out of wpm aggregates and show no wpm`.

### Task 7: The Fix-up page

**Files:** Modify `src/router.ts`, `src/ui/App.tsx`. Create `src/ui/useFixup.ts`, `src/ui/Fixup.tsx`, `src/ui/fixup.css`. Test: `tests/router.test.ts`, `tests/ui/Fixup.test.tsx`.

**Interfaces:**
- Consumes: Task 3 `getFixup`; Task 2 `FixupLists`, `patternWords`, `MIN_PATTERN_WORDS`, `PATTERN_WORDS`; Task 1 `lastSeenText`; `useProgress`, `taughtChapter`.
- Produces: routes `{ name: 'fixup'; tab: 'words' | 'patterns' }` for `/practice/fixup` and `/practice/fixup/patterns`, and `{ name: 'fixup-run'; kind: 'words' | 'patterns' }` for `/practice/fixup/run/words` and `/practice/fixup/run/patterns` (query ignored by `parseRoute`); `tabOf` maps all three to `practice`; `useFixup(): { status: 'loading' | 'ready' | 'error'; lists: FixupLists | null }` (window from `localDate(Date.now())` back `FIXUP_WINDOW_DAYS - 1` days, live-flag guarded); `<Fixup tab>` page; `runHref(kind: 'words' | 'patterns', picks: readonly string[]): string` exported from `Fixup.tsx` building the `?pick=` URL (P6).

- [ ] **Step 1: Write failing tests.** router: the four paths parse as above, `/practice/fixup/run/other` is `notfound`, `tabOf` gives `practice`. Page (mock `fetch` for `/api/fixup`, `/content/practice-index.json` and the list files): (a) the Words tab lists up to 10 rows with tick box (ticked), word, first outline, miss percent and last seen, in rank order; (b) the Patterns tab lists pattern text such as `-T typed for -S` / `R- missing`, the drillable word count, the rate and count; (c) unticking changes the Start link's `pick` list and unticking all disables Start; (d) a pattern with fewer than `MIN_PATTERN_WORDS` words in reached chapters is shown with "not enough words in the chapters you've reached" and an unticked, disabled box; (e) empty lists show "Nothing to fix here: no word has been missed often enough yet." with no Start; (f) when the list files fail to load the Patterns tab says it could not load the word lists and the Words tab still works; (g) the tab strip links `/practice/fixup` and `/practice/fixup/patterns` and marks the current one with `aria-current`; (h) `runHref('words', ['a,b', 'x&y', '#', '/'])` round-trips through `new URLSearchParams(new URL(href, 'http://x').search).getAll('pick')`; (i) a failed `/api/fixup` shows a calm error line.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/router.test.ts tests/ui/Fixup.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pattern text: mix-up `<pressed> typed for <needed>`, missing `<needed> missing` (slot names as `formatStroke`/`SLOTS` show them). Only the Patterns tab fetches the list files, for chapters up to `taughtChapter(...)`, via `Promise.all` with per-file failure treated as "could not load". Patterns the owner may tick default to ticked. Selection state is local to the page (nothing remembered). Tables carry captions; tick boxes have labels naming the item. `App.tsx` renders `<Fixup>` for the `fixup` route only; the `fixup-run` route gets its branch in Task 8 (until then it renders nothing).
- [ ] **Step 4: Run to verify pass:** the command from Step 2 plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: fix-up page with Words and Patterns tabs`.

### Task 8: The fix-up run

**Files:** Modify `src/ui/App.tsx`. Create `src/ui/FixupRun.tsx`. Test: `tests/ui/FixupRun.test.tsx`.

**Interfaces:**
- Consumes: Task 4 `FixupSession`, `FixupTarget`, `FIXUP_MAX_SHOWINGS`; Task 5 `Drill` props; Task 7 `useFixup`, `runHref`; Task 2 `patternWords`; Task 1 `itemKind`; `createTestLogger`, `HintPicker`/`useHints`, `VisibilityPicker`/`useBoardVisibility`, `QuickNote`, `AppLink`, `useDockDrillMarker`, `useProgress`.
- Produces: `<FixupRun kind>` for the `fixup-run` route: reads `pick` values from `location.search`, keeps the ones still listed (words by prompt, patterns by `patternId`), builds `FixupTarget`s (a word: one item with `kind` from `itemKind`; a pattern: its `patternWords` shuffled once, label like `-T typed for -S`, skipped when under `MIN_PATTERN_WORDS`), hosts a `Drill` with `makeSession`, `renderStatus` (item label, `Item N of M · K fixed`, ten dots and the text `N clean in a row`) and `extraMeta` (`{ section, targets, fixed, showings }`), logs with `{ mode: 'fixup', chapter: null, section: kind }`. Result card: items fixed, items not finished, total showings, first-try share, time as `m:ss` (no wpm), `QuickNote`, a "Keep going" button (re-runs the unfinished targets, only when there are any), and "Back to Fix-up".

- [ ] **Step 1: Write failing tests** (fake board helpers, mocked `fetch` and logger as in `DrillRunner.test.tsx`): (a) `?pick=the&pick=would` starts on `the` with zero filled dots and the text `0 clean in a row`; (b) ten clean strokes fill the dots one by one (`aria` text `k clean in a row`), then `would` appears and the status says `Item 2 of 2 · 1 fixed`; (c) a miss at 6 sets the text back to `0 clean in a row` and shows the right stroke; (d) the logger's `start` receives `mode: 'fixup'`, `chapter: null`, `section: 'words'`, and `finish` meta carries `fixed`, `targets`, `showings`, with `wpm` 0; (e) a pick that is no longer listed is dropped, none left shows "Nothing ticked is left to fix." with a link back; (f) a prompt such as `,` or `a/b` in `pick` is found and drilled; (g) a pattern run drills only words containing the needed key and counts a miss on another key of the word as not clean; (h) the cap ends the run with a note that it stopped at 500 showings and Keep going offered; (i) leaving mid-drill logs an abandoned run with the same extra meta; (j) the result card shows no "wpm" text anywhere; (k) "Keep going" restarts with only unfixed targets.
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/ui/FixupRun.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** The `Drill` is keyed per attempt like `DrillRunner` (new logger and session per run). The status component reads the `FixupSession` captured by `makeSession` in a ref. Dots are decorative (`aria-hidden`), the text carries the meaning in an `aria-live="polite"` line. Add the `fixup-run` branch to `App.tsx`.
- [ ] **Step 4: Run to verify pass:** the command from Step 2 plus `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: fix-up focus drill run`.

### Task 9: Entry points

**Files:** Modify `src/ui/Practice.tsx`, `src/ui/practice.css`, `src/ui/progress/WeakKeys.tsx`, `src/ui/progress/Mixups.tsx`. Test: `tests/ui/Practice.test.tsx`, `tests/ui/progress/WeakKeys.test.tsx`, `tests/ui/progress/Mixups.test.tsx`.

**Interfaces:**
- Consumes: Task 7 `useFixup`; `AppLink`.
- Produces: a `Fix-up` card on the Practice tab between "Where you are" and "Free type": "N words, M patterns to fix" with a link to `/practice/fixup` (or "Nothing to fix right now." plus the same link); "Drill these" links to `/practice/fixup/patterns` in the Weakest keys and Mix-ups panels.

- [ ] **Step 1: Write failing tests:** the card shows the counts from a mocked `/api/fixup`, shows "Nothing to fix right now." with empty lists and while loading shows neither number nor error, and its link goes to `/practice/fixup`; a failed fetch shows only the link; each panel renders a "Drill these" link to `/practice/fixup/patterns`, also when the panel has no data (the panels' existing empty text is unchanged).
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/ui/Practice.test.tsx tests/ui/progress/WeakKeys.test.tsx tests/ui/progress/Mixups.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the card with the existing `practice__box` styling and the two links. No change to the panels' data flow.
- [ ] **Step 4: Run to verify pass:** the command from Step 2 plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: fix-up entry points on Practice and Progress`.

### Task 10: Docs and the milestone checklist

**Files:** Modify `README.md`, `docs/superpowers/m0-m1-followups.md`. Create `docs/superpowers/m5b-checklist.md`.

- [ ] **Step 1: Write** a README section `## Fix-up drill` (what the two tabs list, how an item is fixed, that nothing is stored for it, the `fixup` run mode and what it does and does not count in). Write `m5b-checklist.md`: about 12 checks the owner runs on real data (lists look plausible, untick works, a word reaches 10 and drops off the list afterwards, a miss resets, a punctuation item, pattern drill words only from reached chapters, leaving mid-way, History shows no wpm, Progress wpm unchanged by a fix-up run, Days counts the time, the Practice card, the Progress links). Add `## Left open by M5b` to the follow-ups file: fix-up strokes feed the Weakest keys/Mix-ups panels (may flatter them), the multi-stroke attribution limit (which stroke of a word is unknown), pattern fixed-status shared between a mix-up and a missing key of the same key, the 30-day window truncating long streaks, and anything the final review parks.
- [ ] **Step 2: Run the full suite:** `npm test && npm run typecheck && npm run build`. Expected: all green.
- [ ] **Step 3: Commit** `docs: M5b readme section, checklist and follow-ups`.
