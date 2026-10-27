# Steno Lab — Project Plan & Reference

> **Purpose of this file:** a complete, self-contained handoff document. A fresh agent session
> (or a fresh human) should be able to plan and build the entire project from this file without
> re-deriving anything. Everything below was verified during the working session that produced
> it (Oct 26–27, 2026), not recalled from memory — sources are named inline.
>
> **Status:** brainstorming complete, design direction agreed verbally with the owner. No code
> exists yet. No repo exists yet (an earlier placeholder repo `CRAZECRAZE/steno-lab` was created
> by mistake and deleted). Repo name is still an open decision.
>
> **Owner:** CRAZECRAZE (GitHub), Linux desktop, learning steno from scratch with a Uni v4 and
> Lapwing theory. This is a **private, personal, offline tool** — not for distribution.

---

## 1. What this project is

A local, offline web application that wraps the **Lapwing for Beginners** book
(https://lapwing.aerick.ca/) into an interactive learning system, driven by the owner's
**Uni v4 steno machine**.

The core idea in one sentence: *the book teaches rules as static text; this app turns every
rule, brief table, and practice list in the book into something you can press, get judged on,
get corrected on, and get reminded of — with your real steno machine as the input device.*

**Design principles (owner's stated values, in their words and intent):**

- Private and personal — "a tool for myself only." No accounts, no network calls after install.
- Offline-capable — runs entirely from the local machine.
- Simple to run — start it, practice, close it.
- A learning *architecture* around the person, not just a drill page: progression gates,
  spaced review, training archive with journals, weekly routines that change over time
  (the owner's own metaphor: "much like working out, you gotta change your routine now and then").
- Visually calm — "not against your eyes all the time." Monkeytype-style minimalism, dark theme.

**Explicitly NOT this project:**

- Not a fork or continuation of steno-lessions (no code from it). It is prior art / reference
  only — see §6. The owner was explicit: "no correlation to steno-lessions … a brand new project."
- Not a public product. If it is ever made public, revisit licensing (§5.3).

---

## 2. The owner's current steno situation (as of Oct 27, 2026)

- Complete beginner, working through Lapwing for Beginners chapter by chapter.
- Does not know the steno key positions well yet — hence the layout-visibility requirement.
- Types on the **Uni v4** running the **Plover HID** firmware (not Gemini PR serial, not QWERTY
  firmware — verified by the owner stating they use "Plover HID" in Plover).
- Plover + Lapwing installed and working (`~/.config/plover/`); uses Plover for normal steno
  writing. The lab must coexist with Plover (see §4.4).
- Progress data from the steno-lessions era exists (progress export blobs) but the owner has
  not asked to import it; treat as irrelevant unless they raise it.

---

## 3. Deliverable shape (agreed verbally)

- A local web app: a small static server + browser tab is the leading platform choice
  (see §8.1 for the tradeoff vs. Electron). WebHID requires a Chromium browser and a secure
  context — `http://127.0.0.1:<port>` and `http://localhost:<port>` both qualify; `file://` does not.
- Everything self-contained in one repo: app, content pipeline, vendored book, data folder.
- Data lives in a `data/` directory as real files (SQLite + markdown), so backup = copy the
  folder and the journal stays greppable.

---

## 4. The Uni v4 — verified hardware & protocol reference

Everything in this section was verified during the session against primary sources; keep it as
the canonical reference.

### 4.1 The board

- Product: "The Uni v4" by StenoKeyboards (https://stenokeyboards.com/products/the-uni-v4).
  248mm × 76mm, 13u × 4u, 28 keys, Gateron Clear 35g switches, OEM R3 profile keycaps
  (keycaps are blank — no legends — which is why an on-screen diagram matters).
- Unibody **split ortholinear**: left half 5 columns, right half 6 columns, two key rows plus
  a thumb row. Verified against both the official layout SVG
  (https://docs.stenokeyboards.com/images/keyboard-layouts/uni-layout.svg) and the QMK keymap.
- Features: split S (two S keys), split asterisks (four star keys), thumb number keys (two # keys).

**Physical grid (the canonical table — from QMK `keyboards/stenokeyboards/the_uni/keymaps/default/keymap.c`):**

```
Row 0 (top):    S1-  T-   P-   H-   *1  │  *3   -F   -P   -L   -T   -D
Row 1 (home):   S2-  K-   W-   R-   *2  │  *4   -R   -B   -G   -S   -Z
Row 2 (thumbs):            #1   A-   O-  │  -E   -U   #2
```

- Left half: columns 0–4 per row (row 2 has keys only at columns 2–4).
- Right half: columns 0–5 per row (row 2 has keys only at columns 0–2).
- `S1-`/`S2-` both press the steno slot `S-`; `*1..*4` → `*`; `#1`/`#2` → `#`.
- Steno slots in canonical order (23 total): `# S- T- K- P- W- H- R- A- O- * -E -U -F -R -P -B -L -G -T -S -D -Z`.

### 4.2 Plover HID protocol (from `plover/machine/plover_hid.py`, verified Oct 26 2026)

- HID usage page `0xFF50`, usage `0x4C56` (vendor-defined). Enumerate devices by this pair.
- The board sends its **full lever state as a snapshot on every state change** (not down/up events).
- Report: report id `0x50` (`'P'`), then **8 bytes = 64-bit big-endian bitmask**, bit 63 = first
  chart entry.
- `STENO_KEY_CHART` (64 entries, most significant bit first — copy verbatim from Plover's source;
  the Uni uses exactly the first 28 entries):

```
S1- T- K- P- W- H- R- A- O- *1 -E -U -F -R -P -B -L -G -T -S -D -Z #1 S2- *2 *3 *4 #2
#3 #4 #5 #6 #7 #8 #9 #A #B #C X1 X2 X3 X4 X5 X6 X7 X8 X9 X10
X11 X12 X13 X14 X15 X16 X17 X18 X19 X20 X21 X22 X23 X24 X25 X26
```

- **Stroke semantics (mirror Plover's default, `first_up_chord_send=false`):** OR-accumulate each
  non-zero report into the chord; when a report arrives all-zero, the accumulated chord is the
  stroke and the accumulator resets. A lever released mid-stroke stays in the chord.
- Reports carry lever-level detail, so the UI can light the *exact physical key* (upper vs lower
  S, which star), not just the steno slot.

### 4.3 WebHID specifics (browser side) — hard-won lessons from the previous build

- **WebHID strips the report id**: `HIDInputReportEvent.reportId` carries it separately; the
  `data` buffer contains only the payload. Parse as `(reportId, payload)` — a parser that expects
  the id as `bytes[0]` (Plover's hidapi shape) will silently reject every report. This was a
  Critical finding in the previous build's review; do not repeat it.
- Chromium-only (Chrome/Edge/Chromium; not Firefox/Safari). Feature-detect `navigator.hid` and
  degrade gracefully (the app must remain usable without the machine — QWERTY-style practice via
  browser key events is a sensible fallback mode, but is NOT a core requirement; decide scope).
- Device access needs a user gesture (a "Connect" button) and a permission prompt; permissions
  can be persisted per origin.
- On Linux, hidraw delivers a copy of every report to every open reader — **Plover can stay
  connected to the board while the app listens.** No disconnect dance needed.
- Guard double-connect (`if (device) return;`), remove event listeners on disconnect, ignore
  `disconnect` events from devices other than the current one, and only treat an all-zero report
  as "stroke complete" when the accumulated chord is non-zero (stray zero reports otherwise
  fabricate strokes).

### 4.4 Coexistence with Plover (owner's real setup)

- Reading the device in parallel works (see above). The one sharp edge: with Plover's **Output**
  enabled, Plover types translations into the focused window — recommend disabling Output while
  practicing in the lab (put this in the UI's connect flow or a tip).
- Plover reads the same device simultaneously; paper-tape stays usable for debugging.

### 4.5 Firmware variants (context only; owner is on Plover HID)

From https://github.com/petercpark/stenokeyboards-firmware (`the_uni_v4/`):
`the_uni_rp2040_default.uf2` (Gemini PR over serial), `the_uni_rp2040_hid.uf2` (Plover HID —
**the owner's**), `the_uni_rp2040_qwerty.uf2` (sends QWERTY chars — row1 `Q W E R T Y U I O P [`,
row2 `A S D F G H J K L ; '`, row3 `1 C V N M 2`), `the_uni_rp_2040_utility_belt.uf2`.
QMK source: https://github.com/qmk/qmk_firmware/tree/master/keyboards/stenokeyboards/the_uni

---

## 5. Reference data inventory (paths, licenses, merge rules)

### 5.1 Lapwing dictionaries

- **On-disk (the owner's actual Plover setup)** — `~/.config/plover/`:
  `lapwing-base.json`, `lapwing-commands.json`, `lapwing-numbers.json`, `lapwing-uk-additions.json`,
  `lapwing-proper-nouns.json`, plus `lapwing-movement.modal` (a `.modal` — **not JSON; the
  app/Python parsers used previously could not read it**, so inflected forms live outside the
  plain-JSON world; ~11% of Plover-covered words were affected in the previous build).
- **Upstream**: https://github.com/aerickt/plover-lapwing-aio → `plover_lapwing/dictionaries/`
  (MIT license). Contains additionally `lapwing-semi-modal-movement.json` and
  `lapwing-prefixed-proper-nouns.json`.
- **Merge rule (Plover priority order — first wins):** the owner's `plover.cfg` loads, in order:
  `lapwing-movement.modal` (skipped by us), `lapwing-commands.json`, `lapwing-numbers.json`,
  `lapwing-uk-additions.json`, `lapwing-proper-nouns.json`, `lapwing-base.json`.
- **Proven build output** (from the previous session): merging the six script-known files
  produced **44,063 words / 143,987 strokes**. A built copy exists at
  `steno-lessions-main/public/data/lapwing/{bundle.json,dictionary.json}`
  (AGPL project — treat as reference data, regenerate for the new project with a fresh script).

### 5.2 The Lapwing for Beginners book

- Online: https://lapwing.aerick.ca/ — mdbook. Source: https://github.com/aerickt/lapwing-for-beginners
  (`src/*.md`), **GPL-3.0**. Vendoring the markdown into a private repo is fine; if the project
  ever goes public, GPL obligations attach to derived content — keep this noted.
- Full chapter map (from `src/SUMMARY.md`, verified):

```
Ch 1  Introduction                        Ch 14 Suffix keys and compound words
Ch 2  Steno hardware and software         Ch 15 Syllabic splitting
Ch 3  How to learn steno                  Ch 16 Top 200 common English words
Ch 4  The layout                          Ch 17 Shortening techniques
Ch 5  Lapwing setup and basics            Ch 18 Fingerspelling and numbers
Ch 6  Left hand consonants continued      Ch 19 Proper nouns
Ch 7  Vowels                              Ch 20 Punctuation and commands
Ch 8  Vowels continued                    Ch 21 UK spellings
Ch 9  Right hand chords                   Ch 22 Theory principles wrap-up
Ch 10 Right hand chords continued         Ch 23 End of basic theory
Ch 11 Right hand compound clusters        Ch 24 Phrase briefs
Ch 12 Wrapping up basic words             Ch 25 Symbols and modifiers
Ch 13 Prefixes and suffixes               Ch 26 Editing text
App A  Switching to Lapwing from Plover   App B  Setting up Lapwing manually
App C  Lapwing with Javelin               App D  Theory Reference Guide (WIP, incomplete)
+ Glossary, Changes
```

- **The book's own admitted gaps** (from its home page "Current tasks" — useful as our
  differentiation): Chapter 25 (symbols/modifiers) lacks official documentation; Appendix D
  (theory reference guide) is "work-in-progress, and very incomplete."
- The book ships **practice word lists** per chapter (`practice/*.txt` in the repo) — chapters
  5–17 have them (verified in the previous session; a built chapter→words mapping exists in
  `steno-lessions-main/public/data/drills.json`, built by that project's
  `scripts/build-drills.js`).
- The book renders strokes as SVG graphics (contributed feature) — static images; our reader
  will replace these with live, interactive stroke elements.

### 5.3 Licensing summary (keep with the project)

| Source | License | Consequence for this private tool |
| --- | --- | --- |
| steno-lessions (prior art) | AGPL-3.0-or-later | Reference ideas freely; **do not copy code** unless willing to make the whole project AGPL. Private use is safe either way. |
| lapwing-for-beginners (book) | GPL-3.0 | Vendoring markdown into a private repo is fine; distribution would trigger GPL on derived content. |
| plover-lapwing-aio (dictionaries) | MIT | Free to use; keep the notice. |
| plover (protocol reference) | GPL-2.0 | Protocol facts/constants are fine; don't copy source. |

### 5.4 Other paths worth knowing

- Plover config: `~/.config/plover/plover.cfg` (dictionaries list, machine config), `plover.log`.
- The steno-lessions working copy (prior art + built data): `steno-lessions-main`
  — includes `docs/superpowers/specs/2026-10-26-uni-v4-design.md` and
  `docs/superpowers/plans/2026-10-26-uni-v4.md` (the Uni v4 work's full design/plan) and a
  tested, reviewed WebHID+Uni implementation (`public/lib/uni.js`, `public/app.js`) that can be
  studied (not copied) for protocol handling.
- Fork: https://github.com/CRAZECRAZE/steno-lessions (branch `uni-v4`) — same content, pushed,
  commits authored as CRAZECRAZE. Keep or ignore; the new project does not depend on it.

---

## 6. Prior-art notes: what steno-lessions got right and wrong (ideas worth porting as *ideas*)

The owner learned on steno-lessions (keybr-style: unlock one key at a time). Read
`steno-lessions-main/public/lib/lessons.js` if you want the details. Highlights:

**Worth borrowing conceptually:**
- Recency windows over lifetime averages (a rolling ~30-attempt accuracy window per key; a bad
  patch fades instead of blocking forever).
- Per-key "confidence" combining sample count, speed (EWMA with miss penalties), and accuracy —
  drives word selection toward the weakest key.
- Difficulty banding: isolated short reps ("etudes") for weak keys, recombination drills
  ("concertos") for fresh keys, normal mixed practice between.
- Diagnosing *why* a learner is slow: compare isolated-rep speed vs blended speed ("kinematic
  gap"); if isolated reps aren't faster, the problem is chord formation, not word complexity —
  force isolated work.
- Weakness weighting uses max-of-chord (not a product over all keys) to avoid compounding.
- Scaffold fading with deliberate opt-out and re-mastery requirements.
- Forgiving chord reading: partial strokes held and completed; restart-on-first-stroke;
  `*` = undo.

**Its known weaknesses (this project should do better from day one):**
- Flat per-chord speed target regardless of chord size (big chords read as "slower" — a
  size-aware speed model would measure skill, not chord mass).
- No confusion-pair modeling (records *that* a key missed, not *which wrong key* was hit).
  The new project's archive should record wrong-key identity and surface confusion pairs.
- The etude/study/concerto banding was invisible to the learner.
- Weak rare keys were drilled only in very short words.
- README drifted from code (target numbers changed without updating docs) — keep docs honest.

---

## 7. Product definition — the full feature set

Organized as pillars. Items marked ★ are the owner's explicit asks; others were proposed in the
brainstorm and welcomed ("everything sounds amazing so far"). Suggested milestone grouping in §10.

### 7.A Content pipeline (the backbone — build first)

- ★ All book content lives inside the app: chapters, rules, brief tables, practice lists.
- Vendor the book's markdown (GPL — see §5.2) into `content/lapwing-book/` with a documented
  sync script pinning an upstream revision.
- Build step (`scripts/build-content.js` or similar) parses the markdown into structured JSON:
  - chapters (title, prose sections, order),
  - **stroke references** inside prose/tables (the book's stroke notation and SVG graphics) —
    each becomes an addressable, live element,
  - **brief tables** → rows of (writing → steno outline → notes),
  - **practice lists** per chapter (from `practice/*.txt`),
  - **brief→chapter provenance map**: every brief the book explicitly teaches, with the chapter
    (and ideally the rule/section) that introduces it. This map powers the reverse lookup's
    classification and the SRS auto-enrollment. It is the single most important derived artifact.
- Merge the Lapwing dictionaries (§5.1 order) into the app's dictionary bundle; keep raw
  dictionary available for lookup/preview.

### 7.B Interactive reader

- ★ Read the book inside the app, chapter by chapter.
- Every stroke element is **live**: hover/focus highlights those keys on the Uni v4 diagram;
  pressing the machine while it's focused could type the stroke and confirm.
- Brief tables are **testable in place**: click a row to drill that brief.
- ★ Keyboard layout toggle: always visible / on hover / hidden — the owner doesn't know the keys
  well yet, so default it ON (always-visible Uni v4 diagram).
- Reading annotations: highlight rules, flag "this is hard," one-click convert any table row
  into an SRS flashcard.

### 7.C Practice engine (Monkeytype-style, ★ explicit ask)

- Word stream with live wpm/accuracy, caret-free steno flow (chords scored on release/all-up).
- ★ Chapter selection: practice any unlocked chapter's material; also cumulative "everything so
  far" mode.
- Modes: chapter word drills; **brief recall** (English→outline, and outline→English);
  **qualification exams** (★ "qualifications to go to the next chapters" — gate the next
  chapter's material behind passing the current chapter's practice: propose default thresholds,
  e.g. ≥95% accuracy and ≥20 wpm over a fixed word count, owner-adjustable; several chapters
  have no practice list — gates for those are brief-recall exams); **speed runs** on
  benchmark texts; fingerspelling; numbers/punctuation (their own modes — ★ confirmed "its very
  own chapter too").
- Difficulty sourcing: prefer the chapter's own vocabulary; weight toward the chapter's new
  rules; include review material from earlier chapters (spaced).

### 7.D Uni v4 integration

- ★ WebHID input per §4 (connect button, status, coexists with Plover).
- ★ Board diagram of the real 28-key layout (§4.1 grid), colored by steno group
  (left orange / vowels blue / right purple, stars with left), locked/dimmed states where
  applicable, exact-lever lighting.
- **Mistake diagnosis on the board** (owner: "amazing idea, very much needed especially early"):
  on a miss, show the diff between pressed and required as lit keys on the physical layout,
  grouped by finger/position, plus the stroke notation. Record the wrong-key identity for
  confusion-pair analytics (§7.G).
- Graceful no-device mode (practice still possible via keyboard events, or read-only modes).

### 7.E Briefs memory (SRS)

- An SRS deck (SM-2-ish is enough) that **auto-enrolls every brief the book teaches** (via the
  provenance map) as its chapter is reached, plus manually-added cards from reading annotations.
- Daily due queue; integrates into the session composer (§7.J).
- Enroll book-taught briefs only — never derivable spellings (see §7.F rationale).

### 7.F Reverse lookup

- "How does Lapwing write X?" box: searches the merged dictionary; classifies each candidate:
  1. **Book brief** — "EPS, brief from Ch. 14, memorize" (provenance map) — shown first.
  2. **Derivable** — built from rules ("rules could build ES/PERB/HREU, but the book wants the brief").
  3. **Not in dictionary** → fingerspelling fallback suggestion.
- Verified examples to test against: `especially` → EPS + `ES/PERB/HREU`, `ES/PERBL/KWREU`;
  `necessary` → TPHES + three derivations; `the` → -T (brief only, no derivation).
- Show every candidate as a live stroke on the board.

### 7.G Training archive & analytics (★ explicit ask, expanded heavily by owner)

- ★ **Archive every training session, down to each test taken.** Storage: single SQLite file
  (`data/…`). One row per test: timestamp, mode (drill/exam/briefs/speed/fingerspelling/real-text),
  chapter, item count, wpm, accuracy, duration, full miss list (stroke + wrong-key identity).
  Also per-stroke event capture (compressed) — enough to reconstruct sessions.
- ★ **Progression over weeks/months**: month calendar heatmap; click a day → every test that
  day; trend lines per mode/chapter.
- ★ **End-of-month auto report**: wpm delta, accuracy delta, weakest keys, top confusion pairs,
  practice-time total, and a *suggested focus* for next month's block — annotatable by the owner.
  "Seeing actual progression at the end of each month is always motivating" — this report is the
  feature that delivers that feeling.
- **Confusion-pair analytics**: which wrong key was pressed instead of the right one, over time
  (e.g., T-/K- adjacency errors shrinking month over month).
- **Plateau detection**: N weeks without improvement on a chapter/metric → surface it and
  suggest a routine change (feeds §7.I).
- Optional: per-stroke speed curves per key; session time totals (practice-time tracking).

### 7.H Training journal (★ explicit ask)

- ★ **Notes at the end of each training session** — what they think, how well they did by their
  own assessment, etc.
- Implementation: plain markdown per day, `data/journal/YYYY-MM-DD.md`; the app appends an
  auto-generated session summary (tests taken, wpm/acc) beneath the owner's text; the editor
  opens automatically at session end (the session composer's last step).
- Fully offline and human-readable; the file is theirs.

### 7.I Weekly routine planner (★ explicit ask)

- ★ A weekly practice-session map that changes over time — "much like working out."
- Editable weekly template of day blocks (e.g., Mon: Ch. 9 drills + due briefs; Wed: speed;
  Sat: chapter exam). The app assembles each day's session from the template + SRS dues
  (§7.J). Template edits preserved with dates, so routine versions can be correlated with
  progress later.

### 7.J Session composer

- One button: "today's session" — assembled from: warm-up (yesterday's misses / due SRS), the
  routine template's block for today, current-chapter practice, a benchmark run, then the
  journal prompt (§7.H). Skippable parts; never forced.

### 7.K Extras (welcomed in brainstorm, later milestones)

- **Ghost replay**: race your own best run on benchmark texts.
- **Real-text practice**: paste/import any text; the app annotates each word as
  learned-brief / derivable / not-yet-learned; the annotation thins out as you progress
  (long-term motivation engine for after the book).

---

## 8. Architecture proposal (open to revision during planning)

### 8.1 Platform

**Recommended: tiny local static server + browser tab.** A `start` script (Node ≥ 18, or even a
~40-line Python fallback) serves the app on `127.0.0.1`, opens the browser. Fully offline after
setup; WebHID works on localhost; zero heavyweight deps. **Electron/Tauri rejected**: Electron is
~200MB for no gain here; Tauri's Linux webview (webkitgtk) does **not** support WebHID — it would
break the core input path. (Owner runs Linux.)

### 8.2 Stack suggestions (to be finalized)

- Frontend: vanilla ES modules or a light framework (Preact/Svelte) via Vite; keep dependencies
  minimal; dark theme; keyboard-first UI; Monkeytype-like minimalism ("not against your eyes").
- Data: `better-sqlite3` (Node) for the archive; JSON bundles for content; markdown journal;
  all under `data/` (git-ignorable or git-tracked — owner's choice; tracking the journal in git
  is a nice bonus).
- Repo layout sketch: `app/` (client), `server/` (tiny server + API), `content/lapwing-book/`
  (vendored book), `scripts/` (content pipeline, dictionary merge), `data/` (runtime data,
  git-ignored), `docs/` (this file + future design docs).

### 8.3 Data model sketch (SQLite, draft to refine)

```sql
tests(id, started_at, ended_at, mode, chapter, item_count, wpm, accuracy, meta_json)
strokes(id, test_id, ts_ms, chord_bits, expected_bits, correct, -- wrong-key identity derivable
        ...  -- or store (pressed_levers_json, expected_names_json)
journal_entries(date, body_md)            -- or just markdown files; decide in planning
srs_cards(id, prompt, answer, chapter, source, ease, interval_days, due_at, lapses)
routine_templates(id, valid_from, json)   -- weekly template versions
```

Key analytics derive from `strokes`: confusion pairs (`expected vs pressed`), per-key speed
curves, session reconstruction. Chord bits should use a stable 23-slot bit order (see §4.1);
lever-level detail (S1-/S2-, *1-*4, #1/#2) belongs in the JSON fields, not the slot mask.

---

## 9. Decisions made vs. open

**Made (owner-confirmed):**
- Brand-new private project; zero steno-lessions code (fork exists separately as reference).
- Built around the Lapwing book + Uni v4; book content in-app; chapter qualification gates.
- Offline, simple, local; Monkeytype-style practice with chapter selection.
- Layout toggle visible by default early on.
- Training archive down to per-test granularity; journal; month-end progression reports;
  weekly routine planner (later: session composer, ghosts, real-text).
- Briefs SRS; reverse lookup with brief/derivable classification; mistake diff on the board.
- Platform: local server + browser (owner accepted the reasoning; Electron/Tauri rejected).
- No AI-disclosure requirement for this private tool (owner's call).

**Open (settle in the next session's planning):**
- Repo name (working title "steno-lab" was a placeholder the owner never confirmed).
- Frontend framework (vanilla vs Preact/Svelte) and whether to use Vite.
- Exact qualification thresholds per chapter type (defaults proposed in §7.C; owner-adjustable
  settings UI needed).
- How chapters without practice lists gate (brief-recall exam proposal).
- SQLite journal table vs plain markdown files (both viable; markdown keeps ownership story).
- Scope of the QWERTY fallback mode (nice-to-have vs cut).
- How thoroughly to parse book *prose* into structured rules (full parse is hard; a pragmatic
  approach: structure the tables/strokes/practices precisely, keep prose as rendered text).
- Porting `*`-undo/partial-stroke forgiving-chord semantics: reimplement (recommended) —
  study steno-lessions' `classifyStroke` approach for ideas without copying code.

---

## 10. Suggested milestones

- **M0 — Skeleton + pipeline**: repo, app shell, vendored book, build script producing
  chapters.json + briefs.json + brief→chapter map + dictionary bundle. No input handling yet.
- **M1 — The core loop** (first usable version): Uni v4 connect (§4 protocol), board diagram
  with layout toggle, chapter word drills with live wpm/acc, mistake diff on the board.
  Practice chapter 5's material end-to-end.
- **M2 — Progression**: chapter qualification exams + gates, chapter selection UI, reader v1
  (live strokes, testable brief tables).
- **M3 — Memory & lookup**: SRS deck with auto-enrollment, reverse lookup with classification.
- **M4 — The record**: SQLite archive (per-test + per-stroke), journal with auto-summaries,
  month heatmap + end-of-month report, confusion-pair analytics.
- **M5 — The architecture around it**: weekly routine planner, session composer, ghosts,
  real-text mode, plateau detection.
- Rationale: M1 alone is already a daily-use tool; everything after deepens the loop the owner
  asked for ("an architecture for myself around it").

---

## 11. Glossary (steno terms used above)

- **Stroke/chord**: all keys pressed simultaneously; scored on release (all-up).
- **Brief**: a memorized short outline for a word/phrase (vs. a *derivable/phonetic* outline
  built from rules). The book teaches explicit briefs throughout; chapters 16, 24 are brief-heavy.
- **Slot**: one of the 23 logical steno keys (S- T- K- P- W- H- R- A- O- * -E -U -F -R -P -B -L
  -G -T -S -D -Z #). Levers are the *physical* keys (28 on the Uni; split keys share a slot).
- **Fingerspelling**: spelling words letter-by-letter on the steno board (Ch. 18).
- **Paper tape**: Plover's stroke log dialog.
- **SRS**: spaced repetition system.

---

## 12. Session provenance (what was verified where — for traceability)

- Uni grid: QMK `keymaps/default/keymap.c` + docs SVG, cross-checked (Oct 26 2026).
- Plover HID protocol: `plover/machine/plover_hid.py` @ main (fetched, read in full).
- WebHID report-id behavior: WHATWG/MDN `HIDInputReportEvent.reportId` ("the one-byte
  identification prefix… or 0 if the interface does not use report IDs" — data excludes it).
- hidraw multi-reader broadcast: Linux kernel hidraw design; relied on for Plover coexistence.
- Dictionary merge outputs: built and counted live (44,063 words / 143,987 strokes).
- Reverse-lookup examples: queried live from the built Lapwing dictionary (§7.F values).
- steno-lessions algorithm review: read `lessons.js` in full; findings summarized in §6.
- Book chapter map + licenses: fetched from the repos (Oct 27 2026).

*End of document.*
