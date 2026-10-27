# Lapwing Lab M3 — Core Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the book into a path: live section-practice rows in the reader, word-prompt section drills, book-faithful chapter tests, and gates (with "move on anyway") that unlock the next chapter, all remembered in the local database.

**Architecture:** The content build learns each chapter's gate (`chapters.json`). The archive gains per-section result aggregates and a tiny `progress_marks` table for the owner's explicit "read" / "move on anyway" actions. A pure function (`src/core/progress.ts`) turns chapters + results + marks into per-chapter states; a provider shares that state with the reader, nav, Practice tab and drill routes. Drills reuse the existing `Drill` component (word prompts, hint on miss, Hint setting); a shared `DrillRunner` hosts section drills and chapter tests.

**Tech Stack:** Node 26 (`node:sqlite`, runs `.ts` directly), Preact 11 + Vite, TypeScript, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-27-lapwing-lab-design.md` — §3.1, §3.2, §4.1 (including "Settled for M3"), §9 (M3), §11 items 18–21. Prior work: M2 plan `docs/superpowers/plans/2026-10-27-lapwing-lab-m2-lab-shell.md`, `docs/superpowers/m0-m1-followups.md`.

## Global Constraints

- Offline and private: server on `127.0.0.1` only; no network calls; no new dependencies of any kind.
- Data lives under `data/`, created lazily: **no read path may create** `data/`, `data/steno.db` or `data/journal/`. The owner's existing `data/steno.db` must open and keep every row after the schema grows.
- Pass marks come from the book's text via `content/build/chapters.json`; the only number the UI may hard-code is the 90% accuracy of the section-drill gate (spec 4.1).
- A gate never traps the owner: every locked chapter can be opened with "move on anyway", including by deep link to a drill route, and a failure to load progress means nothing is locked.
- A run left early (`meta.abandoned`) never counts toward a result, a pass or a gate.
- Chapter 4's Stage 0 flow, the Chapter 4 panel, M2's History/Days/Journal, free type and the Hint setting keep working unchanged.
- The drill stays prompt-first; board visibility and the Hint setting are honored in the new drills.
- Style: follow the surrounding code (no semicolons, single quotes, 2-space indent, `.ts`/`.tsx` import suffixes, type-only imports from `server/` and `scripts/` in client code); colors only from the `:root` tokens in `src/ui/reader.css`; calm and dark; no emoji (the existing `✓` mark is fine).
- Preact 11 defers `useEffect` cleanup; use `useLayoutEffect` where cleanup must be synchronous, and guard async state updates with a live/sequence flag.
- Every commit leaves `npm test`, `npm run typecheck` and `npm run build` green.
- Branch `m3-core-practice` (off `main`). Do not push, merge or delete branches.

## Review Focus

Most likely first. Each has a test in the task named:

1. A run left early, or a failed attempt, never clears a gate; only `meta.passed === true` on a finished, non-abandoned run does (Tasks 2, 4).
2. The owner can always get past a gate: chapter 5 right now (Stage 0 not yet passed), a deep link to a locked drill route, and a server error while loading progress (Tasks 4, 6, 7, 8).
3. Stage 0, the Chapter 4 panel and M2's "last result" rule are untouched by the new modes (`stage0` / `section` / `chapter-test`) (Tasks 3, 7).
4. The chapter test is exactly 45 distinct random words, each 3 times in a row; passing needs accuracy **and** the minimum wpm; a list shorter than 45 does not crash (Task 5).
5. Opening the owner's existing database upgrades it in place; reads create no files (Tasks 2, 3).

---

### Task 1: Chapter gate data in the content build

**Files:**
- Modify: `scripts/build-content.ts`
- Modify: `tests/scripts/build-content.test.ts`

**Interfaces:**
- Consumes: `PassMark` from `scripts/lib/passmark.ts`; the practice index built in the same loop (`PracticeIndexEntry`).
- Produces: `content/build/chapters.json` = `ChapterInfo[]`, exported types from `scripts/build-content.ts`:
  ```ts
  export type GateKind = 'stage0' | 'test' | 'drills' | 'read'
  export type ChapterInfo = {
    chapter: number; pageId: string; title: string; gate: GateKind
    passMark?: PassMark          // from the book's text (stage0 and test gates)
    testListId?: string          // `${n}-test` when that list exists
    listIds: string[]            // this chapter's practice lists, test list excluded, index order
  }
  ```
  One entry per chapter page (`kind === 'chapter'`), ascending by `chapter` (1–26). Gate rules: chapter 4 → `stage0` (its `passMark` from the page: 90% within 10 minutes; no `listIds`); a `testListId` exists → `test` (the page **must** have a `passMark` with `minWpm`, else the build fails naming the chapter); otherwise `listIds` non-empty → `drills`; otherwise `read`. Served at `/content/chapters.json` by the existing mount.

- [ ] **Step 1: Write the failing tests** (the file builds the vendored book once): 26 entries ascending; chapter 4 is `stage0` with `passMark` `{ accuracy: 0.9, maxMinutes: 10 }` and no lists; chapter 5 is `test` with `testListId` `5-test`, `passMark` minWpm 10, `listIds` exactly the three non-test lists; chapters 7–10 carry minWpm 5; chapter 13 has maxWpm 40; chapters 12 and 14 are `drills` with their two lists each and no `passMark`; chapter 17 is `drills` with its seven lists; chapters 1, 18, 20, 21, 26 are `read`; every `test` chapter has `passMark.minWpm`; a fixture book where a test chapter lacks a pass mark makes `buildContent` reject with a message naming the chapter (a small exported pure helper `gateFor(...)` tested directly is fine).
- [ ] **Step 2: Run** `npx vitest run tests/scripts/build-content.test.ts` — fails.
- [ ] **Step 3: Implement** after the page loop (the index is complete by then); write `chapters.json` next to `book.json`; do not change `BuildStats` or other outputs.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`, then `ls content/build/chapters.json`.
- [ ] **Step 5: Commit** `feat: chapter gates in the content build`.

### Task 2: Archive — section results and progress marks

**Files:**
- Modify: `server/archive.ts`
- Modify: `tests/server/archive.test.ts`

**Interfaces:**
- Produces (exported from `server/archive.ts`):
  ```ts
  export type SectionResult = {
    section: string; runs: number; passed: boolean
    best: { accuracy: number; wpm: number } | null
    last: { accuracy: number; wpm: number; endedAt: number; passed: boolean | null } | null
  }
  export type ProgressMark = { chapter: number; kind: 'read' | 'override'; at: number }
  // added to Archive:
  sectionResults(mode: string): SectionResult[]
  listMarks(): ProgressMark[]
  setMark(chapter: number, kind: 'read' | 'override', at: number): void   // upsert
  clearMark(chapter: number): void
  ```
- Semantics: `sectionResults` considers only tests of that `mode` with `ended_at` set, strokes present, and `meta.abandoned` not true (same `json_extract(meta_json, '$.abandoned') IS NOT 1` rule as `lastTest`); grouped by `section` (tests with a null section are ignored); `runs` counts them; `passed` is true when any run has `meta.passed === true` (`json_extract(meta_json, '$.passed') = 1`); `best` is the run with the highest accuracy, ties broken by higher wpm; `last` is the most recent by `ended_at` (ties by id). Results sorted by section. `progress_marks(chapter INTEGER PRIMARY KEY, kind TEXT NOT NULL, at INTEGER NOT NULL)` is created with `CREATE TABLE IF NOT EXISTS`; `setMark` validates `chapter` as an integer 1–99, `kind` as `read`/`override` (`RangeError` otherwise) and `at` as a safe integer, and replaces an existing row; `listMarks` ascending by chapter; `clearMark` of a missing chapter is a no-op.

- [ ] **Step 1: Write the failing tests:** an abandoned run and an unfinished run never appear; a section with only abandoned runs is absent; `passed` true only with a run whose `meta.passed` is true (a later failing run keeps `passed` true, a `meta` without the key or `null` is not a pass); `best` picks accuracy then wpm and `last` the newest (insert out of order); other modes are not mixed in; marks: set, replace, list order, clear, clear of a missing chapter, validation errors; an archive file created with the M2 schema (build it with raw `DatabaseSync` and the old CREATE statements, including a stroke row) opens, keeps its rows and gains the table.
- [ ] **Step 2: Run** `npx vitest run tests/server/archive.test.ts` — fails.
- [ ] **Step 3: Implement** with prepared statements; add the table to `SCHEMA`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** `feat: archive section results and progress marks`.

### Task 3: Routes for results and progress

**Files:**
- Modify: `server/server.ts`
- Modify: `tests/server/server.test.ts`

**Interfaces:**
- Consumes: `Archive.sectionResults/listMarks/setMark/clearMark` (Task 2).
- Produces (JSON; reads use `existingArchive()` and never create files):
  ```
  GET    /api/results?mode=<stage0|section|chapter-test>  -> SectionResult[]   (mode required, one of the three, else 400; [] when no archive yet)
  GET    /api/progress                                    -> ProgressMark[]    ([] when no archive yet)
  PUT    /api/progress/:chapter   { kind: 'read'|'override' } -> ProgressMark  (chapter 1-99 else 400; kind validated; creates the archive)
  DELETE /api/progress/:chapter                           -> { ok: true }      (a missing chapter is fine; never creates the archive)
  ```
  Wrong methods answer 405 with an `allow` header. `/api/tests/last` and every M2 route behave as before.

- [ ] **Step 1: Write the failing tests:** on a fresh data dir `GET /api/results?mode=section` and `GET /api/progress` answer `[]` and `data/` still does not exist, and `DELETE /api/progress/5` answers ok without creating it; results reflect runs seeded through the real POST routes (a passing run with `meta.passed: true`, an abandoned one ignored); bad `mode` / missing `mode` → 400; PUT then GET round-trips, replaces, DELETE removes; `PUT {kind:'nope'}`, chapter `0`, `100`, `abc` → 400; 405s with `allow`.
- [ ] **Step 2: Run** `npx vitest run tests/server/server.test.ts` — fails.
- [ ] **Step 3: Implement** in `route()`, reusing `asObject`, `bad`, `allow`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** `feat: routes for section results and progress marks`.

### Task 4: Client calls and the pure gate logic

**Files:**
- Modify: `src/api.ts`, `tests/api.test.ts`
- Create: `src/core/progress.ts`, `tests/core/progress.test.ts`

**Interfaces:**
- Consumes: Task 3 routes; `ChapterInfo` (type-only, Task 1); `SectionResult`, `ProgressMark` (type-only, Task 2).
- Produces in `src/api.ts` (optional trailing `fetchFn`, all reject on failure):
  ```ts
  getResults(mode: 'stage0' | 'section' | 'chapter-test'): Promise<SectionResult[]>
  getProgress(): Promise<ProgressMark[]>
  putMark(chapter: number, kind: 'read' | 'override'): Promise<ProgressMark>
  deleteMark(chapter: number): Promise<void>
  ```
- Produces in `src/core/progress.ts`:
  ```ts
  export type ResultsByMode = Record<'stage0' | 'section' | 'chapter-test', SectionResult[]>
  export type ChapterState = {
    chapter: number; cleared: boolean
    how?: 'passed' | 'drills' | 'read' | 'override'
    locked: boolean; blockedBy?: number
  }
  export function chapterStates(chapters: readonly ChapterInfo[], results: ResultsByMode, marks: readonly ProgressMark[]): Map<number, ChapterState>
  export function currentChapter(chapters: readonly ChapterInfo[], states: ReadonlyMap<number, ChapterState>): number
  export function requirementText(info: ChapterInfo): string
  ```
- Semantics (spec 4.1, "Settled for M3"): `cleared` — gate `stage0`: the `stage0` result for section `pseudo-test` has `passed`; gate `test`: the `chapter-test` result for `testListId` has `passed`; gate `drills`: every `listIds` entry has a `section` result with `passed`; gate `read`: a `read` mark. These natural clears give `how` `passed` / `passed` / `drills` / `read`; otherwise an `override` mark clears any gate with `how: 'override'` (a `read` mark clears only `read` gates). `locked` is false for chapters 1–4; for N ≥ 5 it is true iff some chapter M with 4 ≤ M < N is not cleared, and `blockedBy` is the smallest such M. `currentChapter` is the first chapter ≥ 4 that is not cleared, or the last chapter when all are. `requirementText`: `stage0` → `Pass the Chapter 4 test: 90% accuracy within 10 minutes`; `test` → `Pass the chapter test: 90% accuracy and at least 10 wpm` (numbers from `passMark`); `drills` → `Do each section drill once at 90% accuracy or better`; `read` → `Read the chapter, then mark it as read`.

- [ ] **Step 1: Write the failing tests:** `api.test.ts`: URL/method/body shapes for the four calls, rejection on non-2xx. `progress.test.ts`: a state matrix over a small fixture chapter list (4 stage0, 5 test, 6 test, 12 drills, 18 read): nothing done → chapter 4 open and uncleared, 5–18 locked with `blockedBy` 4; Stage 0 passed → 5 open; 5's test not passed but override mark on 5 → 6 open with `how: 'override'`; a `passed: false`-only result never clears; `drills` needs every list (one missing keeps it uncleared); a `read` mark clears a `read` gate but not a `test` gate; chapters 1–3 never lock; `currentChapter` moves forward and stops at the last; `requirementText` for each gate with the fixture's pass marks (`minWpm` 5 reads `at least 5 wpm`).
- [ ] **Step 2: Run** `npx vitest run tests/api.test.ts tests/core/progress.test.ts` — fails.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** `feat: progress calls and the pure gate logic`.

### Task 5: Pass marks in the drill and the chapter-test builder

**Files:**
- Modify: `src/ui/Drill.tsx`, `tests/ui/Drill.test.tsx`
- Create: `src/core/chaptertest.ts`, `tests/core/chaptertest.test.ts`

**Interfaces:**
- Consumes: `ChapterInfo` (Task 1), `DrillItem` from `src/core/drill.ts`, `shuffle` from `src/stage0/lists.ts`.
- Produces:
  - `Drill`'s `passMark` prop becomes `{ accuracy: number; maxMinutes?: number; minWpm?: number }`; `judge` additionally requires `stats.wpm >= minWpm` when present. Everything else about `Drill` is unchanged.
  - ```ts
    export const CHAPTER_TEST = { words: 45, repetitions: 3 } as const
    export function buildChapterTest(items: readonly DrillItem[], random?: () => number): DrillItem[]
    export function drillPassMark(info: ChapterInfo): { accuracy: number; maxMinutes?: number; minWpm?: number } | undefined
    ```
    `buildChapterTest`: shuffle, keep the first `CHAPTER_TEST.words` distinct prompts (all of them when fewer), then repeat each one `CHAPTER_TEST.repetitions` times in a row (`[a,a,a,b,b,b,…]`). `drillPassMark`: `stage0` → `{ accuracy, maxMinutes }` from the book's pass mark; `test` → `{ accuracy, minWpm }`; `drills` → `{ accuracy: 0.9 }`; `read` → `undefined`.

- [ ] **Step 1: Write the failing tests:** `Drill`: with `passMark: { accuracy: 0.9, minWpm: 10 }` a perfect but slow run (use the existing fake-clock rig) is `passed: false` in `onDone` and in the logged `meta`, a fast one is `true`, `minWpm` omitted behaves as before; existing pass-mark tests unchanged. `chaptertest.test.ts`: 135 prompts from a 396-item list, 45 distinct, every prompt appears exactly three times consecutively; deterministic with a seeded `random`; different seeds differ; 30 items → 90 prompts; empty list → `[]`; duplicates in the input count once; `drillPassMark` for each gate with fixture `ChapterInfo`s.
- [ ] **Step 2: Run** `npx vitest run tests/ui/Drill.test.tsx tests/core/chaptertest.test.ts` — the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: minimum wpm in the drill pass mark and the chapter-test builder`.

### Task 6: Progress state shared across the app

**Files:**
- Create: `src/state/progress.tsx`, `tests/state/progress.test.tsx`
- Modify: `src/ui/App.tsx` (wrap the app in `ProgressProvider`, inside `UniProvider`)

**Interfaces:**
- Consumes: `/content/chapters.json`, `/content/practice-index.json`, `getResults`, `getProgress`, `putMark`, `deleteMark`, `chapterStates` (Tasks 1–4).
- Produces:
  ```ts
  export type Progress = {
    status: 'loading' | 'ready' | 'error'
    chapters: ChapterInfo[]; index: PracticeIndexEntry[]
    results: ResultsByMode; marks: ProgressMark[]
    states: Map<number, ChapterState>        // empty unless status === 'ready'
    reload(): Promise<void>
    setMark(chapter: number, kind: 'read' | 'override'): Promise<void>   // rejects if the write fails
    clearMark(chapter: number): Promise<void>
  }
  export function ProgressProvider(props: { children: ComponentChildren }): JSX.Element
  export function useProgress(): Progress
  ```
  Loads once on mount; `reload()` refetches results and marks (content is static) and never leaves a half-updated state; a stale response never overwrites a newer one; `setMark` / `clearMark` write, then reload. On any load failure `status` is `'error'` and `states` is empty, so nothing is locked (the global constraint); `reload()` after an error retries everything. `useProgress` outside a provider throws a clear error.

- [ ] **Step 1: Write the failing tests** (mock `src/api.ts` and `fetch`): loads and exposes states; a failed results call → `error`, `states` empty (`isLocked`-style checks all false), then `reload()` recovers; a slow earlier `reload` cannot overwrite a newer one; `setMark` writes then reflects the new state and a failed write rejects without changing state; unmount mid-load is safe; `useProgress` without a provider throws.
- [ ] **Step 2: Run** `npx vitest run tests/state/progress.test.tsx` — fails.
- [ ] **Step 3: Implement**; wire into `App` and update `tests/ui/App.test.tsx`'s fetch/api mocks so the shell still renders.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: shared progress state`.

### Task 7: Section drills and chapter tests as routes

**Files:**
- Create: `src/ui/DrillRunner.tsx`, `src/ui/ListDrillRoute.tsx`, `src/ui/ChapterTestRoute.tsx`, `src/ui/LockedNotice.tsx`, `tests/ui/DrillRunner.test.tsx`, `tests/ui/ListDrillRoute.test.tsx`, `tests/ui/ChapterTestRoute.test.tsx`
- Modify: `src/ui/App.tsx` (route dispatch), `src/ui/Stage0Route.tsx` (call `progress.reload()` when a run finishes), `tests/ui/Stage0Panel.test.tsx` / App tests as needed

**Interfaces:**
- Consumes: `Drill` (with `passMark`, `hints`, `view` default), `createTestLogger`, `useBoardVisibility`/`VisibilityPicker`, `useHints`/`HintPicker`, `QuickNote`, `useProgress` (Task 6), `buildChapterTest`, `drillPassMark` (Task 5), `shuffle`, content lists at `/content/practice/<id>.json` (`PracticeList`).
- Produces:
  - Routes (inside the existing `drill` route; the id after `/drill/`): `list/<listId>` → `ListDrillRoute` and `test/<chapter>` → `ChapterTestRoute`; `stage0/…` unchanged; anything else keeps today's "No such drill" message.
  - `DrillRunner({ title, backHref, backLabel, chapter, items, logTest, passMark, requirement? })`: owns the per-run logger and fresh items per attempt (`Again`), board and hint pickers (hint picker always, prompts are words), the `Drill` (`kind="word"`), and the result card: Accuracy, Speed, Words, Time, a verdict line when `passed !== null` (`Passed` / `Not yet`) with the requirement text, `Again`, a link back (`backLabel`), a `Next chapter` link when the progress state shows this chapter cleared, and `QuickNote`. After a finished run it calls `progress.reload()`. Leaving early changes nothing in progress.
  - `ListDrillRoute({ listId })`: finds the list in `progress.index` (unknown id → message + link home), loads its JSON, runs all its items shuffled, `logTest { mode: 'section', chapter, section: listId }`; `passMark` is `{ accuracy: 0.9 }` only when the chapter's gate is `drills`, else none.
  - `ChapterTestRoute({ chapter })`: needs a chapter whose gate is `test` (otherwise message + link to its page), loads `testListId`, `buildChapterTest`, `logTest { mode: 'chapter-test', chapter, section: testListId }`, `passMark: drillPassMark(info)`.
  - `LockedNotice({ chapter, blockedBy })`: both routes show it instead of the drill when the chapter's state is `locked`: the blocking chapter's requirement, a link to that chapter's page, and a button `Open anyway` that calls `setMark(blockedBy, 'override')`; once the state turns unlocked the drill appears without a reload. While `status` is `loading` show `Loading…`; when `error` run the drill unlocked.

- [ ] **Step 1: Write the failing tests** (mock `src/api.ts` like `FreeRoute.test.tsx`, drive the fake board like `Drill.test.tsx`): list route logs `mode 'section'`, the right chapter and section, no pass mark for a `test`-gate chapter and `{ accuracy: 0.9 }` for a `drills` chapter; chapter test route shows 135 prompts of 45 distinct words, logs `mode 'chapter-test'` with `section '5-test'`, and a fast perfect run records `meta.passed: true`, a slow one `false`; the result card shows the verdict and requirement and calls `reload`; `Again` makes a fresh logger and fresh items; a locked chapter shows `LockedNotice` and starts no drill, `Open anyway` writes the override for `blockedBy` and the drill appears; `status: 'error'` runs the drill unlocked; unknown list id / non-test chapter messages; leaving early writes no verdict and `reload` is not called; Stage 0 finishing now triggers `reload` and its tests are otherwise unchanged.
- [ ] **Step 2: Run** the new test files — fail.
- [ ] **Step 3: Implement.** Reuse, do not copy: take the layout and result-card styling from `Stage0Route`/`FreeRoute` (extracting a shared piece is fine when it keeps their tests green unchanged).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: section drills and chapter tests with gate verdicts`.

### Task 8: The chapter panel and live practice links in the reader

**Files:**
- Create: `src/ui/ChapterPanel.tsx`, `src/ui/chapterpanel.css`, `tests/ui/ChapterPanel.test.tsx`
- Modify: `src/ui/Reader.tsx`, `tests/ui/Reader.test.tsx`, `src/ui/reader.css`

**Interfaces:**
- Consumes: `useProgress` (Task 6), `requirementText`, content lists/index, the routes from Task 7.
- Produces:
  - `ChapterPanel({ chapter })`, shown at the top of every chapter page (page id `chNN`) above the article (on `ch04` it sits below the existing `Stage0Panel`): the chapter title is not repeated; it shows the status (`Cleared · passed` / `drills` / `read` / `moved on` / `Open` / `Locked until Chapter M is cleared`), the requirement (`requirementText`), the chapter's drills (for `drills` and `test` gates: each `listIds` entry with its title text from the book link where available else its id, word count, `Last: 92% · 31 wpm` or `—`, a `Start` link to `/drill/list/<id>`), the chapter test for `test` gates (`Take the chapter test` → `/drill/test/<n>`, best and last result, the shape `45 words, 3 times each`), and the actions: `Mark as read` (gate `read`, not yet cleared), `Move on anyway` (any uncleared gate), and `Undo` when the clear came from a mark (`clearMark`). A locked chapter shows the lock line and an `Open anyway` button for its `blockedBy` chapter. While progress is `loading` render nothing extra; on `error` render a single quiet line with `Try again` (calls `reload`).
  - Live practice links in the Reader: after the page HTML is in the DOM and progress is ready, every `a.practice-link[data-list]` gets an `href` (`/drill/test/<n>` for ids matching `^\d+-test$`, else `/drill/list/<id>`) and a trailing `<span class="practice-link__meta">` with ` · <count> words · last 92% · 31 wpm` (`· not tried` when none; `· locked` when the chapter is locked). The pass is idempotent (re-running replaces the spans), leaves the book's link text alone, and a plain click on such a link navigates in-app (extend the Reader's existing click handler for `/drill/` hrefs). Links that are the only content of their paragraph render as a row (full-width, subtle border) via CSS; links inside lists stay inline.

- [ ] **Step 1: Write the failing tests:** `ChapterPanel` for each gate kind and state (stage0 open / cleared by pass; test open with a best result; test cleared by pass; drills partially done; read not marked then marked; locked with `blockedBy`; override then `Undo`); buttons call `setMark` / `clearMark` with the right arguments and the panel reflects the result; `error` line and `Try again`. Reader: a page whose HTML has `a.practice-link` anchors gets hrefs and meta text (count from the index, last result from progress), test links point at `/drill/test/5`, a re-render does not duplicate the spans, a locked chapter's links say `locked` but still navigate, a plain click navigates and a modified click does not; chapter pages show the panel, the home and appendix pages do not; `ch04` shows both `Stage0Panel` and the panel.
- [ ] **Step 2: Run** `npx vitest run tests/ui/ChapterPanel.test.tsx tests/ui/Reader.test.tsx` — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: chapter panel and live practice rows in the reader`.

### Task 9: Chapter state in the nav and on the Practice tab

**Files:**
- Modify: `src/ui/Nav.tsx`, `src/ui/Practice.tsx`, `src/ui/practice.css`, `src/ui/reader.css`
- Modify: `tests/ui/Practice.test.tsx`, plus a nav test file (`tests/ui/Nav.test.tsx`) if none exists

**Interfaces:**
- Consumes: `useProgress`, `currentChapter`, `ChapterPanel` (Task 8).
- Produces: in the chapter list, chapters whose state is `locked` are greyed (muted text, `aria-label` / title ending `, locked until Chapter M is cleared`) and cleared chapters carry a `✓` before the title (`aria-label` ending `, cleared`); locked links still navigate (chapters stay readable); while progress is not `ready` the nav looks exactly as before. The Practice tab gets a first section `Where you are` that renders `ChapterPanel` for `currentChapter(...)` (and a `Go to Chapter N` link to its page); the free-type and Chapter 4 sections below are unchanged.

- [ ] **Step 1: Write the failing tests:** nav markers for locked / cleared / open from a fixture state, no markers while loading or on error, links unchanged; Practice shows `Where you are` with the current chapter's panel (chapter 4 when nothing is cleared; chapter 6 when 4 and 5 are cleared), and still shows the free-type and Chapter 4 sections; existing Practice tests keep passing (add the provider to their render helper).
- [ ] **Step 2: Run** the touched test files — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: chapter state in the nav and a Where you are panel on Practice`.

### Task 10: Docs and end-to-end check

**Files:**
- Modify: `README.md`, `docs/superpowers/m0-m1-followups.md` (only if an item is now resolved or changed)
- Create: `docs/superpowers/m3-checklist.md`

- [ ] **Step 1: README:** describe chapter panels, live practice rows, section drills, chapter tests (45 random words, 3 times each, hint only on a miss, pass needs the book's accuracy and minimum wpm), gates and `Move on anyway` / `Mark as read` / `Undo`, that Chapter 4 stays open and chapters 1–3 never block, and that progress is derived from your recorded runs plus the few marks you set (so `data/steno.db` is the only place it lives). Keep every claim verifiable from the code or tests.
- [ ] **Step 2: `m3-checklist.md`** — checks only the owner can do on the real board: the Chapter 5 panel shows locked until Stage 0 is passed or overridden; `Open anyway` works and the drill starts; a section drill from a book link logs and the row shows the last result when you return; a 135-prompt chapter test runs (each word three times in a row, hint only after a miss) and a pass at the book's accuracy and wpm clears Chapter 5 and unlocks 6; a slow-but-accurate run says `Not yet`; leaving a test early changes nothing; `Undo` on an override relocks; nav ticks and greying; the Practice tab's `Where you are` follows your progress; Hint `always` still works in section drills.
- [ ] **Step 3: Verify:** `npm test`, `npm run typecheck`, `npm run build` all green. Then run `NO_OPEN=1 PORT=5801 node server/main.ts` in the background (keep its PID), fetch `/content/chapters.json`, `/api/results?mode=section`, `/api/progress`, `/api/health` (all 200; first two arrays), confirm `ls data` is unchanged (reads created nothing), stop it with `kill <pid>` (never a pattern kill). Do not write to the real `data/`.
- [ ] **Step 4: Commit** `docs: M3 readme and real-board checklist`.
