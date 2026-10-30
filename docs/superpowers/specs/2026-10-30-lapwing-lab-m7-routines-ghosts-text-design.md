# Lapwing Lab M7: ghosts, real text, routines — design

The last milestone. Three parts, built in this order, each usable on its own: **A. Ghosts of past runs**, **B. Real-text practice**, **C. A routine planner**.

The owner asked for "all of it" and then left the machine, so the questions step was skipped. Every decision below that the owner did not make is marked **(my call)** and is repeated in the hand-back message so it can be changed.

## Why

- Drills now show how well a run went, but not how it compares with *you*. A ghost makes the last good run something to race, without a timer or a leaderboard.
- Every drill so far uses the book's own word lists. Real text (an article, an email, a chapter of something the owner reads) is what steno is for, and shows which real words the owner can already stroke.
- Practice is scattered: free type here, section drills there, fix-up elsewhere. A routine is the owner's own plan of "today's practice", with ticks that come from what was really done.

## Goals, non-goals, anti-goals

- Goals: all three parts work offline, on top of the existing archive; they follow the existing look and the "total control, everything shown" habit (a picker for the ghost, nothing hidden).
- Non-goals: no scheduling by weekday or clock, no reminders, no streak counters, no sharing, no text import from files or URLs (paste only), no translation of text the dictionary cannot stroke (those words are listed and skipped), no change to the theory or the chapter gates.
- Anti-goals: no scolding or advice copy anywhere; no wpm or accuracy figure invented for runs that have none; nothing from `data/` is ever committed; real text and routines are the owner's private files.

## Part A — Ghosts

A **ghost** is the pace of an earlier run of the same drill: the times, counted from its first stroke, at which it completed each word.

- Where it appears: runs that log a `section` and are not fix-up runs: free type, section list drills, chapter tests, Stage 0 drills, real-text runs. Never in a fix-up run (it has no pace).
- Which earlier run **(my call)**: among the 30 most recent finished runs of the same `mode` + `section` with at least 5 completed words, **Best** is the one with the highest wpm and **Last** is the most recent. A picker "Ghost: best / last / off" sits with the other pickers; the choice is saved in settings; the default is **best**.
- During a run: one quiet line above the prompt, `Ghost (best, 3 days ago) 14 · You 12`, and two thin tracks (ghost, you) scaled to the larger of the item count and the ghost's total. It advances with the session clock (so it stops while the dock or an unplugged board pauses the drill). It starts moving at the owner's first stroke. No sound, no colour that means "bad", nothing announced to screen readers continuously (the text line is not a live region).
- After a run, the result card gets one neutral line: `Best run (3 days ago) had 22 words by 0:41. You: 25 — 3 ahead.` (or `3 behind`, or `level`).
- No ghost when there is no earlier qualifying run, when the choice is off, or when the ghost cannot be loaded: then nothing is shown and the drill is unchanged.
- A ghost's timeline is made from the archived strokes of that run by the same replay the fix-up drill uses, so it needs no new stored data. Pauses inside the old run are inside its wall-clock times **(my call, accepted inaccuracy; recorded in the follow-ups)**.

## Part B — Real-text practice

- Entry: Practice tab card "Real text" → page `/practice/text`.
- The page has a text box to paste into, an optional name, a **Check** that shows coverage, **Save**, and the list of saved texts (open, delete with a confirmation).
- **Coverage** is shown before any drill: `212 of 230 words can be stroked (92%)`, a count of numbers/symbols skipped, and the words that are not in the dictionary with how many times each occurs (the first 20 by count). Those words are skipped in the drill **(my call)**; nothing is guessed or fingerspelled.
- Matching **(my call)**: a word is the text between whitespace with surrounding punctuation removed (inner apostrophes and hyphens stay; curly apostrophes count as straight). It is looked up exactly as written first, then in lower case, in the generated dictionary (Lookup's file; named key/command cards never match). A hyphenated word with no entry is tried as its parts. Tokens with no letter in them (numbers, symbols) are skipped and counted. Every outline of the matched card is accepted, in the card's display order.
- The drill runs the words **in the order of the text** (not shuffled), in the flow view, in **parts of 100 words (my call)**; a text of 230 words has parts 1–3; the page and the result card say "Part 2 of 3". The run is a `text` test: `chapter` null, `section` = `text/<id>/<part>` (`<id>` is `pasted` for unsaved text), counted in time, strokes, key stats and the `all` speed figures, not in the `free` or `drills` filters.
- A pasted text that is not saved stays in memory only; reloading the page loses it (the page then asks to paste again). A saved text lives in `data/texts/<id>.json` as `{name, text}`; at most 50 texts, at most 200,000 characters each, names 1–60 characters.
- The result card shows accuracy, speed, words, time, the ghost line, a note box, and `Next part` (when there is one), `Again`, `Back to text`.
- History, Days and the test detail label these runs `Text · <name or id> · part N`.

## Part C — Routines

A **routine** is an ordered list of steps; the owner makes as many as eight and marks one **active**. A step is one of:

| Step | Starts | Counts as done today when |
|---|---|---|
| Section drill (a list id such as `05-…`) | `/drill/list/<id>` | a finished `section` test with that section exists today |
| Free type (source + mode) | `/practice/free/<source>/<mode>` | a finished `free` test with that section exists today |
| Fix-up (words or patterns) | `/practice/fixup` or `/practice/fixup/patterns` | a finished `fixup` test of that kind exists today |
| Real text (saved text + part) | `/practice/text/run/<id>/<part>` | a finished `text` test with that section exists today |

- "Today" is the local calendar date. Ticks come only from the archive; they are not stored, so a routine that was done earlier shows unticked tomorrow, and a step done outside the routine page still ticks.
- The routine page `/practice/routine` shows the active routine as a checklist: each step's text, a tick or "next up", `2 of 4 done today`, and a **Start** link on the first undone step (every undone step has its own link). Below it is the planner: the owner's routines with **Make active**, **Edit**, **Delete** (confirmed), and **New routine**.
- The editor: a name (1–40 characters), the steps with move up / move down / remove, and an "Add a step" form (kind, then that kind's choices: the section lists of chapters the owner has reached, the free-type sources and modes the Practice tab offers, words or patterns, a saved text and part number). **Save** writes the whole set; **Cancel** drops the edit. Up to 12 steps per routine.
- A Practice-tab card "Routine" shows the active routine's name, `N of M done today`, and a link to the page; with no routine it says there is none and links to the planner.
- Steps reached from the routine page carry `?from=routine`; the list-drill, free-type and text hosts then say "Back to routine" and go to `/practice/routine`. The page ticks are fresh when it is shown again.
- Stored in `data/routines.json` as `{routines: [{id, name, steps}], active}`. A missing, unreadable or invalid file means no routines. Deleting the active routine leaves no routine active **(my call)**.

## Constraints

- Offline, 127.0.0.1 only, Node 26, existing stack. No new dependencies.
- `data/` is the owner's: tests use temp directories; agents never read or write the real one.
- Copy never scolds or advises; no new wpm shown for runs that have no speed.
- Server validation happens before any file access (ids are checked against a pattern first).
- A drill started from any new route is unchanged in how it logs strokes and tests.

## What is left to the builder

Exact names, layout and CSS (follow `fixup.css`/`practice.css` conventions), how the picker control for the ghost looks (mirror `HintPicker`), test structure.

## Left out on purpose (for the follow-ups file)

Weekday scheduling and reminders; importing text from files; re-ranking ghosts by length; editing a saved text in place (delete and save again); a stored "done" state for steps.
