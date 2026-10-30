# Lapwing Lab M7 (ghosts, real text, routines) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ghosts of past runs, real-text practice and a routine planner to Lapwing Lab.

**Architecture:** Pure logic in `src/core/` (ghost, realtext, routine) with unit tests; thin file/DB access in `server/` behind new `/api/ghost`, `/api/texts`, `/api/routines` routes; Preact UI that reuses `Drill`/`DrillRunner`/`FreeRoute` hosts. Ghosts are derived from the archived strokes by the existing `replayItems`; routine ticks are derived from the archive; nothing new is stored except texts (`data/texts/`) and routines (`data/routines.json`).

**Tech Stack:** Node 26 (`node:sqlite`, `.ts` run directly), plain Node `http`, Vite + Preact 11 + TypeScript, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-30-lapwing-lab-m7-routines-ghosts-text-design.md`

## Global Constraints

- Match the surrounding code: comment density, naming, idiom (look at `src/core/fixup.ts`, `server/fixup.ts`, `src/ui/Fixup.tsx`, `src/ui/FixupRun.tsx` first). Pure `src/core/*.ts` have no DOM, fetch or Node imports.
- Offline, `127.0.0.1` only. No new dependencies.
- `data/` (the owner's real database, journal, settings, notes, reports) must never be read, written or listed by code under test or by you. Tests use temp directories (see existing `tests/server/*.test.ts`).
- Copy never scolds or advises; wording is neutral ("3 ahead", "3 behind", "level"). No wpm shown for runs that have none.
- Server input is validated before any file access (ids against a pattern first). Bad input answers 400, missing things 404, wrong method 405 via `allow`.
- Every new run host logs tests exactly like the existing ones (lazy `createTestLogger`, `logTest`, the `Drill` host).
- A fix-up run never has a ghost.
- Each task: TDD, run `npm test`, `npm run typecheck` before the last commit.

## Review Focus

- A past run with fewer than 5 completed words, or an abandoned run, never becomes a ghost; a ghost that cannot load changes nothing in the drill.
- Pasted text that is empty, whitespace, only numbers/symbols, or has zero strokable words: calm message, no empty drill; curly quotes and `don’t` match `don't`; a 200,001-character paste is refused by client and server.
- Text ids and routine ids like `../x`, `a/b`, `%2e%2e`, empty or over-long are rejected (400) before any file access.
- A routine step naming a deleted text, an unreached list or an unknown free source shows as unavailable (no link, no crash) and never ticks.
- A corrupt `data/routines.json` or `data/texts/*.json` is treated as none/skipped (no 500); settings with an unknown `ghost` value fall back to `best`.
- "Today" is the local calendar date (a run just after midnight belongs to the new day); a step done outside the routine page still ticks.

---

### Task 1: Ghost core

**Files:**
- Create: `src/core/ghost.ts`
- Test: `tests/core/ghost.test.ts`

**Interfaces:**
- Consumes: `replayItems(rows: {expected: string[]; pressedMask: number; correct: boolean}[]): {item: number; completes: boolean}[]` from `src/core/chaptertest.ts`; `lastSeenText(tsMs, nowMs): string` from `src/core/fixup.ts` ("today" / "yesterday" / "N days ago").
- Produces (exact):
  ```ts
  export const MIN_GHOST_WORDS = 5
  export const GHOST_CANDIDATES = 30
  export type GhostRow = { tsMs: number; expected: string[]; pressedMask: number; correct: boolean }
  /** An earlier run's pace: `completions[i]` is the ms from its first stroke to the completion of its (i+1)th word. */
  export type Ghost = { testId: number; endedAt: number; wpm: number; completions: number[] }
  export type ActiveGhost = Ghost & { label: 'Best' | 'Last' }
  export function completionTimes(rows: readonly GhostRow[]): number[]
  export function pickGhosts(runs: readonly Ghost[]): { best: Ghost | null; last: Ghost | null }
  export function ghostCount(ghost: Ghost, elapsedMs: number): number
  export function compareToGhost(ghost: ActiveGhost, nowMs: number, you: { completed: number; elapsedMs: number }): string
  ```

- [ ] **Step 1: Write failing tests** in `tests/core/ghost.test.ts`:
  - `completionTimes`: two single-stroke words typed clean at ts 1000, 2500, 4000 → `[0, 1500, 3000]` for three words; a word with a miss row then a correct row completes at the correct row; a two-stroke word (`expected: ['TKPWEPB','SKP']`... use any valid outlines) completes at its last stroke; a star-undo inside a word does not add a completion; `[]` → `[]`; rows that never complete → `[]`. Times are relative to `rows[0].tsMs`.
  - `pickGhosts`: runs with fewer than `MIN_GHOST_WORDS` completions are ignored; best = highest wpm (tie → higher `endedAt`); last = highest `endedAt` (tie → higher `testId`); `best` and `last` may be the same run; no qualifying runs → both null.
  - `ghostCount`: counts completions `<= elapsedMs` (0 before the first, all after the last, boundary inclusive).
  - `compareToGhost`: `{label:'Best', endedAt: now - 3 days, completions:[...22 entries ≤ 41000]}` with you `{completed: 25, elapsedMs: 41000}` → exactly `Best run (3 days ago) had 22 words by 0:41. You: 25 — 3 ahead.`; behind → `… You: 20 — 2 behind.`; equal → `… — level.`; singular `1 word`; `Last` label gives `Last run (yesterday) …`.
- [ ] **Step 2: Run** `npx vitest run tests/core/ghost.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/core/ghost.ts` with the signatures above. `completionTimes` maps `replayItems(rows)` flags to `rows[i].tsMs - rows[0].tsMs`. Format `m:ss` with an existing helper in `src/core/format.ts` if there is one, else a small local one (seconds rounded).
- [ ] **Step 4: Run** the test file → PASS.
- [ ] **Step 5: Commit** `feat: ghost core (completion times, picking, comparison)`.

---

### Task 2: Ghost server, setting and client call

**Files:**
- Modify: `server/archive.ts` (new `Archive.ghostRuns`), `server/settings.ts` (`ghost` field), `server/server.ts` (settings PUT validation, `/api/ghost`), `src/api.ts` (`getGhosts`)
- Create: `server/ghost.ts`
- Test: `tests/server/ghost.test.ts`; extend the existing settings tests and API tests for the new field/function (find them under `tests/server/` and `tests/api.test.ts`)

**Interfaces:**
- Consumes: Task 1 `completionTimes`, `pickGhosts`, `GHOST_CANDIDATES`, `Ghost`, `GhostRow`.
- Produces:
  ```ts
  // Archive
  ghostRuns(mode: string, section: string, limit: number): { testId: number; endedAt: number; wpm: number; rows: GhostRow[] }[]
  // server/ghost.ts
  export function buildGhosts(archive: Archive, mode: string, section: string): { best: Ghost | null; last: Ghost | null }
  // Settings
  ghost: 'best' | 'last' | 'off'   // default 'best'
  // src/api.ts
  export async function getGhosts(mode: string, section: string, fetchFn?: FetchFn): Promise<{ best: Ghost | null; last: Ghost | null }>
  ```
  `GET /api/ghost?mode=&section=` → `{best, last}`.

- [ ] **Step 1: Write failing tests.**
  - `ghostRuns`: returns the newest `limit` finished (`ended_at` set), non-abandoned (`meta.abandoned` not true) runs of that mode+section that have `wpm` not null, newest first, each with its stroke rows in id order; unfinished, abandoned and other-section runs are left out.
  - `buildGhosts`: three runs → best is the highest-wpm one with ≥5 completions; last the newest with ≥5; a 4-word run never qualifies.
  - `/api/ghost`: 200 with `{best:null,last:null}` when the archive does not exist yet (no `data` dir is created by the GET); 200 with real ghosts for seeded runs; 400 for missing `section`, `mode` not in `free|section|chapter-test|stage0|text`, `section` over 100 chars (`mode=fixup` is a 400 too); 405 for POST.
  - Settings: default `ghost` is `'best'`; a file with `"ghost":"last"` reads back; an unknown value falls back to `'best'`; PUT accepts `best|last|off`, rejects anything else with 400 and the file is not changed; an old settings file without the field is fine.
  - `getGhosts` builds `/api/ghost?mode=…&section=…` with both values URL-encoded and rejects on a non-2xx.
- [ ] **Step 2: Run** the new/extended tests → FAIL.
- [ ] **Step 3: Implement.** SQL for `ghostRuns` follows `selectLast` (same filters plus `wpm IS NOT NULL`, `ORDER BY ended_at DESC, id DESC LIMIT ?`) and `selectStrokes`; rows map to `GhostRow` (`tsMs`, `expected`, `pressedMask`, `correct`). The route reads `mode`/`section` from the query, answers from `ctx.existingArchive()` (empty ghosts when there is none), calls `buildGhosts(archive, mode, section)` with `GHOST_CANDIDATES`. Add `ghost` to `Settings`, its validator, `readSettings` fallback, `writeSettings`, and the `/api/settings` PUT check (message style of `bad('ghost', 'one of best, last, off')`).
- [ ] **Step 4: Run** the full affected test files → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: /api/ghost, ghost setting, getGhosts`.

---

### Task 3: Ghost in the drill (UI)

**Files:**
- Create: `src/ui/GhostPicker.tsx` (setting hook + button group, mirrors `HintPicker.tsx`), `src/ui/useGhost.ts`, `src/ui/GhostLine.tsx`, `src/ui/ghost.css`
- Modify: `src/ui/Drill.tsx` (new `ghost` prop), `src/ui/FreeRoute.tsx`, `src/ui/DrillRunner.tsx` (section drills and chapter tests), `src/ui/Stage0Route.tsx`
- Test: `tests/ui/GhostLine.test.tsx`, `tests/ui/GhostPicker.test.tsx`, additions to `tests/ui/Drill.test.tsx` and the host tests

**Interfaces:**
- Consumes: Task 1 `ActiveGhost`, `ghostCount`, `compareToGhost`; Task 2 `getGhosts`, `Settings['ghost']`.
- Produces:
  ```ts
  // GhostPicker.tsx
  export type GhostChoice = Settings['ghost']
  export function useGhostChoice(): [GhostChoice, (next: GhostChoice) => void]   // starts 'best', takes the stored value, saves a pick
  export function GhostPicker(p: { value: GhostChoice; onPick(next: GhostChoice): void }): JSX.Element   // "Ghost" group: best / last / off
  // useGhost.ts
  export function useGhost(mode: string, section: string | null, choice: GhostChoice, attempt: number): ActiveGhost | null
  // GhostLine.tsx
  export function GhostLine(p: { ghost: ActiveGhost; you: number; elapsedMs: number; total: number | null; nowMs: number }): JSX.Element
  export function GhostNote(p: { ghost: ActiveGhost | null; stats: DrillStats }): JSX.Element | null   // the compareToGhost line, null without a ghost
  // Drill prop
  ghost?: ActiveGhost | null
  ```

- [ ] **Step 1: Write failing tests.**
  - `GhostLine`: text is `Ghost (best, 3 days ago) 14 · You 12`; two tracks marked `aria-hidden`; the line is not a live region (no `aria-live`/`role="status"`).
  - `GhostPicker`/`useGhostChoice`: shows best/last/off with `aria-pressed`; starts `best`; takes the stored setting; a pick calls `putSettings({ghost})`; a pick made before the stored value arrives is not overwritten.
  - `useGhost`: returns null for `off`, null when `section` is null, null when `getGhosts` rejects, `{...best, label:'Best'}` / `{...last, label:'Last'}` per choice; refetches when `attempt` changes.
  - `Drill`: with a ghost whose completions are `[1000, 2000, 3000]` and a fake clock, before the first stroke the ghost count is 0; after the first stroke and the clock advancing 2500 ms the line says ghost 2 (the drill redraws without any stroke); with the drill paused (dock open) the ghost count does not advance; without the `ghost` prop nothing is rendered and nothing ticks. `FixupRun` passes no ghost (assert its Drill renders no ghost line).
  - Hosts: `FreeRoute`, section-list `DrillRunner`, chapter-test and Stage0 pass `getGhosts` the run's `logTest.mode` and `logTest.section`; the result card of each shows the `compareToGhost` line when a ghost was loaded and nothing when not; the pickers row has the Ghost group.
- [ ] **Step 2: Run** the new tests → FAIL.
- [ ] **Step 3: Implement.** `Drill` adds a lightweight 250 ms redraw interval only while a ghost is present and the run is not finished (reuse the existing countdown tick if one runs); the ghost position is read from the session clock relative to the first judged stroke (the same `startedAt` ref the timer uses) so pauses freeze it. The line sits under the existing status. Hosts call `useGhost(logTest.mode, logTest.section, choice, run)` and pass the result to `Drill` and to `GhostNote` inside their result card (above the QuickNote). Keep the ghost fetch from delaying the drill (no waiting on it). Styling in `ghost.css` follows `fixup.css`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: ghost line, picker and result note in drills`.

---

### Task 4: Real-text core

**Files:**
- Create: `src/core/realtext.ts`
- Test: `tests/core/realtext.test.ts`

**Interfaces:**
- Consumes: `DictCard` from `scripts/lib/dictionary.ts` (`{t: string; r: {o: string}[]; n?: true}`); `DrillItem` from `src/core/drill.ts`; `parseOutline` from `src/core/steno.ts` (throws on a bad outline).
- Produces (exact):
  ```ts
  export const PART_SIZE = 100
  export const MAX_TEXT_CHARS = 200000
  export type TextPlan = {
    items: DrillItem[]                 // strokable words in text order; kind 'word'
    words: number                      // tokens with a letter
    covered: number                    // words (not items) that were matched: words minus the sum of missing counts; never above `words`
    skipped: number                    // tokens without a letter (numbers, symbols)
    missing: { word: string; count: number }[]   // count desc, then word asc
  }
  export function buildLookup(cards: readonly DictCard[]): ReadonlyMap<string, string[]>
  export function planText(text: string, lookup: ReadonlyMap<string, string[]>): TextPlan
  export function partsOf<T>(items: readonly T[], size?: number): T[][]
  export function textIdFor(name: string, taken: readonly string[]): string
  ```

- [ ] **Step 1: Write failing tests.**
  - `buildLookup`: maps each non-named card's exact `t` to its row outlines in order; skips cards with `n: true`; drops outlines `parseOutline` rejects (and a card left with none); does not mutate its input.
  - `planText`: `"The cat sat."` with cards `the`, `cat`, `sat` → three items with prompt = the matched card text and `outlines` from the lookup; `"I"` matches an `I` card exactly; `"The"` with only a `the` card matches via lower case; `"Paris"` matches an exact `Paris` card but not `paris` alone; punctuation trimmed (`"cat,"`, `"(cat)"`, `"“cat”"`), inner apostrophe kept and curly `’` normalised (`don’t` → `don't`); `well-known` matches whole, else its parts `well` and `known` both; tokens `42`, `—`, `3.5` count in `skipped` and are not words; unknown words go to `missing` with counts, sorted; repeated words repeat in `items` (text order); empty/whitespace text → all zero and empty; a 5,000-word text finishes in well under a second.
  - `partsOf`: 230 items → sizes 100,100,30; 0 items → `[]`; exactly 100 → one part; custom size.
  - `textIdFor`: `"My Notes!"` → `my-notes`; accents/symbols collapse to single `-`, trimmed; over 40 chars cut (no trailing `-`); empty or all-symbols → `text`; a taken id gets `-2`, `-3`…; result always matches `^[a-z0-9]+(-[a-z0-9]+)*$`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per the spec's matching rules ("Part B"): split on Unicode whitespace; trim leading/trailing non-letter/digit characters (keep inner `'` and `-`); a token with no letter is skipped; lookup exact then lower-case; hyphen fallback to parts (if any part is unknown the whole token goes to `missing`, once, as written).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: real-text core (tokens, lookup, plan, parts)`.

---

### Task 5: Texts server and client calls

**Files:**
- Create: `server/texts.ts`
- Modify: `server/server.ts` (routes, `ctx.textsDir = join(dataDir, 'texts')`), `src/api.ts`
- Test: `tests/server/texts.test.ts`, `tests/api.test.ts` additions

**Interfaces:**
- Consumes: `writeFileAtomic` (`server/atomic.ts`), `MAX_TEXT_CHARS` (Task 4); route helpers in `server/server.ts` (`asObject`, `readBody`, `allow`, `HttpError`).
- Produces:
  ```ts
  // server/texts.ts
  export const MAX_TEXTS = 50
  export const MAX_NAME_CHARS = 60
  export function isTextId(id: string): boolean               // /^[a-z0-9]+(-[a-z0-9]+)*$/ and length ≤ 40
  export function listTexts(dir: string): { id: string; name: string; chars: number }[]   // sorted by name; unreadable/corrupt files skipped
  export function readSavedText(dir: string, id: string): { id: string; name: string; text: string } | null
  export function writeSavedText(dir: string, id: string, v: { name: string; text: string }): void
  export function deleteSavedText(dir: string, id: string): boolean   // false when there was none
  // src/api.ts
  listTexts(): Promise<{id,name,chars}[]>; getText(id): Promise<{id,name,text} | null>   // null on 404
  putText(id, {name, text}): Promise<...>; deleteText(id): Promise<void>
  ```
  Routes: `GET /api/texts`, `GET|PUT|DELETE /api/texts/:id`.

- [ ] **Step 1: Write failing tests** (temp dirs only): write/read/list/delete round trip; list sorted and skips a file with invalid JSON and a non-`.json` file; reading a missing id → null; `isTextId` rejects `../x`, `a/b`, `A`, `-a`, `a--b`, empty, 41 chars; API: invalid id 400 *and no file touched* (even for GET/DELETE); PUT with name blank/over 60/not a string → 400, text over `MAX_TEXT_CHARS` or not a string → 400, the 51st distinct id → 400 (overwriting an existing id at the limit is fine); unknown id GET/DELETE → 404; wrong method 405; `GET /api/texts` with no `data/texts` folder → `[]` without creating it.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Each text is `data/texts/<id>.json` = `{"name":…,"text":…}`; names are trimmed. Route style follows `/api/notes`.
- [ ] **Step 4: Run** → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: saved texts API`.

---

### Task 6: Real-text UI

**Files:**
- Create: `src/ui/Text.tsx`, `src/ui/TextRun.tsx`, `src/ui/text.css`, `src/state/pastedtext.ts`
- Modify: `src/router.ts`, `src/ui/App.tsx`, `src/ui/Practice.tsx` (a "Real text" card), the places that label a run's mode (History, Days, TestDetail, journal heading helpers — `grep -rn "Fix-up" src` finds them)
- Test: `tests/ui/Text.test.tsx`, `tests/ui/TextRun.test.tsx`, `tests/router.test.ts`, `tests/ui/Practice.test.tsx` additions, label tests where those components are tested

**Interfaces:**
- Consumes: Task 4 (`buildLookup`, `planText`, `partsOf`, `textIdFor`, `PART_SIZE`, `MAX_TEXT_CHARS`), Task 5 api calls, `loadDictionary` from `src/ui/tools/Lookup.tsx`, Task 3 (`GhostPicker`, `useGhostChoice`, `useGhost`, `GhostNote`, `Drill` `ghost`), `Drill`, `QuickNote`, `ConfirmDialog`, pickers.
- Produces:
  ```ts
  // router.ts: two new Route members
  | { name: 'text' }                                   // /practice/text
  | { name: 'text-run'; id: string; part: number }     // /practice/text/run/<id>/<part>, id is 'pasted' or a saved id, part ≥ 1
  // both belong to the 'practice' tab
  // pastedtext.ts
  export function setPasted(text: string): void; export function getPasted(): string
  // test mode: 'text'; chapter null; section `text/<id>/<part>`
  ```

- [ ] **Step 1: Write failing tests.**
  - Router: the two paths parse (`part` a positive integer; `/practice/text/run/x/0`, `/x/abc`, `/x/` → notfound); `tabOf` is `practice`.
  - `Text` page: a textarea, a name field, **Check**. After Check with dictionary and text loaded it shows `N of M words can be stroked (P%)`, the skipped-numbers count and the first 20 missing words with counts; empty/whitespace text shows a calm message and no Start; zero strokable words shows the same and no Start; text over `MAX_TEXT_CHARS` is refused with a message (nothing sent); **Start** (pasted) stores the text with `setPasted` and navigates to `/practice/text/run/pasted/1`; **Save** calls `putText` with `textIdFor(name, existingIds)` (name required, 1–60 chars) and the new text appears in the list; the list opens (navigates to run part 1), and deletes only after the confirmation; a dictionary or list load failure shows a calm error with the retry the other pages use.
  - `TextRun`: loads the text (`pasted` from the store, otherwise `getText`; unknown id or empty pasted → calm message with a link back to `/practice/text`), builds the plan, shows `Part 2 of 3` and the count of words in the part, runs `Drill` with `kind="word"`, `view="flow"`, items in text order, `logTest={{mode:'text', chapter:null, section:'text/<id>/<part>'}}`; a part number beyond the last → the same calm message; the result card has accuracy, speed, words, time, the ghost note, a `QuickNote`, `Next part` only when one exists, `Again`, `Back to text`; the ghost is requested for mode `text` and that section.
  - Labels: a `text` run is described `Text · <name or id> · part N` in History/Days/TestDetail (use `pasted` → `Text · pasted · part N`); its wpm shows normally.
  - Practice tab: a "Real text" card links to `/practice/text`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Follow `Fixup.tsx`/`FixupRun.tsx`/`FreeRoute.tsx` for structure. The dictionary lookup is built once per dictionary load (memoise on the loaded file). `TextRun` is keyed by `${id}/${part}` in `App.tsx`. `pasted` text lives only in the module store.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build` → PASS/clean.
- [ ] **Step 5: Commit** `feat: real-text practice page and run`.

---

### Task 7: Routine core

**Files:**
- Create: `src/core/routine.ts`
- Test: `tests/core/routine.test.ts`

**Interfaces:**
- Produces (exact):
  ```ts
  export const MAX_ROUTINES = 8
  export const MAX_STEPS = 12
  export const MAX_ROUTINE_NAME = 40
  export type RoutineStep =
    | { kind: 'list'; listId: string }
    | { kind: 'free'; source: string; mode: string }
    | { kind: 'fixup'; tab: 'words' | 'patterns' }
    | { kind: 'text'; id: string; part: number }
  export type Routine = { id: string; name: string; steps: RoutineStep[] }
  export type RoutineDoc = { routines: Routine[]; active: string | null }
  export const EMPTY_ROUTINES: RoutineDoc
  export function validateRoutineDoc(value: unknown): RoutineDoc   // strict; throws Error with a plain message; returns a clean copy
  export function stepSection(step: RoutineStep): { mode: string; section: string }
  export function stepHref(step: RoutineStep, opts?: { fromRoutine?: boolean }): string
  export type DoneTest = { mode: string; section: string | null; endedAt: number | null; abandoned: boolean }
  export function stepsDone(steps: readonly RoutineStep[], tests: readonly DoneTest[]): boolean[]
  export function nextUp(done: readonly boolean[]): number | null
  ```
  Id/name rules: id `/^[a-z0-9]+(-[a-z0-9]+)*$/` ≤ 40; name trimmed 1–40 chars; `list.listId` `/^\d+-[A-Za-z0-9_-]+$/`; `free.source` and `free.mode` `/^[A-Za-z0-9-]{1,30}$/`; `text.id` as routine id; `text.part` integer 1–99.

- [ ] **Step 1: Write failing tests.**
  - `validateRoutineDoc`: accepts `EMPTY_ROUTINES` and a full valid doc (returns an equal copy, not the same object); rejects (throws) non-objects, more than 8 routines, more than 12 steps, duplicate routine ids, a blank/over-long name, bad ids (`../x`), unknown step kinds, a bad `listId`, `part` 0 or 100 or 1.5, `tab` other than words/patterns, an `active` that names no routine (and accepts `null`); extra fields are dropped.
  - `stepSection`: list → `{mode:'section', section: listId}`; free → `{mode:'free', section:'<source>/<mode>'}`; fixup → `{mode:'fixup', section: tab}`; text → `{mode:'text', section:'text/<id>/<part>'}`.
  - `stepHref`: `/drill/list/<listId>`, `/practice/free/<source>/<mode>`, `/practice/fixup`, `/practice/fixup/patterns`, `/practice/text/run/<id>/<part>`; with `fromRoutine` the list, free and text ones end `?from=routine`, fix-up ones are unchanged.
  - `stepsDone`: a step is done when a test with its mode and section has `endedAt !== null` and `abandoned === false`; unfinished or abandoned do not count; two steps with the same target are both done by one test; no tests → all false. `nextUp`: index of the first false, or null when all done or no steps.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the types and functions; `validateRoutineDoc` builds a clean copy field by field.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: routine core (types, validation, step targets, done)`.

---

### Task 8: Routines server and client calls

**Files:**
- Create: `server/routines.ts`
- Modify: `server/server.ts` (`ctx.routinesFile = join(dataDir, 'routines.json')`, `/api/routines`), `src/api.ts`
- Test: `tests/server/routines.test.ts`, `tests/api.test.ts` additions

**Interfaces:**
- Consumes: Task 7 `validateRoutineDoc`, `EMPTY_ROUTINES`, `RoutineDoc`; `writeFileAtomic`.
- Produces:
  ```ts
  export function readRoutines(file: string): RoutineDoc    // missing, unreadable or invalid → EMPTY_ROUTINES
  export function writeRoutines(file: string, doc: RoutineDoc): void   // atomic; creates the folder
  // src/api.ts
  getRoutines(): Promise<RoutineDoc>; putRoutines(doc: RoutineDoc): Promise<RoutineDoc>
  ```
  Routes: `GET /api/routines` → the doc; `PUT /api/routines` with the whole doc → the saved doc.

- [ ] **Step 1: Write failing tests** (temp dirs): missing file → empty doc and GET creates nothing; corrupt JSON and a doc that fails validation → empty doc, no throw; PUT round trip; PUT with invalid doc → 400 with the validator's message and the stored file unchanged; wrong method 405; body of more than 1 MiB → 413 (existing behaviour).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; the route validates with `validateRoutineDoc` inside a try/catch that turns its error into `HttpError(400, message)`.
- [ ] **Step 4: Run** → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: routines API`.

---

### Task 9: Routine page, planner and Practice card

**Files:**
- Create: `src/ui/Routine.tsx`, `src/ui/RoutineEditor.tsx`, `src/ui/useRoutines.ts`, `src/ui/routine.css`, `src/ui/backTarget.ts`
- Modify: `src/router.ts` (`{ name: 'routine' }`, `/practice/routine`, practice tab), `src/ui/App.tsx`, `src/ui/Practice.tsx` (a "Routine" card), `src/ui/FreeRoute.tsx`, `src/ui/DrillRunner.tsx` and `src/ui/ListDrillRoute.tsx` (back target), `src/ui/TextRun.tsx`
- Test: `tests/ui/Routine.test.tsx`, `tests/ui/RoutineEditor.test.tsx`, `tests/ui/backTarget.test.ts`, `tests/router.test.ts`, `tests/ui/Practice.test.tsx` and host test additions

**Interfaces:**
- Consumes: Task 7 core, Task 8 `getRoutines`/`putRoutines`, `listTests({date, limit})` (`TestSummary` has `mode`, `section`, `endedAt`, `meta`), `listTexts` (Task 5), `localDate` (`src/core/days.ts`), `useProgress` (`index`, `chapters`, `states`), `taughtChapter`, `sourcesFor`/`FREE_MODES` (`src/freetype/free.ts`), `ConfirmDialog`.
- Produces:
  ```ts
  // backTarget.ts
  export function backTarget(href: string, label: string): { href: string; label: string }
  //  → { href: '/practice/routine', label: 'Back to routine' } when location.search has from=routine, else the arguments
  // useRoutines.ts
  export function useRoutines(): { status: 'loading' | 'error' | 'ready'; doc: RoutineDoc; save(doc: RoutineDoc): Promise<void>; reload(): void }
  ```

- [ ] **Step 1: Write failing tests.**
  - `backTarget`: with `?from=routine` returns the routine target; without it (or `?from=other`) returns the inputs.
  - `Routine` page, active routine of 4 steps with one finished test today: shows `1 of 4 done today`, the done step ticked, the first undone step marked "next up", each undone step has its `stepHref(step, {fromRoutine:true})` link (checklist semantics: a list with items, the tick as text/`aria` not colour only); steps whose text is gone (text id not in `listTexts`) or list id not in the practice index show as unavailable with no link and are never ticked; "today" is `localDate(Date.now())` and `listTests` is asked for that date; no routines → a calm line and **New routine**; load failure → calm error and retry.
  - Planner: **Make active** saves `active`; **Delete** only after the confirmation, deleting the active routine leaves `active: null`; **New routine** opens the editor; the 9th routine is refused with a message; **Edit** opens the editor with that routine.
  - `RoutineEditor`: name field (1–40; Save disabled otherwise); add each of the four step kinds (list choices limited to chapters ≤ `taughtChapter`; free-type source and mode choices; words/patterns; saved text + part number 1–99); move up/down (first can't move up, last can't move down), remove; the 13th step refused; **Save** calls `save` with a doc that passes `validateRoutineDoc` (new routine id via `textIdFor`-style slug of the name, unique); **Cancel** discards and saves nothing.
  - Practice card: shows the active routine's name and `N of M done today` with a link to `/practice/routine`; with no routine, a calm line and a link to plan one.
  - Hosts: with `?from=routine`, the back link/buttons of `FreeRoute` (back link, result card button, exit), the section-list `DrillRunner` result card and exit, and `TextRun` read "Back to routine" and go to `/practice/routine`; without it nothing changes.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Follow `Fixup.tsx` for page structure, `Journal`/`Notes` for save patterns, `ConfirmDialog` for confirmations. Ticks come from one `listTests({date, limit: 200})` call mapped to `DoneTest` (`abandoned` from `meta.abandoned === true`). `Routine.tsx` re-fetches when shown. Route is keyed so returning refreshes.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build` → PASS/clean.
- [ ] **Step 5: Commit** `feat: routine page, planner and Practice card`.

---

### Task 10: Docs

**Files:**
- Modify: `README.md` (features list, three short sections `## Ghosts`, `## Real text`, `## Routines`, the data files `data/texts/`, `data/routines.json`, the settings field `ghost`), `docs/superpowers/m0-m1-followups.md` (`## Left open by M7`: the spec's "Left out on purpose", pause-inflated ghost times, unreviewed minors from the ledger)
- Create: `docs/superpowers/m7-checklist.md` (numbered checks for the owner on real data, in the style of `m5b-checklist.md`; mark the ones that need the board vs not; include: ghost appears on the second run of the same free-type mode and not on a first; picker off hides it; ghost never in fix-up; paste a text with numbers and an unknown word and read the coverage; a 230-word text has 3 parts; saved text survives a reload, pasted does not; delete asks first; routine with all four step kinds ticks as runs finish; ticks reset the next day; deleting a text breaks nothing in a routine)

- [ ] **Step 1:** Read `README.md` and `m5b-checklist.md` for the voice; write the new text to match (plain, no advice copy).
- [ ] **Step 2:** Run `npm test` and `npm run typecheck` (docs only, but confirm the tree is green).
- [ ] **Step 3: Commit** `docs: M7 readme, checklist and follow-ups`.
