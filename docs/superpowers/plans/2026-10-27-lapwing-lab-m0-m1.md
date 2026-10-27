# Lapwing Lab — M0 + M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The whole Lapwing book readable in a local app with live strokes (M0), plus the Chapter 4 "layout" stage practiced on the owner's Uni v4 with every stroke logged (M1).

**Architecture:** A build script turns the vendored book markdown into JSON/HTML under `content/build/`. A plain Node server serves the Vite-built Preact app, that content, the book's media and a small API backed by `node:sqlite`. Pure logic (notation, Uni decoding, chord accumulation, drill judging) lives in `src/core/` with no DOM or I/O, so it is unit-tested directly; WebHID sits behind a thin, injectable class.

**Tech Stack:** Node 26 (runs `.ts` directly), TypeScript, Preact, Vite, Vitest (+ jsdom, @testing-library/preact), `marked`, `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-10-27-lapwing-lab-design.md` (hardware/protocol detail in `docs/reference/steno-lab-plan.md` §4). Out of scope here: M2–M6 (section drills in the reader, gates, dock tools, SRS, dictionary, reports, routines).

## Global Constraints

- Node 26 is installed; run scripts and the server as `node file.ts`. All relative imports end in `.ts`/`.tsx`. No enums, namespaces or constructor parameter properties (`erasableSyntaxOnly`).
- Fully offline after install: no network calls at runtime. Server binds `127.0.0.1` only; default port 5757, override with `PORT`.
- WebHID: Chromium or Brave only; `http://localhost` is the secure context. Usage page `0xFF50`, usage `0x4C56`, report id `0x50`. **WebHID delivers the report id as `event.reportId`; `event.data` holds only the 8-byte payload.**
- Stroke semantics: OR-accumulate every non-zero report; an all-zero report with a non-empty accumulator ends the stroke; an all-zero report with an empty accumulator does nothing.
- Book pinned at `46b53e1ebec3b19fb402da046d6dc0a13b530787` (aerickt/lapwing-for-beginners, GPL-3.0). No code copied from steno-lessions (AGPL).
- Never send strokes to Plover, type text, or touch Plover's config.
- Data lives under `data/` (`steno.db`, `settings.json`); `data/`, `dist/`, `content/build/`, `node_modules/`, `.superpowers/` are git-ignored.
- Look: dark and calm. Left-hand keys `#e8a24a`, vowels `#5b9bd5`, right-hand keys `#a07ad8`; stars follow the left hand. Drill screen is **prompt-first** (big word, small board beneath).
- Stage 0 pass mark: 90% accuracy within 10 minutes on the Chapter 4 pseudo-word test.

## Review Focus

The spec is silent on these, and each is likely to bite. Each has a test in the named task.

1. **No WebHID (Firefox/Safari):** reader still works; the status line says why drilling is unavailable. (Task 13)
2. **Board unplugged or replugged mid-drill:** status flips to disconnected, no phantom stroke fires, replug reconnects without a click. (Task 12)
3. **Archive write fails (server down, disk error):** the drill continues; a visible "not saved" count appears. (Task 16)
4. **Server hygiene:** `..` in static paths cannot escape the content roots; a busy port gives a clear error instead of a stack trace. (Task 8)
5. **Plover Output typing into the drill page:** stray typed text is swallowed and never reaches app shortcuts. (Task 17)

## File Structure

```
package.json tsconfig.json vite.config.ts vitest.config.ts index.html .gitignore
scripts/  sync-book.ts  build-content.ts  dev.ts
          lib/{slug,passmark,practice,render,tables,stage0}.ts
server/   main.ts  server.ts  archive.ts  settings.ts
src/core/ steno.ts  uni.ts  drill.ts
src/hid/  uni-link.ts
src/state/ uni-context.tsx
src/ui/   App.tsx Board.tsx Reader.tsx Nav.tsx StrokeInspector.tsx StatusLine.tsx
          Drill.tsx Stage0Panel.tsx  *.css
src/      main.tsx  api.ts  router.ts  stage0/lists.ts
tests/    mirrors the above
content/lapwing-book/   (vendored, committed)     content/build/ (generated)
```

---

### Task 1: Project scaffold

**Files:** Create `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore`, `src/main.tsx`, `tests/smoke.test.ts`.

**Interfaces — Produces:** npm scripts `test` (`vitest run`), `typecheck` (`tsc --noEmit`), `sync:book`, `build:content`, `build` (`npm run build:content && vite build`), `dev` (`node scripts/dev.ts`), `start` (`npm run build && node server/main.ts`).

- [ ] **Step 1:** `cd ~/lapwing-lab && git init`. Install: `preact`; dev `typescript vite @preact/preset-vite vitest jsdom @testing-library/preact marked @types/node`. tsconfig: `strict`, `jsx: react-jsx`, `jsxImportSource: preact`, `allowImportingTsExtensions`, `noEmit`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Vite: preact plugin, dev proxy of `/api`, `/content`, `/media` to `http://127.0.0.1:5757`. Create `.gitignore` per Global Constraints.
- [ ] **Step 2:** Write `tests/smoke.test.ts`: `expect(1 + 1).toBe(2)`. Run `npm test` → PASS; run `npm run typecheck` → exits 0.
- [ ] **Step 3:** `src/main.tsx` renders `<h1>Lapwing Lab</h1>` into `#app`; `npm run build` is deferred to Task 7 (needs content), so verify with `npx vite build` → exits 0.
- [ ] **Step 4: Commit** (include `docs/`): `chore: scaffold project`.

---

### Task 2: Steno notation

**Files:** Create `src/core/steno.ts`; Test `tests/core/steno.test.ts`.

**Interfaces — Produces:**
```ts
export const SLOTS: readonly ['#','S-','T-','K-','P-','W-','H-','R-','A-','O-','*','-E','-U','-F','-R','-P','-B','-L','-G','-T','-S','-D','-Z']
export type Slot = typeof SLOTS[number]
export type SlotMask = number                       // bit i ⇔ SLOTS[i]
export function slotMask(...slots: Slot[]): SlotMask
export function maskToSlots(mask: SlotMask): Slot[]  // in SLOTS order
export class StenoParseError extends Error {}
export function parseStroke(text: string): SlotMask  // throws StenoParseError
export function tryParseStroke(text: string): SlotMask | null
export function parseOutline(text: string): SlotMask[] // splits on '/'
export function formatStroke(mask: SlotMask): string
```

- [ ] **Step 1: Write failing tests.** Parsing: `parseStroke('SAP')` = `slotMask('S-','A-','-P')`; `'KAT'` = K-,A-,-T; `'-T'` = `-T`; `'-RBGSZ'` = -R,-B,-G,-S,-Z; `'#TPH'` = #,T-,P-,H-; `'TP-PL'` = T-,P-,-P,-L; `'#-R'` = #,-R; `'#EUPB'` = #,-E,-U,-P,-B; `'HO*P'` = H-,O-,*,-P; `'A*'` = A-,*. `parseOutline('KOPL/PHREU/KAEUT')` has length 3 and `[0]` = K-,O-,-P,-L. Throws `StenoParseError` for `''`, `'Q'`, `'OA'`, `'AA'`, `'ZZ'`. `tryParseStroke('OA')` is `null`. Formatting round-trips: for each of `SAP, -T, -RBGSZ, #TPH, TP-PL, #-R, HO*P, KAT, A*P, #STKPWHRAO*EUFRPBLGTSDZ`, `formatStroke(parseStroke(x)) === x`.
- [ ] **Step 2:** `npx vitest run tests/core/steno.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement.** Parse: walk characters with a pointer into `SLOTS`; each letter matches the first slot at or after the pointer whose letter (label without `-`) equals it, then the pointer moves past it; `-` moves the pointer to `-F` if it is earlier; no match → throw. Format: letters in SLOTS order; hyphen needed only when a right-hand key (`-F`…`-Z`) is present and no `A- O- * -E -U` key is: place it before the first right key.
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5: Commit** `feat: steno notation parse and format`.

---

### Task 3: Vendor the book

**Files:** Create `scripts/sync-book.ts`; Create (generated, committed) `content/lapwing-book/{src/,LICENSE,PINNED_COMMIT,SOURCE.md}`; Test `tests/scripts/book-vendored.test.ts`.

**Interfaces — Produces:** `content/lapwing-book/src/` mirrors upstream `src/` (all `Chapter-NN.md`, `Appendix-A..D.md`, `Home.md`, `Glossary.md`, `Changes.md`, `SUMMARY.md`, `practice/`, `img/`). `PINNED_COMMIT` holds the 40-hex hash. CLI: `node scripts/sync-book.ts [commit]` (default: the pinned hash above).

- [ ] **Step 1: Write failing test:** `PINNED_COMMIT` trimmed equals `46b53e1ebec3b19fb402da046d6dc0a13b530787`; `src/Chapter-05.md` exists; `src/practice` has 57 `.txt` files; `LICENSE` contains "GNU GENERAL PUBLIC LICENSE".
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement `sync-book.ts`:** in a temp dir run `git init`, `git fetch --depth 1 <repo> <commit>`, `git checkout FETCH_HEAD`; replace `content/lapwing-book/` with that tree's `src/` and `LICENSE`; write `PINNED_COMMIT`; write `SOURCE.md` (upstream URL, commit, GPL-3.0 note, "do not redistribute without honoring GPL"). Run `npm run sync:book`.
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5: Commit** `feat: vendor Lapwing for Beginners at pinned commit` (expect a ~60 MB commit).

---

### Task 4: Practice-list parser

**Files:** Create `scripts/lib/practice.ts`; Test `tests/scripts/practice.test.ts`.

**Interfaces — Consumes:** `parseOutline` (Task 2). **Produces:**
```ts
export type PracticeItem = { prompt: string; outlines: string[] }  // accepted spellings, deduped
export type PracticeList = { id: string; items: PracticeItem[] }   // id = file basename, e.g. '5-cvc'
export function parsePracticeFile(id: string, text: string): PracticeList
```

- [ ] **Step 1: Write failing tests:** `"snatch\tSTPHAFP\n"` → one item `{prompt:'snatch', outlines:['STPHAFP']}`; a multistroke line `sprinklers\tSPR*EUPBG/HRER/-Z` is kept verbatim; two lines with the same prompt and different outlines merge into one item with both outlines; the same outline twice is stored once; blank lines are skipped; a line without a tab throws an error naming `id` and the 1-based line number; an unparseable outline (`"x\tQQ"`) throws naming id, line and `QQ`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement `parsePracticeFile`;** validate each `/`-segment with `parseOutline`. Keep first-seen order.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: practice list parser`.

---

### Task 5: Chapter renderer

**Files:** Create `scripts/lib/slug.ts`, `scripts/lib/passmark.ts`, `scripts/lib/render.ts`; Tests `tests/scripts/{slug,passmark,render}.test.ts`.

**Interfaces — Consumes:** `tryParseStroke`. **Produces:**
```ts
// slug.ts
export function slugify(heading: string): string   // mdBook-style id
export function makeSlugger(): (heading: string) => string  // appends -1, -2 on repeats
// passmark.ts
export type PassMark = { accuracy: number; minWpm?: number; maxWpm?: number; maxMinutes?: number }
export function parsePassMark(markdown: string): PassMark | undefined
// render.ts
export type Heading = { id: string; title: string; level: number }
export type PracticeLink = { headingId: string; listId: string }   // nearest heading above the link
export type RenderedPage = { html: string; headings: Heading[]; practiceLinks: PracticeLink[]; strokeCount: number; outlineTagCount: number }
export function renderPage(markdown: string, pageIds: Record<string, string>): RenderedPage
```
`pageIds` maps upstream file names to page ids (e.g. `'Chapter-22.md' → 'ch22'`).

- [ ] **Step 1: Write failing tests.** `slugify`: `"Problematic words"`→`problematic-words`; `"Chapter 4 test"`→`chapter-4-test`; ``"`AE` for `AEU`"``→`ae-for-aeu`; `"Left hand d, b, and l"`→`left-hand-d-b-and-l`; slugger returns `x`, `x-1` for a repeated heading. `parsePassMark`: `**Aim for 10–20 WPM with 90% accuracy.**` → `{accuracy:0.9,minWpm:10,maxWpm:20}`; `**Aim for 5-20 WPM with 90% accuracy.**` (ASCII hyphen) → min 5, max 20; Chapter 4's sentence "…in 10 minutes or less with an accuracy of at least 90%" → `{accuracy:0.9,maxMinutes:10}`; text with none → `undefined`. `renderPage`: `<steno-outline stroke="SAP" width="100%" alt="x"></steno-outline>` → contains `data-stroke="SAP"` and counts in `outlineTagCount`; a code span `` `TKAD` `` becomes `<code class="stroke" data-stroke="TKAD" tabindex="0">`, but `` `Ctrl` `` stays plain `<code>` and a fenced block is untouched; headings get mdBook ids and appear in `headings`; `![](img/5-order.png)` → `src="/media/5-order.png"`; `<source src="img/5-pronunciations-short-a.mp4">` → `/media/…`; `[x](practice/5-cvc.txt)` → `<a class="practice-link" data-list="5-cvc">x</a>` and a `PracticeLink` for the heading above; `[x](Chapter-22.md#problematic-words)` → `href="/page/ch22#problematic-words"`; an `<iframe>` is replaced by `<a class="needs-network" href=…>` with the iframe's `src`; external `https:` links get `target="_blank" rel="noreferrer"`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** with `marked` (GFM): custom `heading` (ids from slugger) and `codespan` (use `tryParseStroke` on `text` that is all `[#A-Z*\-/]`; accept `/`-joined outlines via `parseOutline`); post-process the HTML string for `<steno-outline>` tags (→ `<span class="stroke stroke-tag" data-stroke="…" tabindex="0">…</span>`), image/video paths, iframes and links. Track the current heading while walking tokens for `practiceLinks`. Pass marks: two regexes, `–` or `-` between numbers.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: chapter markdown renderer with live strokes`.

---

### Task 6: Brief tables, practice sentences, Stage 0 lists

**Files:** Create `scripts/lib/tables.ts`, `scripts/lib/stage0.ts`; Tests `tests/scripts/{tables,stage0}.test.ts`.

**Interfaces — Consumes:** `parseOutline`, `tryParseStroke`. **Produces:**
```ts
export type BriefRow = { chapter: number; kind: 'chapter' | 'extra'; translation: string; outlines: string[]; explanation: string }
export type SentenceRow = { chapter: number; text: string; outline: string }
export function parseBriefTables(chapter: number, markdown: string): BriefRow[]  // tables under "Chapter briefs" / "Extra briefs"
export function parseSentences(chapter: number, markdown: string): SentenceRow[] // "Practice sentences" list zipped with "Answers" list
export type Stage0Words = { test: string[]; extra: string[][] }
export function parseStage0Words(chapter4Markdown: string): Stage0Words           // the three fenced word blocks
```

- [ ] **Step 1: Write failing tests** against the real file `content/lapwing-book/src/Chapter-05.md`: `parseBriefTables(5, md)` contains `{kind:'chapter', translation:'the', outlines:['-T']}`, `{translation:'are', outlines:['R','-R']}`, `{translation:'.', outlines:['TP-PL']}`, `{translation:'?', outlines:['KW-PL']}`, and `{kind:'extra', translation:'did you', outlines:['TKU']}`. `parseSentences(5, md)` has 4 rows; row 0 is `{text:'I do tip the lad.', outline:'EU/TKO/TEUP/-T/HRAD/TP-PL'}`. Chapter 12's table has `mother` twice (`PHO*RT` and `PHOER`). `parseStage0Words(Chapter-04.md)` gives `test.length === 100`, `test[0] === 'SAP'`, `test[1] === 'HUD'`, `extra.map(a=>a.length)` equal `[99, 82]`, and every word passes `tryParseStroke`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** by walking `marked.lexer` tokens: find the heading, take the next `table` / `list` token; strokes come from the code spans in the outline cell; the first column is the translation, the second the outline, the third the explanation (plain text). Stage 0: fenced `code` tokens with more than 50 whitespace-separated words, in order.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: brief tables, sentences and stage 0 words`.

---

### Task 7: Content build

**Files:** Create `scripts/build-content.ts`; Test `tests/scripts/build-content.test.ts`.

**Interfaces — Consumes:** Tasks 4–6. **Produces** under `<out>/` (default `content/build/`):
```ts
// book.json
type BookIndex = { commit: string; pages: { id: string; title: string; kind: 'home'|'chapter'|'appendix'|'glossary'|'changes'; number?: number; file: string }[] }
// pages/<id>.json
type PageFile = { id: string; title: string; html: string; headings: Heading[]; practiceLinks: PracticeLink[]; passMark?: PassMark }
// practice/<listId>.json  → PracticeList      briefs.json → BriefRow[]
// sentences.json → SentenceRow[]               stage0.json → Stage0Words
export function buildContent(opts: { bookDir: string; outDir: string }): Promise<BuildStats>
type BuildStats = { pages: number; practiceLists: number; practiceLines: number; outlineTags: number; briefRows: number }
```
Page ids: `home`, `ch01`…`ch26`, `appA`…`appD`, `glossary`, `changes`. `npm run build:content` calls `buildContent` with the vendored book.

- [ ] **Step 1: Write failing test** (build into a temp dir): `stats.pages === 33`; `stats.practiceLists === 57`; `stats.practiceLines === 7299`; `stats.outlineTags === 154`; `book.json.commit` equals the pinned hash; `pages/ch05.json.passMark` equals `{accuracy:0.9,minWpm:10,maxWpm:20}`; `ch07` has `minWpm:5`; `ch04.passMark` has `maxMinutes:10`; `ch12`, `ch14`, `ch17` have no `passMark`; `practice/5-cvc.json` exists; `stage0.json.test.length === 100`; an invalid stroke in a prose code span stays plain `<code>`, but an invalid stroke in a *practice list* makes `buildContent` reject (use a tiny fixture book dir).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Page order and titles come from `SUMMARY.md` (each `-[Title](File.md)` line). Run `npm run build:content` and read the printed stats.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: content build pipeline`.

---

### Task 8: Server

**Files:** Create `server/server.ts`, `server/main.ts`, `scripts/dev.ts`; Test `tests/server/server.test.ts`.

**Interfaces — Produces:**
```ts
export function createServer(opts: { root: string; dataDir: string }): import('node:http').Server
// main.ts: listens on 127.0.0.1:PORT (default 5757), prints the URL, runs `xdg-open <url>` (ignore failure)
```
Routes: `GET /api/health` → `{"ok":true}`; `GET /content/*` → `<root>/content/build/*`; `GET /media/*` → `<root>/content/lapwing-book/src/img/*`; everything else → `<root>/dist/*`, falling back to `dist/index.html` for paths with no file extension (client routes). API routes for settings and tests are added in Task 14.

- [ ] **Step 1: Write failing tests** (start on port 0 with a temp `root` fixture; use `fetch`): `/api/health` returns `{ok:true}`; `/content/book.json` serves a fixture file with `application/json`; `/media/x.png` serves with `image/png`; `/page/ch05` returns `index.html`; `/missing.js` → 404; **`/content/..%2F..%2Fetc%2Fpasswd` and `/media/../../package.json` → 404** (never outside the roots); starting a second server on an occupied port rejects with an error whose message contains the port number and `PORT`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** with `node:http`, `path.resolve` + prefix check against each root, a small extension→MIME map, and an `EADDRINUSE` handler in `main.ts` that prints `Port 5757 is in use. Set PORT=<other> and retry.` and exits 1. `scripts/dev.ts` spawns `node --watch server/main.ts` and `npx vite`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: local server`.

---

### Task 9: Uni layout, report decoding, chord accumulation

**Files:** Create `src/core/uni.ts`; Test `tests/core/uni.test.ts`.

**Interfaces — Consumes:** `Slot`, `SlotMask`, `slotMask` from Task 2. **Produces:**
```ts
export const LEVERS: readonly [...]  // 28 names in Plover chart order:
// 'S1-','T-','K-','P-','W-','H-','R-','A-','O-','*1','-E','-U','-F','-R','-P','-B','-L','-G','-T','-S','-D','-Z','#1','S2-','*2','*3','*4','#2'
export type Lever = typeof LEVERS[number]
export const UNI_USAGE_PAGE = 0xff50, UNI_USAGE = 0x4c56, UNI_REPORT_ID = 0x50
export function leverSlot(l: Lever): Slot             // S1-/S2-→'S-', *1..*4→'*', #1/#2→'#'
export function leversToMask(levers: readonly Lever[]): SlotMask
export const UNI_GRID: readonly (readonly (Lever | null)[])[]   // 3 rows × 11 cols
export function decodeUniReport(reportId: number, data: DataView): Lever[] | null  // null if reportId ≠ 0x50 or data < 8 bytes
export type RawStroke = { levers: Lever[]; mask: SlotMask }
export class ChordAccumulator { push(levers: readonly Lever[]): RawStroke | null; reset(): void }
```
`UNI_GRID` row 0: `S1- T- P- H- *1 | *3 -F -P -L -T -D`; row 1: `S2- K- W- R- *2 | *4 -R -B -G -S -Z`; row 2: `null null #1 A- O- | -E -U #2 null null null`.

- [ ] **Step 1: Write failing tests.** Decoding (payload only, big-endian, bit 63 = first chart entry): bytes `[0x80,0,0,0,0,0,0,0]` → `['S1-']`; `[0xC0,0,…]` → `['S1-','T-']`; `[0,0,0x04,0,0,0,0,0]` → `['-Z']`; `[0,0,0,0x10,0,0,0,0]` → `['#2']`; all zero → `[]`; `decodeUniReport(0x51, …)` → `null`; a 4-byte buffer → `null`. A report whose bit for chart entry 30 (beyond the Uni's 28) is set ignores it. Grid has 28 non-null levers, each lever exactly once. Accumulator: `push(['S1-','A-'])` → null, `push(['S1-','A-','-P'])` → null, `push([])` → stroke with levers `S1-,A-,-P` and `mask === parseStroke('SAP')`; releasing mid-stroke (`[S,T]`,`[S]`,`[]`) still yields S and T; a stray `push([])` on an empty accumulator → null (no fabricated stroke); after a stroke the accumulator is empty (`[T]`,`[]` → just T). `leversToMask(['S2-','*3'])` = `slotMask('S-','*')`.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** (`getBigUint64(0,false)`; ignore bits at chart index ≥ 28). **Step 4:** Run → PASS. **Step 5: Commit** `feat: Uni v4 layout and chord accumulation`.

---

### Task 10: Board component

**Files:** Create `src/ui/Board.tsx`, `src/ui/board.css`; Test `tests/ui/Board.test.tsx` (`// @vitest-environment jsdom`).

**Interfaces — Consumes:** `Lever`, `UNI_GRID`, `leverSlot` from Task 9. **Produces:**
```ts
export type BoardProps = {
  size?: number                                   // key edge in px, default 18
  target?: SlotMask                               // slots drawn lit as "needed"
  pressed?: readonly Lever[]                      // levers physically down
  diff?: { missing: SlotMask; extra: SlotMask }   // mistake overlay
}
export function Board(props: BoardProps): JSX.Element
```
Renders `UNI_GRID` (3 rows × 11 columns with a gap after column 4); every key is `<div class="key key--left|vowel|right" data-lever="S1-">` showing its label (`S`, `T`, … `-F`, `*`, `#`). Left-hand keys, stars and `#1` use the left colour; `A O -E -U` the vowel colour; right-hand keys and `#2` the right colour.

- [ ] **Step 1: Write failing tests:** rendering with `target = parseStroke('SAP')` marks both `S1-` and `S2-`, `A-` and the left `P-` with class `key--target` and nothing else; `pressed=['*3']` marks only that star with `key--down`; `diff` marks missing slot keys `key--missing` and extra keys `key--extra`; the board contains exactly 28 `[data-lever]` keys.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** with CSS grid and a `--s` size variable; unused cells are empty spacers.
- [ ] **Step 4:** Run → PASS. **Step 5: Commit** `feat: Uni v4 board component`.

---

### Task 11: Reader shell (M0 complete)

**Files:** Create `src/router.ts`, `src/ui/{App,Reader,Nav,StrokeInspector}.tsx`, `src/ui/reader.css`; modify `src/main.tsx`; Test `tests/ui/Reader.test.tsx`.

**Interfaces — Produces:**
```ts
// router.ts — History API, no library
export type Route = { name: 'page'; id: string } | { name: 'drill'; id: string } | { name: 'notfound' }
export function parseRoute(pathname: string): Route   // '/' → page home; '/page/ch05'; '/drill/stage0/<id>'
export function navigate(path: string): void
export function useRoute(): Route
// StrokeInspector.tsx
export function StrokeInspector(props: { outline: string | null }): JSX.Element // board + notation; cycles strokes of a multi-stroke outline every 800 ms with "1/3"
```
`Nav` lists every page from `/content/book.json` in groups *Start here* (home–ch04), *Core* (ch05–ch12), *Later* (ch13–ch26), *Appendices* (appA–appD, glossary, changes); nothing is greyed yet (gating is M2). `Reader` fetches `/content/pages/<id>.json`, sets the HTML, intercepts clicks on internal `/page/` links, scrolls to `#anchor`, and on hover/focus/click of any `[data-stroke]` element sets the inspector's outline.

- [ ] **Step 1: Write failing tests:** `parseRoute('/')` → `{name:'page',id:'home'}`; `'/page/ch05'`; `'/drill/stage0/rows-left-bottom'` → `{name:'drill',id:'stage0/rows-left-bottom'}`; `'/nope'` → notfound. A `Reader` test with `fetch` mocked to return a page with `<code class="stroke" data-stroke="TKAD">`: hovering it renders the inspector board with exactly 4 `.key--target` keys for `TKAD` (`T-`, `K-`, `A-`, `-D`); a three-stroke outline shows `1/3`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Layout: nav left, reading column centre (max ~70ch), inspector right. Dark theme variables in `reader.css`.
- [ ] **Step 4:** Run → PASS. Then `npm run build` and `node server/main.ts`; open `http://127.0.0.1:5757/page/ch05` — Chapter 5 reads fully with images; hovering a stroke lights the board. Stop the server.
- [ ] **Step 5: Commit** `feat: book reader with live strokes`.

---

### Task 12: WebHID link

**Files:** Create `src/hid/uni-link.ts`; Test `tests/hid/uni-link.test.ts`.

**Interfaces — Consumes:** `decodeUniReport`, `ChordAccumulator`, constants (Task 9). **Produces:**
```ts
export interface HidDeviceLike { opened: boolean; open(): Promise<void>; close(): Promise<void>; addEventListener(t: 'inputreport', cb: (e: { reportId: number; data: DataView }) => void): void; removeEventListener(t: 'inputreport', cb: unknown): void }
export interface HidLike { requestDevice(o: { filters: { usagePage: number; usage: number }[] }): Promise<HidDeviceLike[]>; getDevices(): Promise<HidDeviceLike[]>; addEventListener(t: 'connect' | 'disconnect', cb: (e: { device: HidDeviceLike }) => void): void; removeEventListener(t: 'connect' | 'disconnect', cb: unknown): void }
export type UniStatus = { state: 'connected' | 'disconnected'; reason?: string }
export type UniHandlers = { onSnapshot?(levers: Lever[]): void; onStroke(stroke: RawStroke): void; onStatus(status: UniStatus): void }
export class UniLink {
  constructor(hid: HidLike, handlers: UniHandlers)
  get connected(): boolean
  request(): Promise<void>        // user gesture: requestDevice with usagePage 0xFF50 / usage 0x4C56
  autoConnect(): Promise<boolean> // getDevices(); attach the first match without a prompt
  close(): Promise<void>
}
```
- [ ] **Step 1: Write failing tests** with fake `HidLike`/device objects (simulation is allowed in tests only): a fake `inputreport` with `reportId: 0x50` and an 8-byte `data` carrying S1+A, then P, then all-zero produces exactly one stroke for `SAP` (pins the stripped-report-id behaviour); `request()` passes `filters:[{usagePage:0xFF50,usage:0x4C56}]`; calling `request()` twice opens and listens once (no double-connect); `close()` calls `removeEventListener` for the device and emits `disconnected`; **a `disconnect` event for a different device is ignored**; **a `disconnect` for the current device emits `{state:'disconnected'}`, clears the accumulator (no stroke fires afterwards from a half-held chord) and a later `connect` event for a matching device re-attaches and emits `connected`.**
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement.** On attach: `open()` if not opened, add listener, reset accumulator; `onSnapshot` fires for every decoded report. **Step 4:** Run → PASS. **Step 5: Commit** `feat: WebHID link for the Uni v4`.

---

### Task 13: Device state and status line

**Files:** Create `src/state/uni-context.tsx`, `src/ui/StatusLine.tsx`; modify `src/ui/App.tsx`; Test `tests/ui/StatusLine.test.tsx`.

**Interfaces — Consumes:** `UniLink`, `HidLike`. **Produces:**
```ts
export function UniProvider(props: { hid?: HidLike | null; children: ComponentChildren }): JSX.Element // hid defaults to navigator.hid; null = unavailable
export function useUni(): {
  available: boolean                       // WebHID present
  connected: boolean
  pressed: readonly Lever[]                // current snapshot
  connect(): Promise<void>
  onStroke(cb: (s: RawStroke) => void): () => void   // returns unsubscribe
}
export function StatusLine(): JSX.Element
```
`UniProvider` calls `autoConnect()` on mount. `StatusLine` shows `● Uni v4 connected` / `○ Not connected` with a **Connect** button, and a standing line `Plover output: turn it off while practicing`.

- [ ] **Step 1: Write failing tests:** with `hid={null}` the status line contains "needs a Chromium-based browser" and no Connect button, and the reader still renders; with a fake `hid` and not connected it shows a Connect button that calls `requestDevice`; after a fake input report the context's `pressed` updates and clears on an all-zero report.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement**; mount `UniProvider` + `StatusLine` in `App`. **Step 4:** Run → PASS. **Step 5: Commit** `feat: device state and status line`.

---

### Task 14: Archive and API

**Files:** Create `server/archive.ts`, `server/settings.ts`; modify `server/server.ts`; Tests `tests/server/archive.test.ts`, extend `tests/server/server.test.ts`.

**Interfaces — Consumes:** `Lever`, `SlotMask`. **Produces:**
```ts
export type StrokeRecord = { testId: number; tsMs: number; prompt: string; expected: string[]; pressedLevers: Lever[]; pressedMask: number; correct: boolean; latencyMs: number; attemptNo: number }
export type TestRow = { id: number; sessionId: number; startedAt: number; endedAt: number | null; mode: string; chapter: number | null; section: string | null; itemCount: number; wpm: number | null; accuracy: number | null; meta: unknown }
export interface Archive {
  createSession(startedAt: number): number
  startTest(t: { sessionId: number; startedAt: number; mode: string; chapter: number | null; section: string | null; itemCount: number }): number
  addStroke(s: StrokeRecord): void
  finishTest(id: number, r: { endedAt: number; wpm: number; accuracy: number; meta: unknown }): void
  lastTest(mode: string, section: string): TestRow | undefined
  listStrokes(testId: number): StrokeRecord[]
  close(): void
}
export function openArchive(path: string): Archive            // ':memory:' allowed; creates tables on open; foreign keys enforced
export type Settings = { boardVisibility: 'always' | 'hover' | 'hidden' }
export function readSettings(file: string): Settings          // defaults when file missing
export function writeSettings(file: string, patch: Partial<Settings>): Settings
```
API: `POST /api/sessions {startedAt}`→`{id}`; `POST /api/tests {…startTest fields}`→`{id}`; `POST /api/tests/:id/strokes` (a `StrokeRecord` minus `testId`)→`{ok:true}`; `POST /api/tests/:id/finish {endedAt,wpm,accuracy,meta}`→`{ok:true}`; `GET /api/tests/last?mode=&section=`→`TestRow|null`; `GET/PUT /api/settings`. Tables: `sessions`, `tests`, `strokes` per spec §6. JSON bodies over ~1 MB → 413.

- [ ] **Step 1: Write failing tests** (`:memory:`): create session → start test → add two strokes (one with `pressedLevers:['S1-','A-','T-']`, `expected:['SAP']`, `correct:false`) → `listStrokes` returns both with the lever list and `correct` intact (**wrong-key identity survives the round trip**); `finishTest` then `lastTest('stage0-test','pseudo')` returns accuracy and parsed `meta`; unknown test id on `addStroke` throws. Settings: missing file → `{boardVisibility:'always'}`; `writeSettings` merges and persists; an invalid `boardVisibility` is rejected. Server: the full POST sequence works over HTTP and `GET /api/tests/last` returns the finished test.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** with `node:sqlite` (`DatabaseSync`), WAL off, prepared statements; `createServer` opens `<dataDir>/steno.db` lazily and creates `dataDir` if missing. **Step 4:** Run → PASS. **Step 5: Commit** `feat: archive and settings API`.

---

### Task 15: Drill engine

**Files:** Create `src/core/drill.ts`; Test `tests/core/drill.test.ts`.

**Interfaces — Consumes:** `parseOutline`, `formatStroke`, `slotMask`, `maskToSlots`, `RawStroke`. **Produces:**
```ts
export type DrillItem = { prompt: string; outlines: string[] }
export type Diff = { missing: Slot[]; extra: Slot[] }
export function diffMasks(expected: SlotMask, pressed: SlotMask): Diff
export type StrokeResult =
  | { kind: 'partial'; item: DrillItem }                 // right so far, more strokes needed
  | { kind: 'correct'; item: DrillItem; firstTry: boolean }  // item complete; session advanced
  | { kind: 'miss'; item: DrillItem; diff: Diff; expected: string }  // expected = notation of the intended stroke
  | { kind: 'undo' } | { kind: 'ignored' }
export type DrillStats = { completed: number; firstTryCorrect: number; accuracy: number; elapsedMs: number; wpm: number }
export class DrillSession {
  constructor(items: readonly DrillItem[], clock?: () => number)
  readonly total: number
  get index(): number
  get current(): DrillItem | undefined       // undefined when finished
  get finished(): boolean
  submit(stroke: RawStroke): StrokeResult
  stats(): DrillStats
}
```
Rules: strokes accumulate toward any accepted outline; a stroke that is not a prefix-match is a `miss`, clears the partial entry and marks the item not-first-try, and the same item stays current; a stroke sequence completing any accepted outline is `correct`. A lone `*` stroke, when no accepted outline's next stroke is exactly `*`, pops the last entered stroke (`undo`) or does nothing (`ignored`) — never a miss. `accuracy = firstTryCorrect / completed` (0 when none); `elapsedMs` runs from the first `submit` to the last completion; `wpm = completed / (elapsedMs/60000)` (0 when elapsed is 0).

- [ ] **Step 1: Write failing tests.** `diffMasks(parseStroke('SAP'), parseStroke('TAP'))` → missing `['S-']`, extra `['T-']`. Session `[{prompt:'SAP',outlines:['SAP']}]`: pressing SAP → `correct`, `firstTry:true`, `finished`. Pressing `TAP` → `miss` with that diff and `expected:'SAP'`, item still current; then SAP → `correct` with `firstTry:false`. Multi-stroke item `['KOPL/PHREU/KAEUT']`: first stroke → `partial`; a wrong second stroke → `miss` and the entry resets to the start; all three → `correct`. Alternate outlines (`['TAOU','TO']`) both accepted. `*` after one correct partial stroke → `undo` and the first stroke must be re-entered; `*` with nothing entered → `ignored` and no effect on `stats()`; an item whose outline is exactly `*` accepts it as correct. Stats with an injected clock: 4 items, 3 first-try → accuracy 0.75; 10 items finished in 60 000 ms → `wpm === 10`.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** (tie in miss diffs: the accepted outline needing the fewest changes at the current stroke index). **Step 4:** Run → PASS. **Step 5: Commit** `feat: drill engine with mistake diff`.

---

### Task 16: Archive client

**Files:** Create `src/api.ts`; Test `tests/api.test.ts`.

**Interfaces — Consumes:** server routes (Task 14). **Produces:**
```ts
export interface TestLogger {
  readonly unsaved: number                    // count of failed writes so far
  start(t: { mode: string; chapter: number | null; section: string | null; itemCount: number }): Promise<void>
  stroke(s: Omit<StrokeRecord, 'testId'>): void   // fire-and-forget, never throws
  finish(r: { wpm: number; accuracy: number; meta: unknown }): Promise<void>
  onUnsaved(cb: (n: number) => void): () => void
}
export function createTestLogger(fetchFn?: typeof fetch): TestLogger
export function getLastTest(mode: string, section: string, fetchFn?: typeof fetch): Promise<TestRow | null>
export function getSettings(fetchFn?: typeof fetch): Promise<Settings>
export function putSettings(patch: Partial<Settings>, fetchFn?: typeof fetch): Promise<Settings>
```
The logger creates a session lazily on first `start`. Stroke writes made before `start` resolves are queued.

- [ ] **Step 1: Write failing tests** with a fake `fetch`: a normal run issues `POST /api/sessions`, `/api/tests`, one stroke POST per `stroke()` call, then `/finish`; **when every request rejects, `start`, `stroke` and `finish` all resolve without throwing and `unsaved` equals the number of failed writes**; `onUnsaved` is called with each new count.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement.** **Step 4:** Run → PASS. **Step 5: Commit** `feat: resilient archive client`.

---

### Task 17: Drill screen

**Files:** Create `src/ui/Drill.tsx`, `src/ui/drill.css`; Test `tests/ui/Drill.test.tsx`.

**Interfaces — Consumes:** `DrillSession`, `useUni`, `Board`, `TestLogger`, `Settings`. **Produces:**
```ts
export type DrillKind = 'stroke' | 'word'   // stroke: prompt IS the raw steno; word: English word
export type DrillResult = { stats: DrillStats; passed: boolean | null; meta: unknown }
export function Drill(props: {
  title: string
  kind: DrillKind
  items: readonly DrillItem[]
  logger: TestLogger
  logTest: { mode: string; chapter: number | null; section: string | null }
  passMark?: { accuracy: number; maxMinutes?: number }
  onDone(result: DrillResult): void
  onExit(): void
}): JSX.Element
```
Prompt-first: huge prompt (word or notation), thin stats line (`14 / 100 · acc 93% · 11 wpm`), small board beneath. Board visibility from settings: `always` (target lit), `hover` (shown while the pointer is over the board area), `hidden`. Live `pressed` keys are drawn on the board. On a miss the board shows the diff (missing/extra) plus the expected notation, until the next stroke. The device stroke stream feeds `DrillSession.submit`; every stroke is logged with `pressedLevers`, `pressedMask`, `expected`, `correct`, `latencyMs` (time since the prompt appeared) and `attemptNo` (1-based per item). If the device is disconnected, a banner "Board disconnected — reconnect to continue" shows and the timer does not advance. At the end: `onDone` with `passed = accuracy ≥ passMark.accuracy && elapsedMs ≤ maxMinutes*60000` (null when no `passMark`), after `logger.finish`.
**Stray-output sink:** a visually hidden `<textarea>` is focused for the whole drill; its `input` handler clears its value and calls `preventDefault`; page keyboard shortcuts must ignore events whose target is that textarea.

- [ ] **Step 1: Write failing tests** (fake `useUni` source; fake logger): prompt text is shown large; a fake `SAP` stroke advances the counter and logs a `correct:true` stroke; a `TAP` stroke shows the expected notation `SAP`, marks `S-` missing and `T-` extra on the board, and logs `correct:false` with `pressedLevers` containing `T-`; with `boardVisibility:'hidden'` there is no `.key` in the DOM; **typing `abc` into the sink leaves its value empty and does not trigger a document-level shortcut handler**; disconnecting shows the banner; finishing 1 item correctly under the pass mark calls `onDone` with `passed:true`.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement.** **Step 4:** Run → PASS. **Step 5: Commit** `feat: prompt-first drill screen`.

---

### Task 18: Stage 0 content and Chapter 4 panel

**Files:** Create `src/stage0/lists.ts`, `src/ui/Stage0Panel.tsx`; modify `src/ui/{App,Reader}.tsx`; Test `tests/stage0/lists.test.ts`, `tests/ui/Stage0Panel.test.tsx`.

**Interfaces — Consumes:** `Drill`, `getLastTest`, `/content/stage0.json`. **Produces:**
```ts
export type Stage0Drill = { id: string; title: string; kind: 'stroke'; items: DrillItem[]; passMark?: { accuracy: number; maxMinutes: number } }
export const ROW_DRILLS: Stage0Drill[]   // ids: 'rows-left-bottom' (S K W R), 'rows-right-bottom' (-R -B -G -S -Z), 'rows-left-top' (# T P H), 'rows-right-top' (-F -P -L -T -D), 'rows-vowels' (A O E U), 'rows-star' (*)
export function buildStage0Drills(words: Stage0Words): Stage0Drill[]  // ROW_DRILLS + 'pseudo-test' (100 words, pass mark 0.9 / 10 min) + 'pseudo-extra-1' (99) + 'pseudo-extra-2' (82)
export function repeat(items: DrillItem[], times: number): DrillItem[] // `items` repeated `times` times, each repetition shuffled
```
Row drills use 5 shuffled repetitions of each key (prompt = the notation, e.g. `-RBGSZ` keys as `-R`, `-B`, …). The pseudo-word lists are shuffled once per run (the book says "Shuffle words"). `Stage0Panel` renders on the `ch04` page above the chapter text: a button per drill with its last result (`getLastTest('stage0', id)`), starting `/drill/stage0/<id>` (route from Task 11). The drill route shows `Drill`, records `mode:'stage0'`, `chapter:4`, `section:<id>`, and on completion shows a summary (accuracy, wpm, time, **Passed** / **Not yet** for the test) with *Again* and *Back to Chapter 4*.

- [ ] **Step 1: Write failing tests:** every `ROW_DRILLS` item's outline parses and equals a single slot; `rows-right-bottom` has the five slots `-R -B -G -S -Z`; `buildStage0Drills` yields `pseudo-test` with 100 items whose outlines each equal the prompt; shuffling keeps the same multiset; the panel on ch04 lists 9 drills, shows "Passed 94% · 8 min" style text from a mocked last result, and the Chapter 5 page shows no panel.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement.** **Step 4:** Run → PASS. **Step 5: Commit** `feat: stage 0 drills on the Chapter 4 page`.

---

### Task 19: Press-to-confirm in the reader

**Files:** Modify `src/ui/StrokeInspector.tsx`, `src/ui/Reader.tsx`; Test `tests/ui/StrokeInspector.test.tsx`.

**Interfaces — Consumes:** `useUni().onStroke`. **Produces:** `StrokeInspector` gains an optional `onConfirm?: () => void` behaviour internally: while an outline is shown, a device stroke equal to the *currently displayed* stroke of the outline (compared by `SlotMask`) marks it confirmed (class `confirmed`, a ✓ for ~600 ms); for a multi-stroke outline the cycling pauses and steps through only as the owner presses each stroke in order; a wrong stroke shows the diff overlay on the board for ~600 ms.

- [ ] **Step 1: Write failing tests:** with outline `SAP`, firing the stroke `SAP` adds `confirmed`; firing `TAP` renders the diff overlay (T extra, S missing) and no `confirmed`; with `KOPL/PHREU/KAEUT`, pressing strokes 1 then 2 advances the displayed index to 3/3, while pressing stroke 2 first does nothing but show the diff.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement.** **Step 4:** Run → PASS. **Step 5: Commit** `feat: press-to-confirm strokes in the reader`.

---

### Task 20: Run instructions and hardware check

**Files:** Create `README.md`; no new tests.

- [ ] **Step 1:** Write `README.md`: what it is, `npm install`, `npm run sync:book` (only to re-vendor), `npm start`, Chromium/Brave requirement, "turn Plover's Output off while practicing", data location and backup (`data/`), licence note (book GPL-3.0).
- [ ] **Step 2:** Run `npm test` → all PASS; `npm run typecheck` → exit 0; `npm start` → prints `http://127.0.0.1:5757`.
- [ ] **Step 3 (owner, with the board plugged in):** open `/page/ch04`; click **Connect**, choose the Uni; confirm the status shows connected and pressing keys lights them on a drill board. Run `rows-left-bottom`, then the `pseudo-test`. Report anything wrong with key lighting. Check a stroke is stored: `node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/steno.db');console.log(d.prepare('select count(*) n from strokes').get())"` → `n` > 0.
- [ ] **Step 4: Commit** `docs: README and run instructions`.


---

## Self-review

**Spec coverage:** §3.1 reader (live strokes, media, nav grouping) → Tasks 5, 10, 11, 19; section practice rows and tests/briefs-in-place are M2 by this plan's scope. §3.2 drill screen, mistake diff, board visibility, `*` rule → 15, 17. §4.4 archive from the first stroke → 14, 16, 17. §5 Uni input → 9, 12, 13. §6 data → 14. §7 pipeline: chapters, strokes, tables, practice lists, sentences, pass marks, provenance rows (`briefs.json` carries `chapter`) → 4–7. §7.1 Stage 0 → 18. §8 tech → 1, 8. Chapter 16 per-word view, generated drills, gates, dock, SRS, lookup, reports, routines → later plans.
**Type consistency:** `Lever`, `RawStroke`, `SlotMask`, `DrillItem`, `StrokeRecord`, `Settings` are defined once (Tasks 9, 2, 15, 14) and reused unchanged.
**Review Focus:** all five have a named test (Tasks 12, 13, 16, 8, 17).
