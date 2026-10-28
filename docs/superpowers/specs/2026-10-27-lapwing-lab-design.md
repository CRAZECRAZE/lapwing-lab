# Lapwing Lab — Design

Working name: `lapwing-lab` (the owner has not confirmed a name).
Date: 2026-10-27. Status: approved by the owner; M0 and M1 are built. The order of work was amended the same day (§9, §3.5): the owner asked for the lab's tabs (history, free type, day tracking, journal) right after M1, ahead of core practice.

## 1. Intent

The owner is teaching themself stenography from day one (started 2026-10-26) with a Uni v4 board and the free *Lapwing for Beginners* book (https://lapwing.aerick.ca/). They are at the start of Chapter 4.

The book is good, but doing it means juggling the book, Steno Jig, Typey Type, Plover's lookup tool and a notebook. The owner wants one place for all of it, for themself only:

> A modernized, interactive version of the actual book, with practice, quick lookups and progress logging all attached to the page they are reading.

The point is to learn Lapwing *theory*, not just to memorize key positions. The owner tried a key-unlocking drill app (steno-lessions): good for learning where the keys sit, but "not really learning theory there." This app should be the opposite: the book's rules are the lesson, and drills exist to cement them.

## 2. Goals, non-goals, anti-goals

**Goals**
- The entire book is inside the app: all 26 chapters, Home, Glossary, Changes and Appendices A–D. Reading it there is a complete experience.
- Every stroke in the text is live: it shows on a board, and pressing it on the Uni confirms it.
- Every section that has a drill in the book has that drill attached to its place on the page.
- Practice is judged on the owner's real Uni v4, with feedback that explains misses.
- Every practice stroke is logged from the first session, so progress can be shown later.
- Chapter-by-chapter progression with pass marks taken from the book.
- A set of "quick pull" tools one keypress away while reading or practicing.
- Later systems: briefs memory (SRS), reverse lookup, training journal, monthly progress report, weekly routine planner, a "today's session" composer, ghost replay of your own best runs, and practice on pasted real text.

**Non-goals**
- Not public, not multi-user: no accounts, no network calls once installed.
- Not a replacement for Plover. The app never sends strokes to Plover, never types text, never edits Plover's config.
- Not new theory: the app teaches Lapwing as the book does.
- No no-board (normal keyboard) practice mode in v1.
- No mobile or small-screen layout.
- No Javelin support (Appendix C is rendered but ignored).
- No import of the owner's old steno-lessions progress unless they ask.
- No code copied from steno-lessions (AGPL; the owner said this is a brand-new project).

**Anti-goals** (a failure even if everything works)
- A screen where the *board* dominates attention. The owner tested two layouts and picked the one where the word/prompt dominates, because the board-first one "puts attention on memorization rather than actual learning."
- A drill farm that has lost the book. Practice must trace back to a book section.
- Loud or harsh visuals. Target is calm and dark, Monkeytype-like.
- Gates that nag or trap. Pass marks inform; the owner can move on.
- Losing or being unable to reconstruct practice data.
- Breaking the owner's Plover setup, e.g. by taking the device exclusively.

## 3. Product shape

### 3.1 The reader (the spine)
The main screen is a chapter page rendered from the book's own text, in order, with a chapter list on the left, the reading column in the middle and a dock of quick pulls on the right. Chapters ahead of the owner's progress are visible but greyed: they stay fully readable, but their practice and tests are locked until the gate opens (4.1). A status line shows device connection, a Plover-output reminder and a streak. (A mockup was shown and the owner called it "exactly how I imagined it".)

- **Live strokes.** Every `<steno-outline stroke="…">` tag and every stroke written in backticks in prose, lists and tables becomes an addressable stroke element. Hovering or focusing it lights the keys on a small board; pressing it on the Uni confirms it.
- **Clickable examples.** Example words (`dad TKAD`) can be clicked to try.
- **Section practice.** Each section that links a practice file in the book gets a "Practice this section" row at its end, showing the word count and last result. Starting it opens the drill screen (3.2) on that list.
- **Media.** The book's images, GIFs and pronunciation videos are copied in and played inline (about 60 MB, 231 files). The book's own SVG-style stroke graphics are replaced by the live component.
- **Chapter tests** appear at the end of a chapter with the book's recommended pass mark.
- **Chapter briefs** tables (end of chapters 5–12) and their "practice sentences with answers" are practiceable in place.

### 3.2 The drill screen
Prompt-first (chosen by the owner). A large word or stroke in the middle, a small board underneath, a thin stats line (progress, accuracy, wpm).
- **Two prompt kinds:** *stroke prompts* (Stage 0 / Chapter 4: the prompt is raw steno such as `SAP` or `-RBGSZ`) and *word prompts* (Chapter 5 onward: the prompt is the English word and the owner must produce its stroke).
- **Board visibility** setting: always on / on hover / hidden. Default always on early; the owner fades it out when ready. In word-prompt mode the board and the stroke are *hint on miss* (the book's own test setting "show hint on misstroke").
- Word-prompt hints default to on-miss; a **Hint** setting (`on miss` / `always`) lets the learner see the needed keys, and the stroke text, from the start of every word (owner request 2026-10-27, after trying M2).
- **Mistake diff.** On a miss, show the pressed keys against the required keys on the physical layout (missing and extra keys marked), plus the stroke in notation. Record exactly which keys were wrong.
- **Chord scoring.** A stroke is complete when all keys are released (see 5.2). A lone `*` stroke undoes the previous attempt (as in Plover), except where the expected stroke itself is `*`.
- **Book-faithful tests.** A chapter test uses the book's settings: a union of the chapter's drill lists, 45 words, 3 repetitions each (the owner or builder should confirm the exact meaning of "repetitions" against Typey Type), random order.

### 3.3 The dock (quick pulls)
All one keypress, available from the reader and the drill screen. These five are the builder's starting set; the owner has not yet said what they most often need.
1. **Lookup `/`** — "how do I write …". Early on it searches only what the book has taught so far (practice-list words, example words, brief tables). Once the dictionary merge exists (M5) it searches the full Lapwing dictionary and classifies results (see 4.3). *Amended by M5a (2026-10-28):* Lookup searches the full official Lapwing dictionary with no chapter limit and shows book labels only; see `2026-10-28-lapwing-lab-m5a-dictionary-lookup-design.md`.
2. **Key chart `K`** — the board with the sound each key makes.
3. **Briefs so far `B`** — every brief table from chapters up to the current one.
4. **My notes `N`** — free-form notes per chapter, kept as plain markdown.
5. **Today** — the session composer's plan and progress (M7).

*Settled for M4 (2026-10-28):*
- **How it opens.** A tool opens as a drawer over the right-hand side of the page; Esc closes it. In the reader the bare keys `/`, `K`, `B`, `N` open Lookup, Key chart, Briefs and Notes whenever the focus is not in a text field. On drill screens (Stage 0, section drills, chapter tests, free type) the drill swallows plain keys because the board's stray output would otherwise trigger panels, so there the keys are `Alt+/`, `Alt+K`, `Alt+B`, `Alt+N`. Four small buttons in the top bar open the same tools with the mouse on every tab.
- **A drill pauses while a tool is open:** strokes are ignored and the clock stops, as when the board is unplugged; closing the tool returns the focus to the drill.
- **"Taught so far"** means chapters up to the owner's current chapter (the first one not yet cleared, never earlier than Chapter 4). Lookup and Briefs show a checkbox `Include later chapters` (off by default) so nothing is hidden for good. Every hit says which chapter teaches it.
- **Lookup data:** the words of every practice list, the example words in the chapter text (bullets of the form ``word `OUTLINE` ``), and every brief table. A query that looks like steno (letters from the steno order, `*`, `-`, `#`, `/`) also searches by outline, so it works in reverse.
- **Key chart:** the board with, on each key, the sounds the book teaches for it (the consonant table in Chapter 5 and the vowel sections); no sound is invented.
- **Notes:** one plain markdown file per chapter, `data/notes/chNN.md` (chapters 1–26), with the same never-lose-text behavior as the journal (it shares the save queue).
- **Chapters 18, 20 and 21** get generated drills (fingerspelling lowercase and uppercase and numbers; punctuation and the commands; the UK spellings), built from the chapter text at build time and listed like any other practice list. Their gate becomes the section-drill gate (every drill once at 90% or better) instead of "marked read".

### 3.4 Look and feel
Dark, calm, keyboard-first. Left-hand keys orange, vowel keys blue, right-hand keys purple; star keys follow the left hand. Typographic detail is left to the builder.

### 3.5 The lab tabs (M2)
*Owner's request, 2026-10-27, after trying M1:* "my vision was more than just [the book and drills] — several tabs, with history, practice session loggings, free type like Monkeytype, session logs, personal notes after each session, day-tracking."

A top bar switches between **Book · Practice · History · Days · Journal**. Book is the reader as built; the chapter list shows only there, and the other tabs use the full width. Same calm, dark look.
- **Practice** is the launcher: the Chapter 4 drills (as in the reader), and **free type**. Section drills and chapter tests join it in M3.
- **Free type** (Monkeytype-like): a flowing line of words with the current word highlighted, live wpm and accuracy, and a result card. Modes: 25 or 50 words, or 30 or 60 seconds, or a custom number of words (1–500) or seconds (5–600) (owner request 2026-10-28; the timed wpm is unchanged: first stroke to last completed word). *My call:* the words come only from what the book has taught so far: the Chapter 4 pseudo-words, or the practice lists of Chapters 5 up to a chapter the owner picks. Judging, hint-on-miss and logging are the drill screen's. Board visibility follows the existing setting.
- **History:** every practice test, newest first, with date, kind, speed, accuracy and stroke count. Opening one shows its stats, every miss (what was pressed against what was required) and the slowest words. Tests with no strokes are never listed.
- **Days:** a month calendar showing which days had practice and how much, the current streak (also shown in the status line), month totals, and a day view with that day's tests and journal note. A "day" is the local calendar day of a test's first stroke.
- **Journal:** one plain markdown note per day, editable, with the day's results shown read-only beneath it. After a drill or free-type run, the result card offers "Add a note", which appends a stamped entry to today's file. (Replaces 4.5's "opens at the end of a session": the app has no formal session, and a prompt after every run would nag.)

Practice logging is fixed in the same milestone: a test is created on its first stroke, so opening a drill and leaving writes nothing, and leaving early closes the test with its partial results marked abandoned.

### 3.6 Practice time
"Time practiced" means the span from a test's first to its last stroke, summed over tests. It excludes time spent reading, idling before a first stroke, or paused. It is approximate by design.

## 4. Systems

### 4.1 Progression and gates
Every chapter has a pass mark, parsed from the book's text ("Aim for 10–20 WPM with 90% accuracy"; Chapter 4: "10 minutes or less with 90% accuracy"). Chapters 12, 14 and 17 have no test.
- *Owner's request:* "qualifications to go to the next chapters."
- *My call:* the gate unlocks the next chapter when the owner reaches **at least the book's accuracy and the low end of its wpm range** on the chapter test. It is shown plainly as a requirement and the owner can override ("move on anyway") at any time, because the book calls its own marks "only a suggestion." For no-test chapters the gate is completing each section drill once at ≥ 90% accuracy.
- Chapters with no test and no drills (1–3, 19, 22–26 and the appendices) unlock the next chapter once they are marked read (one button, no timer). Chapters 18, 20 and 21, whose drills are generated from tables, unlock on completing each generated drill once at ≥ 90% accuracy. The same override applies everywhere.
- Accuracy is words answered correctly on the first stroke attempt ÷ words shown. Speed is words per minute counted per translation, since the book's goals come from Typey Type (the builder should verify).

*Settled for M3 (2026-10-27):*
- **Chapter test shape**, from the book's own test-settings screenshot (`img/5-test-settings.png`: limit 45, repetitions 3, sort random, "Total words: 135", show hint on misstroke only): the test draws **45 random words** from the chapter's `N-test` list and shows **each 3 times in a row**, so 135 prompts. Every chapter test list has at least 112 words.
- **The chain.** Chapter 4's practice (Stage 0) is always open. Chapters 1–3 only get a "marked read" tick and never block anything. From Chapter 5 on, a chapter's practice opens once every chapter from 4 up to the one before it is cleared. Chapters 18 and up have no drills until M4, so until then they clear by "marked read". Chapters ahead stay readable. (Done in M4: Chapters 18, 20 and 21 now have generated drills and the section-drill gate; only Chapter 19 and Chapters 22 and up still clear by marked read.)
- **Cleared** means: the chapter test (or, for Chapter 4, the Stage 0 test) was passed once; or, for chapters 12, 14, 17, every section drill was done once at ≥ 90%; or the chapter was marked read; or the owner used "move on anyway". A run left early never counts.
- **Passing** needs the book's accuracy **and** at least the low end of its wpm range (Chapter 4: the accuracy within its time limit). The verdict is recorded with each run (`meta.passed`), so history keeps what the rule was when the run happened.
- **Where drills live in the reader:** the book already ends each section with a link to its practice list. M3 makes those links live and shows them as a row with the word count and the last result. A panel at the top of every chapter page shows the gate, its requirement, the chapter's drills and the test, with "mark as read" / "move on anyway".
- **Mistake review** stays what M2 built: the miss overlay while drilling and the miss table in History. M3 adds nothing new there.
- **Skipping ahead** (owner request 2026-10-27, after trying M3): "open anyway" on a locked chapter marks every chapter from 4 up to the one before it that is not cleared as "moved on anyway", so that chapter opens in one step (each mark can still be undone on its own). "Move on anyway" still marks only the chapter it is on. Both ask "Are you sure?" in a dialog before writing anything; cancelling writes nothing. "Mark as read" and "undo" do not ask.

### 4.2 Briefs memory (SRS)
A deck of briefs taught by the book, scheduled SM-2-style, with a daily due queue. The book says briefs are optional until Chapter 16 and that write-outs come first. *My call:* the deck is **opt-in per chapter** (one button "add this chapter's briefs to my deck") and everything auto-enrolls at Chapter 16. Only briefs the book explicitly teaches are enrolled; derivable spellings never are.

### 4.3 Reverse lookup and the brief/derivable classification
Searches a merged Lapwing dictionary (the owner's real Plover stack, in Plover's priority order; see `docs/reference/steno-lab-plan.md` §5.1) and labels each result: *Book brief* (with the chapter that teaches it), *Derivable from rules*, or *Not in dictionary* (fingerspelling hint). Needs a brief → chapter provenance map built from the book's brief tables. Known test cases: `especially` → `EPS` (brief) + derivable `ES/PERB/HREU`; `the` → `-T` (brief only).

*Amended by M5a (2026-10-28):* this classification is replaced. Lookup searches the official Lapwing dictionary (not the owner's stack), lists every outline of a word shortest first, and labels only where the book teaches an outline; there is no "derivable" guess. The test cases stay: `especially` writes `EPS`, `ES/PERB/HREU` and `ES/PERBL/KWREU`; `the` writes `-T`. See M5a spec §4.

### 4.4 Training archive
All practice is recorded from the first session: sessions, tests, and every stroke. See §6. Basic history and per-day views arrive in M2 (3.5). The rest comes later (M6): a heatmap, trend lines per mode and chapter, confusion pairs (which wrong key was hit instead of the right one), plateau detection and an end-of-month report (wpm and accuracy deltas, weakest keys, top confusion pairs, practice time, suggested focus, owner-annotatable).

*Amended by M6 (2026-10-28):* the M6 views are the Progress tab (panels, rhythm, the stats route) and, later, the plateau notice and the month-end report, as described in `specs/2026-10-28-lapwing-lab-m6-progress-design.md`; M6a (the Progress tab) is built, M6b (plateau notice and month report) is not.

### 4.5 Training journal
At the end of a session the app opens a plain-text note for the owner's own words (what they think, how it went). One markdown file per day (`data/journal/YYYY-MM-DD.md`) holding only the owner's words. *My call, M2:* the auto-generated summary of the day's tests is shown live beneath the note and is never written into the file, so the file stays the owner's text and the summary cannot go stale.

### 4.6 Routine planner and session composer (M7)
An editable weekly template of day blocks that changes over time ("much like working out"); versions are kept with dates so a routine can later be compared with progress. "Today's session" assembles a warm-up (recent misses, due briefs), the day's template block, current-chapter practice, and then the journal prompt. Every part is skippable. The book recommends 15 minutes to an hour a day and warns against more than three hours; the planner should respect that.

### 4.7 Extras (last)
- **Ghost replay:** race your own best run on a fixed text.
- **Real-text practice:** paste any text; each word is annotated learned / derivable / not-yet-learned, and the annotation thins as the owner progresses.

## 5. The Uni v4 and the input layer

Full verified facts are in `docs/reference/steno-lab-plan.md` §4. The essentials:

### 5.1 Hardware
28 keys: left half 5 columns, right half 6, two key rows plus a thumb row.
```
Row 0:  S1  T   P   H   *1  │  *3  -F  -P  -L  -T  -D
Row 1:  S2  K   W   R   *2  │  *4  -R  -B  -G  -S  -Z
Row 2:          #1  A   O   │  -E  -U  #2
```
The two S keys, four star keys and two `#` keys each map to one steno slot. The owner's board runs the Plover HID firmware. In this environment it appears as `/dev/hidraw9` with a StenoKeyboards udev rule present; access from the browser is *expected* to work but is unverified.

### 5.2 Reading it
- WebHID, usage page `0xFF50`, usage `0x4C56`. Connect requires a user click and a permission prompt; Chromium or Brave only; `http://localhost` qualifies as a secure context.
- Reports are full-state snapshots: report id `0x50` followed by a 64-bit big-endian bitmask, MSB first, using Plover's 64-entry key chart (the Uni uses the first 28).
- **WebHID strips the report id from the data buffer** and delivers it as `event.reportId`. A parser that expects it at byte 0 silently drops every report (this was a critical bug in an earlier attempt).
- Stroke semantics: OR-accumulate every non-zero report; when an all-zero report arrives and the accumulated chord is non-empty, that chord is the stroke and the accumulator resets.
- The report carries individual levers, so the board can light the exact key (upper vs lower S, which star). Judging compares *slots*; logging keeps levers.
- On Linux, Plover can stay connected while the app listens. Guard against double-connect, remove listeners on disconnect, and ignore disconnect events for other devices.
- **Stray output.** While Plover's Output is on, it types translations into the focused window. The app shows a persistent reminder, and the builder should consider a hidden focused input that swallows any stray typed text so a misplaced translation cannot disturb the page.

### 5.3 Raw steno notation
The book's stroke strings use the order `#STKPWHRAO*EUFRPBLGTSDZ`. A hyphen marks right-hand-only strokes (`-T`, `-RBGSZ`); it is omitted when a vowel or `*` is present. `/` separates strokes of a multi-stroke outline. The parser maps each string to a set of slots and back.

## 6. Data

Everything the owner creates lives under `data/` in the project and is easy to back up by copying.
- `data/steno.db` (SQLite via Node's built-in `node:sqlite`).
- `data/journal/YYYY-MM-DD.md`, `data/notes/*.md`, `data/settings.json`.

Starting sketch (the builder refines):
- `sessions(id, started_at, ended_at)`
- `tests(id, session_id, started_at, ended_at, mode, chapter, section, item_count, wpm, accuracy, meta_json)`
- `strokes(id, test_id, ts_ms, prompt, expected_json, pressed_levers_json, pressed_slots_mask, correct, latency_ms, attempt_no)` — enough to rebuild a session and to derive confusion pairs.
- `srs_cards(id, prompt, answer, chapter, source, ease, interval_days, due_at, lapses)`
- `routine_versions(id, valid_from, json)`
- progress and unlock state per chapter.

## 7. Book content pipeline

Source: https://github.com/aerickt/lapwing-for-beginners, copied into `content/lapwing-book/` at commit **`46b53e1ebe…`** (2026-06-21), with a script that re-syncs to a chosen commit. **GPL-3.0**: fine for a private repo; if the project is ever published, GPL applies to the derived content.

What the source contains (checked):
- `src/*.md`: Home, Chapter-01…26, Appendix-A…D, Glossary, Changes, SUMMARY.
- `src/practice/*.txt`: 57 files, 7,299 lines, every line `word<TAB>stroke`, none malformed. Multi-stroke outlines use `/` (e.g. `SPR*EUPBG/HRER/-Z`). Chapters 5–11 and 13, 15, 16 have a `*-test.txt`. There is no test file for 12, 14 or 17.
- Strokes appear as: `<steno-outline stroke="…">` tags (about 100 across the book, many in the Chapter 18 tables); example bullets like ``* dad `TKAD` ``; markdown tables (Chapter briefs: Word | Brief | Explanation; Extra briefs; Chapter 14's suffix table; Chapter 20 punctuation); and "Practice sentences" with an answers list of `/`-joined outlines.
- Chapter 4's drills are *not* in a practice file: the pseudo-word test and its extra-practice blocks are in code fences in the chapter body, and the row drills (`SKWR`, `-RBGSZ`, `#TPH`, `-FPLTD`, `AOEU`) came from the external Steno Jig. The app defines these itself.
- Each chapter ends with a test section and an "Aim for X–Y WPM with Z% accuracy" line (parsed into the gate data).
- Chapter 16 gives every top-200 word its own heading with *Brief* and *Write-out* lines; some words allow either, so **a word may have several accepted outlines**.
- `theme/steno-viz.js` is the book's own renderer for the stroke tag; the live component replaces it (study, do not copy, unless the project accepts GPL for it).

The pipeline's output: chapters with sections, rendered prose, media references, stroke references, brief tables, practice lists, practice sentences, pass marks, and the brief → chapter provenance map.

### 7.1 Chapter by chapter

| Book part | In the app |
|---|---|
| Home, 1–3 | Read-only; Chapter 1 and 3 strokes are live |
| 4 The layout | **Stage 0.** App-defined row drills, then the pseudo-word test (stroke prompts), pass mark 90% in ≤ 10 min |
| 5–11 | Full treatment: reader, section drills, chapter test, chapter briefs tables with practice sentences |
| 12, 14, 17 | Reader and section drills; no test |
| 13, 15, 16 | Reader, drills, test; Chapter 16 also a per-word brief/write-out view |
| 18–21 | Reader with live strokes; drills *generated from the tables* (fingerspelling, numbers, punctuation, UK spellings) — my call, no practice files exist |
| 19, 22, 23 | Reader; mostly prose |
| 24–26 | Reader with live strokes; they depend on Plover extension dictionaries and are read-only in v1 |
| Appendices A–D, Glossary, Changes | Reader only. Appendix D is marked work-in-progress by the author. |

## 8. Technical choices (my calls; the owner delegated these)

- **Run:** `npm start` launches a small Node server (Node 26 is installed) and opens a Chromium or Brave tab. Fully offline. Electron and Tauri are rejected: Tauri's Linux webview has no WebHID.
- **Language / UI:** TypeScript; Preact with Vite; few dependencies.
- **Server:** plain Node, a handful of routes: serve the app, read and write archive data, files for journal and notes.
- **Tests:** Vitest on the chord reader, notation parser, scoring and the book parser. Real-hardware checks are done by the owner. A simulated device is allowed for tests only.
- **Repo:** git, local only, no remote. Location `~/lapwing-lab`.
- **Reference code:** steno-lessions (`steno-lessions-main`) is AGPL; read for ideas such as confidence per key and confusion tracking, never copied.

## 9. Order of work

- **M0 — Pipeline and shell.** Vendor the book; build the structured content; render every page of the book read-only with the live-stroke component (board drawing only, no device). *After M0, the whole book is already in the app.*
- **M1 — Stage 0.** Device connection, chord reader, board, Chapter 4 row drills and pseudo-word test, and the stroke-level archive from the first stroke.
- **M2 — The lab shell** (moved up at the owner's request). Top-bar tabs; free type; History; Days with streak; Journal with result-card notes; lazy logging so abandoned runs leave no ghost rows (3.5).
- **M3 — Core practice.** Section drills and chapter tests inline in the reader (Chapters 5 onward as lists exist), prompt-first drill screen, hint on miss, mistake diff, gates with override. They also appear on the Practice tab.
- **M4 — The dock.** Lookup over book data, key chart, briefs so far, notes; generated drills for table-only chapters.
- **M5 — Memory and lookup.** SRS; dictionary merge; full lookup with classification. *Amended by M5a (2026-10-28):* M5 is split. **M5a** (done): the dictionary lookup, per the M5a spec. **M5b:** briefs memory (SRS), designed later.
- **M6 — The record.** Heatmap, trend lines, month-end report, confusion pairs, plateau detection (the basic views are M2). *Amended by M6 (2026-10-28):* M6 is delivered in two steps. **M6a** (done): the Progress tab with its panels and the Rhythm view in Progress and in History. **M6b:** the plateau notice and the month-end report with the owner's notes. M5b (briefs memory) and M7 are unchanged.
- **M7 — The architecture around it.** Routine planner, session composer, ghosts, real-text practice.

## 10. Left to the builder
Parser design; board and stroke component internals; visual design within the stated direction; the exact database schema and stroke-event encoding; scoring formulas (wpm, accuracy) within 4.1; how stray output is swallowed; how confusion pairs are derived from missing and extra keys; keyboard shortcuts beyond those named.

## 11. Calls I made without the owner (please check)
1. Gate rule (book's accuracy + low end of its wpm range, always overridable), and completion-based gates for no-test chapters.
2. Briefs memory is opt-in per chapter, auto-enrolling at Chapter 16 (differs from the earlier "auto-enroll every brief").
3. Drills for Chapters 18–21 are generated from the book's tables.
4. Chapters 24–26 are read-only in v1.
5. The five dock items and their hotkeys.
6. No no-board mode in v1.
7. The whole tech list in §8, and the project folder `~/lapwing-lab`.
8. M0 renders the entire book before any practice exists.
9. Chapters without a test or drills unlock on "marked read" (4.1).
10. Greyed chapters are readable; only their practice is locked (3.1).

Added 2026-10-27 with the lab shell (3.5):
11. M2 jumps ahead of core practice; later milestones shift by one.
12. Free type draws only from taught words; its modes are 25/50 words and 30/60 seconds (item 24 adds a custom amount).
13. No formal "session" in the UI; notes are per day, added from result cards or the Journal tab.
14. The journal's auto-summary is shown live and never stored in the file.
15. "Time practiced" is first-to-last stroke per test (3.6); weeks start on Monday.
16. Opening a drill without a stroke writes nothing; leaving early closes the test marked abandoned.
17. Word-prompt hints default to on-miss; a Hint setting (`on miss` / `always`) lets the learner see needed keys from the start (owner request 2026-10-27, after trying M2).

Added 2026-10-27 with the M3 plan (4.1, "Settled for M3"):
18. A chapter test is 45 random words from the `N-test` list, each shown 3 times in a row (135 prompts), read from the book's own settings screenshot.
19. Stage 0 stays always open; chapters 1–3 only get a read tick and never block; the chain starts at Chapter 4.
20. Chapters 18+ clear by "marked read" until M4 adds their generated drills. (Done in M4: Chapters 18, 20 and 21 now have generated drills and the section-drill gate; only Chapter 19 and Chapters 22 and up still clear by marked read.)
21. The book's own practice links become the "Practice this section" rows (live links with word count and last result) instead of a separately inserted row; a panel at the top of each chapter page carries the gate.

Added 2026-10-27 at the owner's request, after trying M3 (4.1, "Skipping ahead"):
22. "Open anyway" marks every uncleared chapter from 4 up to the one before as "moved on anyway", so the chapter opens in one step; each mark can be undone on its own.
23. "Move on anyway" and "Open anyway" ask for confirmation in a dialog before writing; Cancel, Esc or a click outside writes nothing.
24. Free type also takes a custom number of words (1–500) or seconds (5–600), typed in a Custom box (owner request 2026-10-28); the timed wpm definition is unchanged.

Added 2026-10-28 with the M4 plan (3.3, "Settled for M4"):
25. Tools open as a drawer; bare `/`, `K`, `B`, `N` in the reader, `Alt+` those keys on drill screens, plus four top-bar buttons.
26. A drill pauses (strokes ignored, clock stopped) while a tool is open.
27. "Taught so far" = chapters up to the current chapter, with an `Include later chapters` checkbox.
28. Chapters 18, 20 and 21 get generated drills and clear by the section-drill gate.
29. Notes live in `data/notes/chNN.md` and reuse the journal's save queue.

Added 2026-10-28 with the M5a spec:
30. Calls C1 to C22 (vendored official dictionary, `Show more` by 30, file tags, raw Plover syntax, fingerspelling hint, sort order, the join rules between book labels and dictionary cards, named cards, `book only` rows) are listed in `specs/2026-10-28-lapwing-lab-m5a-dictionary-lookup-design.md`, §7 and §7a.

Added 2026-10-28 with the M6 spec:
31. Calls C1 to C18 (default mode and range, left-early runs, Monday weeks, rhythm definitions, small-data thresholds, plateau rule, the mode switch, words and weights, quarters, gaps, the chapter ladder, the Days-tab agreement) are listed in `specs/2026-10-28-lapwing-lab-m6-progress-design.md`, §8 and §8a; the rulings made while planning and building M6a are in its §8b. *Amended by M6 (2026-10-28):* M6 is delivered as M6a (the Progress tab) and M6b (plateau notice and month report).
