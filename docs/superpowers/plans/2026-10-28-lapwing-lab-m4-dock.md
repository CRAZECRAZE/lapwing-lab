# Lapwing Lab M4 — The Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four quick-pull tools one keypress away (Lookup, Key chart, Briefs so far, Notes) on every tab including the drill screens, plus generated drills for the table-only Chapters 18, 20 and 21 so they get real gates.

**Architecture:** The content build gains three outputs: generated practice lists for chapters 18/20/21 (written next to the book's lists, so the existing chapter-panel and drill-route machinery handles them unchanged), a lookup index, and a key chart. Notes get a small journal-style server module and routes. The journal's save queue is generalized so notes keep the same never-lose-text behavior. A dock provider owns which tool is open; a capture-phase key handler and four top-bar buttons open it; a drawer hosts the tools; `Drill` pauses while a tool is open.

**Tech Stack:** Node 26 (`node:sqlite`, runs `.ts` directly), Preact 11 + Vite, TypeScript, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-27-lapwing-lab-design.md` — §3.3 (including "Settled for M4"), §4.1, §9 (M4), §11 items 25–29. Prior plans: `docs/superpowers/plans/2026-10-27-lapwing-lab-m3-core-practice.md` (chapters/gates/progress), `docs/superpowers/plans/2026-10-27-lapwing-lab-m2-lab-shell.md` (journal, autosave, Drill).

## Global Constraints

- Offline and private: server on `127.0.0.1` only; no network calls; no new dependencies of any kind.
- Data lives under `data/`, created lazily: **no read path may create** `data/`, `data/steno.db`, `data/journal/` or `data/notes/`. Only a write creates them.
- The owner's words are never lost: notes use the journal's save queue (failed load ⇒ nothing is ever written; failed save keeps the text and retries; switching chapters saves each chapter's text to its own file; text outlives the view).
- Hotkeys never fire while typing in a text field; on drill screens only the `Alt+` forms fire (the sink swallows plain keys because the steno engine's stray output must not trigger anything); Esc with a tool open closes only the tool and never exits a drill.
- A drill never counts strokes or time while a tool is open.
- "Taught so far" is chapters up to the current chapter (`max(4, currentChapter)`); when progress is not ready or failed, nothing is hidden. Every hit names its chapter.
- Pass marks, gates, the chapter panel, Stage 0, free type, History/Days/Journal and the Hint setting keep working unchanged apart from the gate change for chapters 18, 20, 21 (they become `drills` gates).
- Style: follow the surrounding code (no semicolons, single quotes, 2-space indent, `.ts`/`.tsx` import suffixes, type-only imports from `server/` and `scripts/` in client code); colors only from the `:root` tokens in `src/ui/reader.css`; calm and dark; no emoji (the existing `✓` mark is fine).
- Preact 11 defers `useEffect` cleanup; use `useLayoutEffect` where cleanup must be synchronous, and guard async state with live/sequence flags. Every test must be able to fail for the regression it names (run a quick mutation check for the important ones); tests that assert nothing observable (e.g. "no state after unmount" without a `useState` spy) are not acceptable.
- Every commit leaves `npm test`, `npm run typecheck` and `npm run build` green.
- Branch `m4-dock` (off `main`). Do not push, merge or delete branches.

## Review Focus

Most likely first. Each has a test in the task named:

1. Hotkeys: never from a text field; bare keys never from the drill sink; `Alt+` forms work from the sink; `/` does not trigger the browser's quick find; Esc closes only the tool (Tasks 7).
2. A drill opened with a tool open or a tool opened mid-drill: no strokes logged, clock stopped, focus returns to the sink (Task 7).
3. Notes never lose text; paths are validated; reads create nothing (Tasks 5, 6, 11).
4. Lookup honors "taught so far" and the checkbox, ranks exact before prefix before substring, searches by outline when the query looks like steno, handles empty/whitespace/huge queries (Tasks 4, 8).
5. Generated drills: every item parses as a valid outline, prompts are distinct, counts match the book's tables, and Chapters 18/20/21 now gate on drills (Tasks 1, 2).

---

### Task 1: Example items and generated drills for Chapters 18, 20, 21

**Files:**
- Create: `scripts/lib/examples.ts`, `scripts/lib/generated.ts`, `tests/scripts/examples.test.ts`, `tests/scripts/generated.test.ts`
- Modify: `scripts/build-content.ts`, `tests/scripts/build-content.test.ts` (expectations that change are listed below)

**Interfaces:**
- Consumes: `parseOutline`/`tryParseStroke` from `src/core/steno.ts`; `marked`'s `Lexer` (already a dev dependency); `PracticeIndexEntry`, `ChapterInfo` and the practice-list writing in `scripts/build-content.ts`.
- Produces:
  ```ts
  // scripts/lib/examples.ts
  export type ExampleRow = { chapter: number; word: string; outlines: string[] }
  export function parseExampleItems(chapter: number, markdown: string): ExampleRow[]
  // scripts/lib/generated.ts
  export type GeneratedList = { id: string; chapter: number; items: { prompt: string; outlines: string[] }[] }
  export function generatedLists(chapter: number, markdown: string): GeneratedList[]   // [] for chapters other than 18, 20, 21
  ```
- `parseExampleItems`: every list item (any nesting, outside tables and code fences) whose text is a word or phrase followed by a code span that is a valid outline (every `/`-separated stroke parses) gives `{ word: <text before the code span, trimmed>, outlines: [span] }`; items that start with a code span, have no valid outline, or have an empty word are skipped; rows with the same lowercase word in a chapter are merged (outlines unique, in order of appearance).
- `generatedLists` (ids sort after the book's lists of the same chapter; every outline must parse or the build fails naming the list):
  - Chapter 18: `18-lowercase` (26 items; prompt = the letter `a`–`z`, outline from the "Lowercase" table), `18-uppercase` (26 items; prompt = the letter upper-cased `A`–`Z`, outline from the "Uppercase" table whose cells are labelled with lowercase letters), `18-numbers` (prompt = the digits from the "Numbers" table `0`–`9`, `00`, `000` with their outlines, plus the trailing-zero examples such as `#ER` → `10`, `#EUPB` → `5000`, `#UP` → `800`, `#EB` → `20`). Table cells look like `a <br> <steno-outline stroke="A*" …>`: label = text before `<br>`, outline = the `stroke` attribute.
  - Chapter 20: `20-punctuation` (first table under "Punctuation", columns Character | Name | Formatting | Steno outline | Mnemonic; prompt = `<Name> (<character>)`; when two rows would share a prompt, append ` — <Formatting text without a trailing period>` to each so prompts are distinct), `20-commands` (each `###` heading under "Commands" that is followed, before the next heading of level ≤ 3, by a `####` heading `Outline: <code span>`; prompt = the `###` heading text, outline = the code span; headings without an outline line are skipped).
  - Chapter 21: `21-uk-spellings` (the chapter's `parseExampleItems` rows; prompt = the word).
- Build: the generated lists are written to `content/build/practice/<id>.json` as `{ id, items }` and added to the practice index (`{ id, chapter, items }`) before it is sorted; `listIds` of chapters 18/20/21 are therefore non-empty and their gate becomes `drills` automatically (no test list). `BuildStats` keeps `practiceLists` and `practiceLines` for the book's own lists (57 and 7,299) and gains `generatedLists` (6).

- [ ] **Step 1: Write the failing tests.** `examples.test.ts` (small markdown fixtures + the real Chapter 21 and Chapter 5 sources): word-then-outline items, nested items, outline-first items skipped, invalid outline skipped, items in tables/code fences ignored, same-word merge, multi-word phrases (`how ever`), `\r\n` input; real book: Chapter 5 has `dad` → `TKAD`, Chapter 21 has `centre` → `SEPB/TER/#TPH`. `generated.test.ts` (real chapters): 18 gives exactly the three ids with 26/26/≥16 items and known pairs (`a`→`A*`, `A`→`A*P`, `z`→`STKPW*`, `0`→`#E`, `10`→`#ER`); 20-punctuation prompts all distinct and includes `Period (.)`→`TP-PL`, both Endash rows distinguished; 20-commands includes `Enter`→`R-R` and `Insert a space`→`S-P`; 21 has ≥ 25 items; every outline of every list parses; chapters other than 18/20/21 give `[]`; a fixture with a bad outline throws naming the list. `build-content.test.ts`: update the expectations that encoded the old state — the practice index now has 63 entries (57 + 6), chapters now span 5–21, `stats.practiceLists` stays 57 and `stats.generatedLists` is 6; `chapters.json`: chapters 18, 20, 21 are now `drills` (lists listed above, no `passMark`), chapters 1–3, 19, 22–26 stay `read`.
- [ ] **Step 2: Run** `npx vitest run tests/scripts` — new tests fail.
- [ ] **Step 3: Implement** the two modules and the build wiring.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`; `ls content/build/practice | wc -l` shows 63 files.
- [ ] **Step 5: Commit** `feat: generated drills for fingerspelling, numbers, punctuation, commands and UK spellings`.

### Task 2: Lookup index in the content build

**Files:**
- Create: `scripts/lib/lookup.ts`, `tests/scripts/lookup.test.ts`
- Modify: `scripts/build-content.ts`, `tests/scripts/build-content.test.ts`

**Interfaces:**
- Consumes: the practice lists (book only, not generated), `BriefRow[]` (chapters 5–12), `parseExampleItems` (Task 1) for every chapter page 1–26.
- Produces: `content/build/lookup.json` = `LookupEntry[]`, exported types from `scripts/lib/lookup.ts`:
  ```ts
  export type LookupSource = 'practice' | 'brief' | 'example'
  export type LookupHit = { outline: string; chapter: number; source: LookupSource; note?: string }  // note = a brief's explanation
  export type LookupEntry = { word: string; hits: LookupHit[] }
  export function buildLookup(input: { lists: PracticeList[]; briefs: BriefRow[]; examples: ExampleRow[] }): LookupEntry[]
  ```
  Entries are merged by lowercase `word` (display form of the first hit kept), hits unique by `(outline, chapter, source)` and sorted by chapter ascending, entries sorted by word. A practice list's chapter comes from its id (`practiceChapter`); each outline of each item becomes a hit. The build fails if `lookup.json` exceeds 5 MB and prints its size.

- [ ] **Step 1: Write the failing tests:** `lookup.test.ts` with small inputs (merge by lowercase word, unique hits, chapter ordering, note kept for briefs, empty word dropped); the build test on the real book: `cat` is present with a practice hit in Chapter 5, `are` has brief hits `R` and `-R` in Chapter 5 with the explanation as `note`, `dad` has an example hit `TKAD`, `centre` an example hit in Chapter 21, every outline of every hit parses, entries sorted, the file is under 5 MB.
- [ ] **Step 2: Run** `npx vitest run tests/scripts` — new tests fail.
- [ ] **Step 3: Implement** and wire into `buildContent` after the briefs are parsed (the examples need every chapter's markdown, so collect them in the existing page loop).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: lookup index in the content build`.

### Task 3: Key chart data in the content build

**Files:**
- Create: `scripts/lib/keychart.ts`, `tests/scripts/keychart.test.ts`
- Modify: `scripts/build-content.ts`, `tests/scripts/build-content.test.ts`

**Interfaces:**
- Produces: `content/build/keychart.json` = `KeyChartEntry[]`:
  ```ts
  export type KeyChartEntry = { slot: string; group: 'left' | 'vowel' | 'right' | 'special'; sounds: string[]; examples: string[]; source: string }
  export function parseKeyChart(chapter5Markdown: string): KeyChartEntry[]
  ```
  `slot` uses the names of `SLOTS` in `src/core/steno.ts`; exactly one entry per slot (23). Consonant entries come from the Chapter 5 "Consonant keys" table (`examples` = the table's example words with the `<ins>` markup removed, `sounds` = the underlined letters of those examples de-duplicated; `source` = that heading's title). Vowel entries (`A`, `O`, `E`, `U`) come from the Chapter 5 short-vowel sections: `sounds` and `examples` are taken from what the book says there (IPA or example words as written); an entry whose single sound the book does not state keeps empty `sounds` and fills `examples` only. `*` and `#` are `special` with a one-line description taken from the book (Chapter 4 layout text) in `sounds`. **Nothing is invented:** every `source` must be the title of a heading that exists in the Chapter 5 (or Chapter 4) page, which a test checks.

- [ ] **Step 1: Write the failing tests:** 23 entries, one per slot, no duplicates; the table's consonants (`S`, `T`, `K`, `-F`, `-S`, `-Z`…) have their examples (`K` → `king`, `car`; `-F` → `puff`, `cough`); groups are right (`S` left, `-T` right, `A` vowel, `*` special); every `source` is an existing heading title in the page JSON of its chapter; vowels have a non-empty `examples` or `sounds`; the build writes the file.
- [ ] **Step 2: Run** `npx vitest run tests/scripts` — fails.
- [ ] **Step 3: Implement**; read the vowel sections first and write down in the report which sentence each vowel entry came from.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: key chart data from the book`.

### Task 4: Pure lookup search and the taught-so-far limit

**Files:**
- Create: `src/core/lookup.ts`, `tests/core/lookup.test.ts`
- Modify: `src/core/progress.ts`, `tests/core/progress.test.ts`

**Interfaces:**
- Consumes: `LookupEntry`, `LookupHit` types (type-only, Task 2), `ChapterInfo`, `ChapterState`, `currentChapter`.
- Produces:
  ```ts
  // src/core/lookup.ts
  export type SearchOptions = { maxChapter?: number; limit?: number }   // limit default 30
  export type SearchResult = { word: string; hits: LookupHit[]; match: 'exact' | 'prefix' | 'contains' | 'outline' }
  export function looksLikeSteno(query: string): boolean
  export function searchLookup(entries: readonly LookupEntry[], query: string, opts?: SearchOptions): SearchResult[]
  // src/core/progress.ts
  export function taughtChapter(chapters: readonly ChapterInfo[], states: ReadonlyMap<number, ChapterState>): number
  ```
- `looksLikeSteno`: the trimmed query is non-empty and matches `^[#STKPWHRAO*EUFRPBLGTSDZ\-/]+$` (upper case only, so lower-case words are never strokes; a bare `A` is a stroke). `searchLookup`: trim; empty → `[]`; hits with `chapter > maxChapter` are removed and an entry left with no hits is dropped; word search is case-insensitive: exact word first, then prefix (alphabetical), then substring (alphabetical), each at most once, capped by `limit`; when `looksLikeSteno(query)` the outline search runs first and its results (`match: 'outline'`: entries having a hit whose outline equals the query, then whose outline starts with it; hits that match listed first) come before word results, duplicates removed. `taughtChapter`: `Math.max(4, currentChapter(chapters, states))` when `states` is non-empty, and `26` (nothing hidden) when `states` is empty or `chapters` is empty.

- [ ] **Step 1: Write the failing tests:** `looksLikeSteno` (`SAP`, `-RBGSZ`, `KAT/PHREU`, `#E`, `A` true; `cat`, ``, `Sap`, `S ap`, `hello1` false); ranking (`ca` → `cab`, `cat` prefix alphabetical before `scat` substring; `cat` exact first), case-insensitive, hit filtering by `maxChapter` (entry dropped when all hits are later), limit, whitespace-only and empty queries, an outline query `KAT` finds the entry for `cat` with `match: 'outline'` and the matching hit first, a query that is steno-looking and also a word is covered once; `taughtChapter` (nothing cleared → 4; 4 and 5 cleared → 6; empty states → 26; chapters empty → 26).
- [ ] **Step 2: Run** `npx vitest run tests/core` — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** `feat: lookup search and the taught-so-far limit`.

### Task 5: Notes on the server

**Files:**
- Create: `server/notes.ts`, `tests/server/notes.test.ts`
- Modify: `server/server.ts`, `tests/server/server.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // server/notes.ts
  export function isNoteChapter(n: number): boolean                         // integer 1-26
  export function readNote(dir: string, chapter: number): string            // '' when missing
  export function writeNote(dir: string, chapter: number, text: string): void
  export function listNotes(dir: string): { chapter: number; chars: number }[]   // ascending, non-blank only
  ```
  Files are `<dir>/chNN.md` (two digits). An invalid chapter throws `RangeError` before any filesystem access. `writeNote` creates `dir`, writes a temp file then renames, removes the temp file if the rename fails. `listNotes` ignores files not named `chNN.md` (NN a valid chapter); a missing folder gives `[]`; reads never create anything.
- Routes (JSON; reads never create files; `notesDir = join(dataDir, 'notes')` added to `ApiContext`):
  ```
  GET /api/notes                -> { chapter, chars }[]
  GET /api/notes/:chapter       -> { chapter, text }               (chapter ^\d+$ and 1-26 else 400)
  PUT /api/notes/:chapter {text}-> { chapter, text }               (text a string, at most 200000 chars; '' allowed)
  ```
  Wrong methods → 405 with an `allow` header.

- [ ] **Step 1: Write the failing tests:** `notes.test.ts` like `journal.test.ts` (invalid chapters `0`, `27`, `-1`, `1.5`, `NaN` throw `RangeError`; missing folder reads `''` and is not created; round trip with Unicode and `\r\n`; no leftover `.tmp`; list order/filtering incl. `ch05.md.tmp`, `ch5.md`, `ch99.md` ignored). `server.test.ts`: fresh data dir → the GETs answer empty and `data/` is not created; PUT then GET round-trips; list shows the chapter; non-string text, over-long text, chapter `0`/`27`/`abc`/`05x` → 400; `DELETE` → 405 with `allow`; the three routes never shadow the M2/M3 routes.
- [ ] **Step 2: Run** `npx vitest run tests/server` — fails.
- [ ] **Step 3: Implement** `server/notes.ts` and the routes (reuse `asObject`, `bad`, `allow`, the journal's text-length helper).
- [ ] **Step 4: Run** `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** `feat: notes per chapter on the server`.

### Task 6: Share the save queue with notes and add the client calls

**Files:**
- Modify: `src/ui/useAutosave.ts`, `src/api.ts`, `tests/api.test.ts`
- Create: `tests/ui/useAutosave-notes.test.tsx` (new tests only)

**Interfaces:**
- Produces in `src/api.ts` (optional trailing `fetchFn`, all reject on failure): `listNotes(): Promise<{ chapter: number; chars: number }[]>`, `getNote(chapter: number): Promise<string>`, `putNote(chapter: number, text: string): Promise<void>`.
- Produces in `src/ui/useAutosave.ts` (a refactor: the Journal's behavior must not change and **every existing Journal and useAutosave test passes unchanged**):
  ```ts
  export type AutosaveStore = { id: string; get(key: string): Promise<string>; put(key: string, text: string): Promise<void> }
  export const journalStore: AutosaveStore    // id 'journal', get/put = getJournal/putJournal
  export const notesStore: AutosaveStore      // id 'notes', key = String(chapter), get/put = getNote/putNote
  ```
  The hook takes the store as its first argument (`useAutosave(store, key, enabled)`); the registry is keyed `${store.id}:${key}`, so a journal date and a note key can never collide; `Journal.tsx` passes `journalStore`. Everything else (serialization, orphan retry cap, load waits for a pending save, failed load ⇒ never writes, `__resetPendingSavesForTests`) is unchanged.

- [ ] **Step 1: Write the failing tests:** `api.test.ts` URL/method/body shapes for the three note calls and rejection on non-2xx; `useAutosave-notes.test.tsx` (real hooks, `src/api.ts` mocked): `notesStore` loads and saves to `putNote('5', text)`; the same key in `journalStore` and `notesStore` does not share a registry entry (a pending journal save for `'5'` does not block or overwrite a note `'5'`); a failed note load never calls `putNote` (typing, blur, unmount); unmount flushes the latest text to its own chapter; the existing Journal suites still pass untouched.
- [ ] **Step 2: Run** `npx vitest run tests/api.test.ts tests/ui/useAutosave-notes.test.tsx tests/ui/Journal.test.tsx` — new tests fail.
- [ ] **Step 3: Implement** the client calls and the refactor.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `refactor: the save queue takes a store; add the note calls`.

### Task 7: Dock state, hotkeys, the drawer and the drill pause

**Files:**
- Create: `src/state/dock.tsx`, `src/ui/DockHost.tsx`, `src/ui/dock.css`, `tests/state/dock.test.tsx`, `tests/ui/DockHost.test.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/TopBar.tsx`, `src/ui/Drill.tsx`, `tests/ui/Drill.test.tsx`, `tests/ui/TopBar.test.tsx`, `tests/ui/App.test.tsx`, `src/ui/reader.css`

**Interfaces:**
- Produces:
  ```ts
  // src/state/dock.tsx
  export type DockTool = 'lookup' | 'chart' | 'briefs' | 'notes'
  export type Dock = { tool: DockTool | null; open(tool: DockTool): void; close(): void; toggle(tool: DockTool): void }
  export function DockProvider(props: { children: ComponentChildren }): JSX.Element
  export function useDock(): Dock               // throws a clear error outside a provider
  export function useDockOpen(): boolean        // false outside a provider
  export function dockKeyFor(e: Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'target'>): DockTool | null
  ```
  `dockKeyFor` (pure): returns `null` when Ctrl or Meta is down; with Alt (no Shift) it maps by `e.code` (`Slash` → lookup, `KeyK` → chart, `KeyB` → briefs, `KeyN` → notes) so keyboard layouts that turn Alt+letter into symbols still work; without Alt it maps by `e.key` case-insensitively (`/`, `k`, `b`, `n`; no Shift except for the letters, so Caps Lock/Shift+K still work) **only when the event target is not editable** (`input`, `textarea`, `select`, `contenteditable`); everything else `null`.
- `DockProvider` installs ONE capture-phase `keydown` listener on `window` (removed synchronously on unmount, `useLayoutEffect`): a mapped key toggles that tool, `preventDefault()`s it and stops its propagation (so `/` never reaches the browser's quick find and the drill sink never sees it); with a tool open, `Escape` closes it, `preventDefault()` and `stopPropagation()` — the drill's own Escape handler must not also exit the drill.
- `DockHost` (rendered by `App` once, inside the providers, after `main`): when a tool is open it renders `<aside class="dock-drawer" data-dock role="dialog" aria-label="<Lookup | Key chart | Briefs so far | My notes>">` fixed to the right below the top bar (`top: var(--topbar-h)`, bottom 0, width `min(28rem, 100vw)`, z-index above the dock/nav/status line and below the confirm dialog's 20), with a header (tool title, a `Close` button) and the tool body. Until Tasks 8–11 land, each tool body is a one-line placeholder `Coming in this milestone.` that those tasks replace (the host picks the body from a `TOOLS` map). Focus: when it opens, focus moves to the first `[data-autofocus]` element in the body, else to the drawer itself (`tabIndex={-1}`); when it closes, focus returns to the element focused before it opened (skip silently if it is gone).
- `TopBar`: four small buttons at its right (`Lookup`, `Key chart`, `Briefs`, `Notes`), each with the key hint in a muted span (`/`, `K`, `B`, `N`) and a `title` mentioning the `Alt+` form, `aria-pressed` for the open tool; clicking toggles. The bar's layout and the existing tab behavior stay as they are.
- `Drill.tsx`: `const dockOpen = useDockOpen()`. While true the drill is paused exactly like a disconnected board: strokes are ignored (not judged, not logged), the session clock stops (extend the existing pause bookkeeping so the open time is excluded from `elapsedMs` and the time-limit countdown), and a quiet banner line `Paused while a tool is open` shows. The sink's `onBlur` must not steal the focus back while the focus is inside `[data-dock]`; when the dock closes the focus returns to the sink. Without a provider (`useDockOpen()` false) behavior is exactly as before.

- [ ] **Step 1: Write the failing tests:** `dockKeyFor` matrix (each of the four keys bare/with Alt/with Ctrl/Meta/with Shift, `e.code` fallbacks, an editable target with a bare key → `null`, an editable target with Alt → mapped, non-editable → mapped); `dock.test.tsx` (real window events): `/` toggles lookup, a second press closes it, `K`/`B`/`N`, typing `k` in an `<input>` and in a `<textarea>` does nothing, `Alt+K` works from inside a textarea, the listener is gone after unmount (no tool opens after unmount), `Escape` closes, `/` is `defaultPrevented`; `DockHost.test.tsx`: renders the right label per tool, close button, focus moves in and returns, nothing rendered when closed, the placeholder; `TopBar.test.tsx`: the four buttons toggle and show `aria-pressed`; `Drill.test.tsx` (existing rig + a provider): with the dock open, board strokes are neither judged nor logged (`logger.stroke` not called) and the stats do not move; the fake clock does not advance `elapsedMs` while open (open for 60 s, close, finish → `elapsedMs` excludes it) and a time-limited drill's countdown does not move; Esc with the dock open closes the dock and does NOT call `onExit`; after closing, the sink has the focus; focusing an element inside `[data-dock]` does not pull the focus back to the sink; without a provider every existing Drill test is unchanged. Mutation-check the Esc and the stroke-ignoring behaviors.
- [ ] **Step 2: Run** the new/changed test files — they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: dock state, hotkeys, drawer and drill pause`.

### Task 8: The Lookup tool

**Files:**
- Create: `src/ui/tools/Lookup.tsx`, `src/ui/tools/lookup.css`, `tests/ui/tools/Lookup.test.tsx`
- Modify: `src/ui/DockHost.tsx` (register the tool)

**Interfaces:**
- Consumes: `/content/lookup.json` (`LookupEntry[]`), `searchLookup`, `taughtChapter` (Task 4), `useProgress` (M3), `Board` (`src/ui/Board.tsx`), `parseOutline` (`src/core/steno.ts`).
- Behavior: the index is fetched on first open and cached at module level (later opens do not refetch; a failed fetch is not cached); `loading` → `Loading…`; failure → `Couldn't load the lookup index.` with `Try again`. A search box (`type="search"`, label `Look up a word or a stroke`, `data-autofocus`), a checkbox `Include later chapters` (off by default; its label says `Chapters up to N` from `taughtChapter`; hidden when progress is not ready, in which case nothing is limited). Results (at most 30): each word with its hits — outline chips (`<code class="stroke" data-stroke>` per stroke, one chip per stroke of a multi-stroke outline), `Chapter N`, the source (`practice list` / `brief` / `example`) and a brief's `note`. A small `Board` preview shows the stroke of the chip that is hovered or focused (default: the first stroke of the first result's first hit). States: empty query → `Start typing to look something up.`; nothing found → `Nothing found in Chapters up to N.` with a button `Include later chapters` (checks the box) when the box was off; nothing found with the box on → `Nothing found.`. A result hit from a chapter after `taughtChapter` (only visible with the box on) is labelled `later in the book`.

- [ ] **Step 1: Write the failing tests** (stub `fetch` and `useProgress`): first open fetches once and a second open reuses it; a failed fetch shows the message and `Try again` refetches; typing finds an exact word, a prefix, a stroke query (`SAP` finds the words with that outline, `match` order respected); the box limits by chapter and the checkbox reveals later hits labelled `later in the book`; the nothing-found button; no limit and no checkbox when progress is `loading` or `error`; the preview board lights the focused chip's keys (`.key--target` cells); the input has the focus when the drawer opens (through `DockHost`); results are capped at 30; whitespace-only input shows the empty state.
- [ ] **Step 2: Run** `npx vitest run tests/ui/tools/Lookup.test.tsx` — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: the Lookup tool`.

### Task 9: The Key chart tool

**Files:**
- Create: `src/ui/tools/KeyChart.tsx`, `src/ui/tools/keychart.css`, `tests/ui/tools/KeyChart.test.tsx`
- Modify: `src/ui/DockHost.tsx`

**Interfaces:**
- Consumes: `/content/keychart.json` (`KeyChartEntry[]`, Task 3), `Board`, `slotMask` from `src/core/steno.ts`.
- Behavior: fetched on first open and cached like Lookup (same failure/retry text `Couldn't load the key chart.`). A larger `Board` (`size` 28) at the top whose lit keys follow the hovered or focused row; below it the keys grouped under `Left hand`, `Vowels`, `Right hand`, `Special`, each row a focusable button-like row showing the key name, its sounds (`sounds` joined with ` · `), the examples, and the book section it comes from (muted). A row with no `sounds` shows only its examples. Rows are a real list (`<ul>` of `<li>` with `tabIndex={0}`); hover and focus both light the board; leaving clears it.

- [ ] **Step 1: Write the failing tests:** renders all four groups with the right rows from a fixture; hover and focus light exactly that key on the board (`.key--target` for the right lever cells; `-F` lights the right-hand F key, not `T`), leaving clears it; a key with empty `sounds` renders only examples; load failure + retry; fetched once across reopenings; keyboard: each row is reachable by Tab.
- [ ] **Step 2: Run** `npx vitest run tests/ui/tools/KeyChart.test.tsx` — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: the Key chart tool`.

### Task 10: The Briefs tool

**Files:**
- Create: `src/ui/tools/Briefs.tsx`, `src/ui/tools/briefs.css`, `tests/ui/tools/Briefs.test.tsx`
- Modify: `src/ui/DockHost.tsx`

**Interfaces:**
- Consumes: `/content/briefs.json` (`BriefRow[]`, existing: chapters 5–12 with `kind` `chapter`/`extra`), `taughtChapter`, `useProgress`.
- Behavior: fetched on first open and cached; a filter box (`data-autofocus`, label `Filter briefs`) matching the translation, an outline or the explanation (case-insensitive); rows grouped under `Chapter N` headings (ascending), each row: translation, outline chips (as in Lookup), the explanation; `kind === 'extra'` rows carry a muted `extra` label; the same `Include later chapters` checkbox rule as Lookup (limited to `taughtChapter`; hidden when progress is not ready); a count line `N briefs` (and `N briefs in later chapters hidden` when relevant); empty states `No briefs match.`.

- [ ] **Step 1: Write the failing tests:** grouping and ordering; filter by translation, by outline text (`TKO`) and by explanation; limiting and revealing later chapters with the checkbox and the hidden count; extra label; load failure + retry; fetched once; no limit while progress is not ready.
- [ ] **Step 2: Run** `npx vitest run tests/ui/tools/Briefs.test.tsx` — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: the Briefs tool`.

### Task 11: The Notes tool

**Files:**
- Create: `src/ui/tools/Notes.tsx`, `src/ui/tools/notes.css`, `tests/ui/tools/Notes.test.tsx`
- Modify: `src/ui/DockHost.tsx`

**Interfaces:**
- Consumes: `useAutosave(notesStore, key, enabled)` and `notesStore` (Task 6), `listNotes` (Task 6), `useProgress`, `currentChapter`.
- Behavior: a chapter picker (`<select>`, label `Chapter`, options 1–26 labelled `Chapter N` plus the title when `progress.chapters` has it, and ` · has notes` for chapters with notes from `listNotes()`; the list failing shows plain options); it opens on the current chapter (`currentChapter` when progress is ready, else the last chapter picked in this session, else 5) and remembers the last pick in a module variable for the session. Below it a textarea with the same status line as the Journal (`Saved` / `Saving…` / `Not saved — will retry`) driven by `useAutosave`; the textarea is read-only until the note has loaded; a failed load shows `Couldn't load this note.` with `Try again` and **nothing is ever written in that state**. The editor is remounted per chapter (`key`), so switching chapters flushes the old chapter's text to its own file. Notes are plain text, not rendered. The textarea carries `data-autofocus` once loaded.

- [ ] **Step 1: Write the failing tests** (mock `src/api.ts`, fake timers like the Journal tests): loads and shows the stored note; typing then 800 ms → `putNote(chapter, text)` once and `Saved`; switching chapters while a save is pending sends the text to the OLD chapter and loads the new one; failed load → read-only, error + `Try again`, `putNote` never called (typing, blur, switch, unmount) and `Try again` enables it; a failed save keeps the text and retries; unmount flushes to the right chapter; opens on the current chapter (progress mock) and on the remembered pick otherwise; the `has notes` marker; no PUT when nothing was edited. Mutation-check the failed-load and wrong-chapter guards.
- [ ] **Step 2: Run** `npx vitest run tests/ui/tools/Notes.test.tsx` — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** `feat: the Notes tool`.

### Task 12: Docs and end-to-end check

**Files:**
- Modify: `README.md`, `docs/superpowers/m0-m1-followups.md` (only for items this milestone resolves or leaves open)
- Create: `docs/superpowers/m4-checklist.md`

- [ ] **Step 1: README:** describe the dock (the four tools, the keys: bare `/`, `K`, `B`, `N` in the reader; `Alt+` forms on drill screens; the top-bar buttons; Esc), that a drill pauses while a tool is open, what each tool shows ("taught so far" and the `Include later chapters` box; hits name their chapter), where notes live (`data/notes/chNN.md`, plain markdown, back up by copying `data/`), and the generated drills for Chapters 18, 20 and 21 with their new gate; update any line that said chapters 18+ clear by "marked read" (it is now only 19 and 22 up). Every claim must be verifiable from the code or tests.
- [ ] **Step 2: `m4-checklist.md`** — checks only the owner can do on the real board: `/` opens Lookup in the reader and `K`, `B`, `N` open the others, Esc closes them; mid-drill `Alt+/` opens Lookup, the drill pauses (no strokes counted, the time stops), Esc closes only the tool and you stay in the drill, typing in the lookup box does not type into the drill; Lookup finds `cat` in Chapter 5, finds by stroke (`TKAD`), hides later chapters until the box is checked and labels them; the Key chart's hover lights the key and its sounds match the book's table; Briefs filter and grouping; a note typed on Chapter 5 survives switching to Chapter 6 and back, and a reload; a failed note load (stop the server, open Notes) never overwrites; the Chapter 18 panel lists three drills, the fingerspelling drill runs with letter prompts and `A*`-style strokes, 90% once clears each, and Chapter 18 clears after all three; Chapter 20's punctuation and commands drills and Chapter 21's UK spellings likewise; reading comfort of the drawer.
- [ ] **Step 3: Verify:** `npm test`, `npm run typecheck`, `npm run build` all green. Then run `NO_OPEN=1 PORT=5802 node server/main.ts` in the background (keep its PID), fetch `/`, `/api/health`, `/content/lookup.json`, `/content/keychart.json`, `/content/chapters.json`, `/api/notes` (all 200; `/api/notes` is `[]`), confirm `chapters.json` shows chapters 18, 20, 21 as `drills`, and that `ls data` is unchanged and no `data/notes` exists afterwards; stop the server with `kill <pid>`. **Never run it against the owner's real archive in a way that writes; the check makes only GET requests.** (The first request that opens an old database may run the one-time schema upgrade; M3's upgrade already happened on the owner's machine, so nothing is expected.)
- [ ] **Step 4: Commit** `docs: M4 readme and real-board checklist`.
