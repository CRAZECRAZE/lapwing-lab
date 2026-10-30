# Lapwing Lab

A private, offline, interactive version of the book *Lapwing for Beginners*, driven by your Uni v4. The whole book is readable in the app, its strokes light up on an on-screen board, and the Chapter 4 "Stage 0" drills, the section drills and chapter tests of the chapters after it, and free type run on your real keyboard and archive every stroke. Chapters ask to be cleared in order, and you can always override that. A history, a day calendar, a Progress page and a daily journal sit on top of that archive, and four quick-pull tools (lookup, key chart, briefs, notes) open beside whatever page you are on. It is not a replacement for Plover: it never sends strokes to Plover, never types text, and never touches Plover's config.

## Requirements

- **Node.** Built and tested on Node 26. It needs a Node that runs `.ts` files directly (there is no transpile step for the server or scripts) and has `node:sqlite`; I have not checked any other version.
- **A Chromium-based browser.** Chromium is what the app was built and tested against. The Uni is read over WebHID, which Firefox and Safari do not have. Brave has WebHID too but may need it enabled; that is untested. `http://127.0.0.1` counts as a secure context, so no HTTPS is needed.
- **The Uni on the Plover HID firmware.**
- **Linux device access.** The browser needs read access to the board's hidraw node. If **Connect** fails with a permission error, your udev rules must allow the logged-in user access to the board: the StenoKeyboards udev rule that Plover also needs.

## Quick start

```
npm install
npm start
```

`npm start` runs `npm run build` (rebuilds the book content and the client bundle), then the server, and prints:

```
Lapwing Lab running at http://127.0.0.1:5757
```

It also tries to open that address with `xdg-open`; if that is missing nothing happens. The server listens on `127.0.0.1` only.

- `PORT=5800 npm start` uses another port.
- `NO_OPEN=1 npm start` does not open a browser.

First use: open **Chapter 4**, click **Connect**, and choose the Uni in the browser's device picker.

## Turn Plover's Output off while practicing

Plover types translations into whatever window has focus. The drill and free-type screens swallow stray text, but turn Plover's **Output** off anyway while you practice here (the status line in the app reminds you).

Plover should be able to stay connected at the same time: on Linux, hidraw normally delivers every report to every program that has the device open. This has not been checked against a real board yet. If **Connect** fails while Plover is running, close Plover's machine connection and tell me.

## What is inside today

The top bar has six tabs: **Book · Practice · History · Days · Progress · Journal**, and four tool buttons: **Lookup · Key chart · Briefs · Notes** (see "The dock" below).

- **Book** is the reader for all 33 pages of the book (Home, chapters, appendices, Glossary, Changes), with the book's images and videos served locally. Strokes in the text light up the keys on a board when you hover, focus or click them. While a stroke is shown in the board panel, pressing it on the Uni shows a ✓; for a multi-stroke outline, press the strokes in order starting from the first.
- **Practice** has a **Where you are** panel (the chapter you are on, see below), **free type** and the Chapter 4 **Stage 0 drills**. Free type is a flowing line of words: 25 or 50 words, or 30 or 60 seconds, or choose **Custom** and type your own number of words (1 to 500) or seconds (5 to 600); Start stays off until the number is in range. A timed run starts counting on your first stroke. Stage 0 is six key-row drills (left bottom, right bottom, left top, right top, vowels, star), the 100-word layout test with the book's pass mark (90% accuracy within 10 minutes), and two extra practice lists. The board can be always visible, shown on hover, or hidden.
- **History** lists every test with accuracy and speed; open one to see its rhythm (see "Progress" below), its misses (what was required, what you pressed, which keys were missing or extra) and its slowest words.
- **Days** is a month calendar shaded by how long you practiced each day, with totals; pick a day to see its tests and its journal note. Your current streak of consecutive days is shown in the status line as well.
- **Progress** is the page that shows whether practice is working: speed and accuracy by day, how steady your typing is, how much you practice, which keys and mix-ups hold you back and how you stand against the book's chapter marks, with a Reports link to the month-end reports (see "Progress" and "Reports and the plateau notice" below).
- **Journal** is one markdown note per day, saved automatically as you type. A result card also has **Add a note**, which appends to today's note under a stamped heading.

Free type draws only on words the book has taught: the Chapter 4 pseudo-words, or the practice lists of Chapters 5 up to a chapter you pick (each chapter that has practice lists in the built content is offered as a source).

For the chapter word lists, the **Hint** setting chooses when the keys a word needs light up on the board and its stroke is written out: `on miss` (the default, after your first miss on a word) or `always` (from the start of every word). It is stored with the board setting in `data/settings.json` and is only shown for chapter word lists; the pseudo-words always show their target.

"Time practiced" is approximate: for each test it is the time from the first stroke to the last, so pauses inside a test count and time before the first stroke does not.

The full dictionary lookup and the Progress page (M6a) are done (see "The dictionary" and "Progress" below). The Progress page now has a plateau notice and a month-end report (M6b, see "Reports and the plateau notice" below). What remains is briefs memory (M5b) and the routine planner (M7); the order is in `docs/superpowers/specs/2026-10-27-lapwing-lab-design.md` section 9.

## Chapter practice and gates

Chapters 5 and up have practice lists, and the book ends most sections with a link to one. These are now live.

- **Chapter panel.** The top of every chapter page has a panel: its status (`Open`, `Locked until Chapter N is cleared`, or `Cleared` with how), what the chapter asks for, its drills with the last result of each, and the chapter test with your best and last result. Chapters 1–3, 19 and 22 and up have no drills, so their panel is the status, the requirement and the buttons. If progress cannot be loaded the panel says so, offers **Try again**, and nothing is locked.
- **Practice rows in the text.** A practice link that stands alone in its paragraph shows as a row with the list's word count (a chapter-test link says `45 words, 3 times each`) and your last result (`last 92% · 31 wpm`, or `not tried`, plus `locked` when the chapter is locked). A link inside a sentence stays inline but gets the same trailing text. The link opens the drill in the app; the link's own text is left as the book wrote it.
- **Section drills** (`/drill/list/<list>`). The whole list, shuffled, one prompt per word, on the same screen as the Stage 0 word drills. They are logged as mode `section`. Only in the chapters that clear by their drills (12, 14, 17, 18, 20 and 21) are they judged (at 90% accuracy); elsewhere they are practice and show no verdict.
- **Generated drills** (Chapters 18, 20 and 21). The book has no practice lists for these chapters, so the build makes six from the chapter text and lists them like any other: `18-lowercase` (26 letters, prompt `a`, stroke `A*`), `18-uppercase` (26 letters, prompt `A`), `18-numbers` (16 prompts: the digits in the Numbers table and the numbers listed under it), `20-punctuation` (28 marks, prompts such as `Comma (,)`), `20-commands` (11 commands) and `21-uk-spellings` (32 words). They run as section drills and are judged at 90%, and each chapter now clears when every one of its drills has been done once at 90% or better (the Chapter 18 panel lists three, Chapter 20 two, Chapter 21 one). They are regenerated by `npm run build:content`; if a table in the vendored book changes shape, the build stops with an error instead of making a wrong list. Because they are ordinary lists, the Free type sources from Chapter 18 up also draw on them.
- **Chapter tests** (`/drill/test/<chapter>`, for the chapters whose book page has a test list). 45 random words from the chapter's test list, each shown 3 times in a row, so 135 prompts (a list with fewer than 45 different words gives fewer). This is what the book's own test settings say. The hint follows the Hint setting, so by default it shows only after a miss. The result card says `Passed` or `Not yet`: passing needs the book's accuracy and at least the low end of the book's wpm range for that chapter (for example 90% and 10 wpm in Chapter 5, 90% and 5 wpm in Chapter 7). A score just below the pass mark is shown with one decimal (`89.6%`, `9.6 wpm`) so it never reads as a rounded number that reaches the mark beside `Not yet`. Once the chapter is cleared, the result card also shows a **Next chapter** link.
- **Gates.** Chapter 4's practice (Stage 0) is always open. Chapters 1–3 only get a read tick and never block anything. From Chapter 5 on, a chapter's practice opens once every chapter from 4 up to the one before it is cleared. Its page stays readable either way; only the drills and test are replaced by a notice with **Go to Chapter N** and **Open anyway**.
- **Cleared** means one of: the chapter test passed once (Chapter 4: the Stage 0 100-word test, 90% within 10 minutes); in Chapters 12, 14, 17, 18, 20 and 21, every section drill done once at 90% or better; the chapter marked read; or **Move on anyway**. Chapter 19 and Chapters 22 and up have no drills, so they clear by `Mark as read` (Chapters 1–3 too).
- **Buttons.** `Mark as read` (Chapters 1–3, 19 and 22+) and `Move on anyway` (any open chapter from 4 on that is not cleared; Chapters 1–3 only offer `Mark as read`) set a mark; `Undo` removes it. `Open anyway`, on a locked chapter or its notice, moves on from every chapter from 4 up to the one before that is not cleared, so the chapter opens in one step; each of those then shows `Cleared · moved on anyway` and keeps its own `Undo`. `Move on anyway` and `Open anyway` first ask "Are you sure?" in a small dialog that names the chapters it will mark; `Cancel`, Esc or a click outside it writes nothing. `Mark as read` and `Undo` act at once. A run left early (Exit or Esc) never counts towards anything, and a `Not yet` run clears nothing.
- **Elsewhere.** The chapter list marks a cleared chapter with `✓` and greys a locked one (still a link). Practice's **Where you are** panel shows the first chapter from 4 on that is not cleared (the last chapter once every one is), with its panel and a link to its page.

Progress is not stored as its own state. It is worked out from the runs in the archive (each run records whether it passed) plus the few marks you set, and `data/steno.db` is the only place it lives. Deleting a mark, or the database, changes what is cleared.

Known limits: Chapter 19 and Chapters 22 and up have no drills or tests; and the gates, tests and the dock have not been tried on the real board yet (see `docs/superpowers/m3-checklist.md`, `docs/superpowers/m4-checklist.md` and, for Lookup, `docs/superpowers/m5a-checklist.md`).

## The dock

Four quick-pull tools open as a drawer over the right-hand side of the page, below the top bar. Only one is open at a time.

| Tool | Reader | On drill screens | Top-bar button |
| --- | --- | --- | --- |
| Lookup | `/` | `Alt+/` | **Lookup** |
| Key chart | `K` | `Alt+K` | **Key chart** |
| Briefs so far | `B` | `Alt+B` | **Briefs** |
| My notes | `N` | `Alt+N` | **Notes** |

- **Keys.** In the reader the bare keys work whenever the focus is not in a text field (`K`, `B` and `N` with Shift or Caps Lock too; `/` must be the plain key). The `Alt` forms work from anywhere, including while typing in a box, and go by the physical key, so `Alt+/` is the key that is `/` on a US layout. On drill screens (Stage 0, section drills, chapter tests, free type) only the `Alt` forms work, because the board's stray output would otherwise open tools. Pressing a tool's key again, or its top-bar button, closes it; pressing another tool's key switches to that tool. The buttons work on every tab. A bare `/` needs a layout where `/` is typed without Shift; if yours is not, use `Alt+/` or the button.
- **Esc** closes the drawer and nothing else: in a drill, the first Esc closes the tool and you stay in the drill; the next one exits the drill as before. The dock keys do nothing while an "Are you sure?" dialog is open.
- **A drill pauses while a tool is open.** Strokes are ignored and the clock stops, as when the board is unplugged (with the board connected, the drill says `Paused while a tool is open`). Closing the tool puts the focus back in the drill.
- **Lookup** searches the whole official Lapwing dictionary, with no chapter limit (see "The dictionary" below). Type a word (`cat`) and it lists every way to write it, one outline under another, shortest first; type an outline in capitals (`TKAD`, or just the start of one, `TK`) and it lists what that writes. Results are cards, 30 at a time with a **Show more** button, and the count line says how many matched in total. Where the book teaches an outline, the row says which chapter (`Chapter 5`) and what kind of mention it is (practice list, brief, example). Hover or focus an outline to see it on a board (the first row's first stroke shows until you pick another); the board stays in view at the top of the drawer while the results scroll.
- **Key chart** shows the board and, for each key, the sounds the book teaches for it (the Chapter 5 consonant table and the vowel sections), with examples. Hover or focus a key's row to light it on the board. It shows all keys at once, whatever chapter you are on.
- **Briefs so far** lists the book's brief tables grouped by chapter, limited to the chapters up to your current one (the first not cleared, never earlier than 4) unless you tick **Include later chapters**. A filter box matches the translation, an outline or the explanation.
- **My notes** is one note per chapter (1 to 26), picked with the Chapter list at the top (a chapter that has text says `has notes`). It opens on the chapter you picked last, or else your current one, and saves as you type. If a note cannot be loaded it says so and offers **Try again**, and it never saves over what it could not read. If a save fails it says `Not saved — will retry`.

Notes live in `data/notes/chNN.md` (for example `ch05.md`), plain markdown, one file per chapter, written the first time you type in one. They are part of `data/`, so back them up by copying `data/`.

Known limit: stray Space or Enter from the board's Plover output can press a focused drawer control, such as **Close**, while the drawer has the focus; the drill's own key catcher is not focused while a tool is open. Turn Plover's Output off while you practice (see above).

## The dictionary

Lookup reads one generated file, `content/build/dictionary.json`: about 58,000 cards and 5.2 MB (5,222,722 bytes in the last build; the build stops if it grows past 8 MB). The app fetches it the first time you open Lookup (the box shows `Loading…` for a moment, and `Couldn't load the dictionary.` with **Try again** if it fails) and keeps it for the rest of the session. The reader and the drill screens never fetch it, so start-up does not pay for it.

- **Where it comes from.** The official Lapwing dictionary, `https://github.com/aerickt/plover-lapwing-aio` (MIT), vendored read-only in `content/lapwing-dictionary/` at the commit in `content/lapwing-dictionary/PINNED_COMMIT` (`4ac5d53cf039a2b1f4c484456663c85e7df4e859`) with its `LICENSE` and a `SOURCE.md`. Six files are used: `lapwing-base.json`, `lapwing-uk-additions.json`, `lapwing-proper-nouns.json`, `lapwing-numbers.json`, `lapwing-commands.json` and `lapwing-semi-modal-movement.json`: the ones the book's Appendix C lists for the Plover set-up. The two modifier dictionaries, the Javelin-only files and `lapwing-prefixed-proper-nouns.json` are not used.
- **Updating it.** `npm run sync:dictionary` re-vendors the pinned commit; `npm run sync:dictionary -- <40-hex commit>` takes another one (anything but a full 40-character hash is refused). It needs the network. Then run `npm run build:content` (or `npm start`) to rebuild `dictionary.json`. Do not edit the vendored files by hand. The tests never touch the network.
- **Every outline, in order.** A card is one exact translation (`defense` and `Defense` are two cards) and lists all its outlines, fewest strokes first, then fewest keys pressed, then alphabetical. For example `especially` shows `EPS`, `ES/PERB/HREU` and `ES/PERBL/KWREU`. Lookup does not pick one as the right way, rank by taste or hide anything because its chapter is ahead.
- **Searching.** The match ignores case. A word matches translations: the exact word first, then those that start with it, then those that contain it. A query in capitals made of steno letters (`TKAD`) searches outlines first, exact, then starting with it, then at a stroke start (`TK` finds `TKAT` and `-T/TKAT`, not `-T/KAT`), and then words; the rows that matched are marked with a bar at their left edge. Lower-case `tkad` is a word search and finds only words.
- **Book labels.** A row carries `Chapter N` and `practice list`, `brief` or `example` only where the book itself states that outline for that word, and nothing else: the label never comes from a guess and never lands on a different translation that merely shares the outline. The labels are worked out when the content is built and are part of `dictionary.json`.
- **Tags.** A row from a file other than the main one carries a small tag naming it: `UK`, `names`, `numbers`, `commands` or `movement`. A pair in several files shows each tag.
- **`book only`.** If the book teaches an outline for a word that the dictionary does not hold for that word, the row is shown anyway and marked `book only`. When the dictionary writes that outline some other way, the row adds a muted line, "The dictionary writes this outline as:" with those translations.
- **Plover syntax.** Entries such as `{^}.sh` or `{#Shift_l(Home)}` are shown exactly as stored, in monospace (a real newline shows as `\n`), so nothing is lost.
- **`from the book`.** The book names keys, symbols and commands (`Enter`, `Comma (,)`, `Period (.)`, the letters and digits of Chapter 18) that are not dictionary words. Each is its own card marked `from the book`, with the book's outline and chapter and the same "The dictionary writes this outline as:" line (`not in the dictionary` when there is none). So searching `enter` or `comma` finds the book's entry too.
- **Not found.** `Not in the dictionary.` For a query that is one run of lower-case letters, up to 40, a muted line `Fingerspell it:` follows with the strokes of its letters from Chapter 18 (`qzxv` gives `KW*`, `STKPW*`, `KP*`, `SR*`). A longer query shows only the first line.
- **What it does not do.** It never reads your own Plover dictionaries, on purpose, so your habits are not echoed back. It never writes anything (nothing in `data/`). It uses no network at run time: the only fetch is of `/content/dictionary.json` from the local server. It does not label outlines as brief or write-out.
- **Known limits.** The Briefs tool still shows only the chapters taught so far (its own **Include later chapters** box); `thirst`'s outline `TH*EURS`, which the book gives as an "Also" sub-bullet, has no chapter label. Both are listed in `docs/superpowers/m0-m1-followups.md`. The design is in `docs/superpowers/specs/2026-10-28-lapwing-lab-m5a-dictionary-lookup-design.md`.

## Progress

The **Progress** tab (the fifth in the top bar, or `/progress`) draws your existing history as panels. It needs no setup and nothing new is recorded: it works from the tests and strokes already in `data/steno.db`, the same ones History and Days read, and the panels write nothing (they create no file in `data/`, and on a fresh install the page shows `No practice recorded yet.`; the snooze and opening a finished month's report, described in the next section, are the only exceptions; the banner itself writes nothing). Reloading gives the same numbers.

**The two switches** sit at the top.

- **Range**: `4 weeks` (the default), `3 months` or `All time` (up to 1,100 days back). It changes the day charts (wpm by day, accuracy and consistency), the weekly bars, and the weakest keys and mix-ups, which say which period they cover.
- **Mode**: `Free type` (the default), `Drills and tests` (Stage 0, section drills and chapter tests) or `Everything`. It changes only the panels about speed and quality: the two speed and accuracy tiles, wpm by day, accuracy and consistency, and the Rhythm panel. The time and strokes tiles, the weekly bars, the weakest keys, the mix-ups and the heatmap always use every mode (their titles say `all modes`), and the chapter ladder ignores the switch and always shows chapter tests (Chapter 4's Stage 0 test counts as its test).

**The panels**, top to bottom:

- **Tiles.** This week's practice time and strokes (Monday to today, with all-time strokes under it), and the speed and first-try accuracy of the last 7 days. Each shows its change against the period before (last week, or the 7 days before) only when both periods have data.
- **Wpm by day.** One dot per day you finished runs: that day's average wpm, weighted by words. A dashed line is the 7-day average of the daily values (each day counts once, so it can differ a little from the tile, which is weighted by words); it appears from 3 days with data. The axis starts at 0, and the best day is named above.
- **Accuracy and consistency.** A line of first-try accuracy per day (the axis runs from 80% when every day is at 80% or better, and says so under the chart) and a bar per day for steadiness, the middle one of that day's runs. A shaded band shows the lowest to highest steadiness over the last 14 days, once at least 5 of them have a score.
- **Rhythm.** How steadily you type inside one run (below). It shows the newest finished run of the mode, with a picker for the 20 latest and **Open this run in History**; the same section is on the detail page of every finished run in History (a run left early or never finished says `Rhythm is shown for finished runs.`).
- **Practice time per week.** Bars of time practiced each Monday-to-Sunday week, the strokes under each bar, and the current week lighter as `so far`. With `All time` the bars start at the first week you practiced.
- **Weakest keys.** The board with each key shaded by how often it was missed when it was needed, and the worst five in words. The shade is on a fixed scale: a key missed in 25% of its presses or more is fully red, so a calm board means few misses (it is not relative to your worst key). A key needs 30 presses to be ranked.
- **Mix-ups.** Pairs where you pressed one wrong key in place of the one you needed (`-P instead of -B`), at most eight, most often first. A pair needs 3 occurrences.
- **Chapter tests.** For each chapter with a test, your best result against the book's pass mark, `met` or `not yet` (with what it falls short of), or `not tried yet`. A row is `met` when any run passed, as the app clears the chapter; when your most accurate run is below the mark but another run passed, the row also says `passed on another run`.
- **Practice, all modes.** A grid of the last 52 weeks (365 days), one square per day, shaded by practice time with the same steps as the Days tab (under 10 minutes, under 30, more), with your current and longest streak (counted within that year).

**Where each number comes from.**

- A **day** is the local date of the first stroke of a run, as on the Days tab; **weeks start on Monday**.
- **Time practiced and strokes** count every run that has strokes, including runs you left early and runs whose tab was closed, so they agree with the Days tab. Time is first stroke to last stroke of each run, summed, as in "Time practiced" above.
- **Wpm, accuracy and steadiness** use finished runs only. A run you left early is not counted, and a timed run that ran out the clock is. The wpm and accuracy of a run are the ones History shows; a day's figure is their average weighted by the words each run completed. Accuracy is first-try accuracy, shown with one decimal on the tile.
- The **weakest keys** and **mix-ups** come from the strokes of every run, early or not.

**Rhythm, in plain words.** The strokes of a run are timed against each other.

- A **gap** is the time between one stroke and the one before it (a missed stroke and its retry are two gaps). The first bar is the **start**: the time from the word appearing to your first key. It is drawn, timed in the note under the strip (`Started after 3.2 s`) and named `start` in the bar's hover or focus note and in the `Show the numbers` table (the strip itself prints only `break`), but never counts as a stall or a break and is left out of the typical gap and the steadiness.
- A pause over 10 seconds is a **break** (you stepped away): it is drawn as a dotted line marked `break` and left out of every score. That includes a long pause before the first showing of a word in a chapter test: it is a break, not a `first showing`.
- The **typical gap** is the middle one of the run's gaps. A **stall** is a gap more than 2.5 times the typical gap and over 1 second (a red bar).
- **Steadiness**, 0 to 100, is how evenly the gaps fall around the typical gap: 100 means every gap alike, and a run that keeps swinging between quick and slow scores lower. It looks at the middle half of the gaps, so one stall barely changes it. A run with fewer than 10 scored strokes gets no score.
- **Chapter tests** are scored on the second and third showing of each word. A chapter test shows each word three times in a row and the first showing includes reading time, so those strokes are drawn as paler dashed bars labelled `first showing` and are left out of the typical gap, the stalls and the steadiness (they still count towards the run's wpm and the quarters). A chapter test's steadiness is labelled `repeats only`, and under Accuracy and consistency, in `Drills and tests` and `Everything`, a line says `Chapter tests count their repeats only.` The per-day steadiness uses the same rules, so the steadiness of past days (the bars and the 14-day band) may change slightly after this update; nothing stored is changed.
- **Start vs finish** and the speed in each of the four quarters are **estimates**. A quarter is a quarter of the run's active time (breaks left out); the run's words are shared across the quarters in proportion to the correct strokes in each, divided by that quarter's minutes. The whole run's wpm is shown beside them, as counted by the app.
- The strip has one bar per stroke. A run of more than 300 strokes is drawn wider than the page and scrolls sideways inside its own box; the seconds axis stays in view.

**Being honest with small amounts of data.** A speed, accuracy or steadiness figure that rests on fewer than 3 runs shows a dash and `not enough data yet`. A key needs 30 presses to be ranked and a mix-up needs 3 occurrences. The plateau notice and the month report are described in the next section.

**A limit.** The archive does not record which stroke of a multi-stroke word you were attempting, so for those words a miss is matched to the closest stroke of any of the word's outlines (the page says so under Weakest keys). That is right for nearly all misses, but a wrong stroke can be blamed on the wrong stroke of the word, and retyping the previous stroke where a later one was needed is not seen as a miss on that key.

**Keyboard.** Each chart is one tab stop: Tab reaches it, Left and Right move between its dots and bars, and Home and End go to the first and last. In the heatmap Left and Right move a week, Up and Down a day. Under every chart a **Show the numbers** disclosure holds the same figures as a table.

**How it is built.** The page asks the local server for `GET /api/stats?from=&to=&mode=` (mode `free`, `drills` or `all`; read-only; the strokes are summed on the server and only totals leave it) and for `GET /api/days`, which both accept a span of up to 1,100 days. Neither creates `data/` if there is no archive. The notice and the banner also read `GET /api/settings`, and the report notes use `GET /api/reports` (the months that have a note) and `GET`/`PUT /api/reports/:month`. The charts are drawn as SVG, with no charting library. The design is in `docs/superpowers/specs/2026-10-28-lapwing-lab-m6-progress-design.md`; `docs/superpowers/m6a-checklist.md` lists what to check against your real history.

## Reports and the plateau notice

Two quiet extras sit around the Progress page. Neither nags, sets a goal or tells you what to practice.

**The month-end report.** Click **Reports** on the Progress page (or open `/progress/reports`) for a list of months, newest first. A month is listed when it has practice or a note (whitespace-only notes are ignored); months in between with neither are left out, and the list runs from the earliest such month to the current one. Each row shows the month, the practice time, the strokes and a `note` mark if you wrote one. A row opens `/progress/reports/YYYY-MM`, which is still the Progress tab. A report shows:

- a header with the month and the days you practiced (`October 2026 · 6 practice days`);
- six tiles: practice time, strokes, free-type wpm, accuracy, steadiness and chapters passed. Time and strokes cover every mode; speed, accuracy and steadiness cover free type (a line says so). Under a tile is the change against the month before when both months have data, in the plain colour whether better or worse. In your first month there is nothing to compare with, so the speed and accuracy tiles show `first day 22, last day 41` instead. A tile resting on fewer than 3 free-type runs shows a dash and `not enough runs yet`;
- chapters passed: the chapters you first passed in that month, each with its day (`ch 4 on the 30th`), found from the first run that met the chapter's pass mark or the date of a read or override mark. A chapter the ladder only counts as cleared by its best-result rule, with no passing run and no mark, has no date and is counted in no month;
- the wpm-by-day chart for the month, with **Show the numbers**;
- a box, **Your notes**.

The numbers are never stored: they are recomputed from your archive every time you open a report.

**Your notes.** The box saves by itself a moment after you stop typing (it says `Saved`). Each month's note is the plain UTF-8 text file `data/reports/YYYY-MM.md` (for example `data/reports/2026-10.md`). It is not rendered, so you can read or edit it in any text editor; an edit made there shows the next time you open the report. The folder is created when you first save a note; opening a report writes no file for the note.

**The month-end banner.** On the last day of a month, or any later day, Progress shows `October is done. Your report is ready.` as a link, when that month had practice and you have not opened its report. Opening the report of a finished month remembers it (as `reportSeen` in `data/settings.json`) and the line goes away. It only moves forward: opening an older month never brings an earlier banner back, and opening the current month before its last day remembers nothing. The line never shows for a month before its last day.

**The plateau notice.** It looks at your free-type wpm over the last 56 days, cut into eight weeks of 7 days ending today. A week counts when it has at least 2 free-type runs, and its speed is the average of those runs weighted by words. Counting back from this week, a week is part of the plateau when its speed is within 2 wpm (or 4% of this week's speed, whichever is more) of this week's. A week without 2 free-type runs, such as a week off, is skipped: it neither counts nor ends the plateau. A week outside the tolerance ends it. When 3 or more weeks are in the plateau, the notice says `Your speed has been flat for N weeks`, gives this week's wpm and up to two earlier ones, and adds `Plateaus like this are common while learning steno.` A `Meanwhile` line appears only for a figure that rose over the plateau (steadiness by at least 3 points, accuracy by at least 1.5 points); it never mentions anything that got worse. It links to the `Weakest keys` and `Mix-ups` panels and gives no advice. So it cannot appear before about three weeks of regular free-type practice. It ignores the Progress page's Mode and Range switches.

It shows above the tiles on the Progress page, and as one small gold line (`Speed flat for 3 weeks, see Progress`) in the chapter panel: on the Book's chapter pages and in `Where you are` on the Practice tab (not on the Book's home page or the appendices). **Not now (14 days)**, on the Progress page, hides it everywhere until 14 days later; it also stops by itself when the plateau ends. If the numbers cannot be loaded, the notice and the banner are simply not shown.

**What is written to `data/`.** Only `data/reports/YYYY-MM.md` (your notes) and two fields in `data/settings.json`: `plateauSnoozedUntil` (a date, from **Not now**) and `reportSeen` (a month, from opening a finished month's report). Opening Progress, the reports list or a report creates no file, apart from `reportSeen` when you open a finished month's report. Nothing in `steno.db` changes. The design is in `docs/superpowers/specs/2026-10-30-lapwing-lab-m6b-reports-design.md`; `docs/superpowers/m6b-checklist.md` lists what to check against your real history.

## Your data

Everything the app writes lives in `data/`:

- `steno.db`, a SQLite database (tables `sessions`, `tests`, `strokes`, and `progress_marks`, which holds only your read and override marks, one row per chapter)
- `settings.json`, your settings: the board and hint choices, plus `plateauSnoozedUntil` (the date the plateau notice is snoozed until) and `reportSeen` (the last finished month whose report you opened)
- `journal/YYYY-MM-DD.md`, your notes: plain markdown, one file per local day
- `notes/chNN.md`, your notes per chapter from the My notes tool: plain markdown, one file per chapter (1 to 26)
- `reports/YYYY-MM.md`, your notes in the month-end reports: plain text, one file per month

Each is created on first save (the journal folder when you first write a journal note, the notes folder when you first type in My notes, the reports folder when you first type a report note), so `data/` does not exist until you first use a drill or change a setting, and on a fresh install merely opening a tab writes nothing. The first start after upgrading from an earlier version adds the empty `progress_marks` table to an existing `steno.db` in place (your tests and strokes are not changed), so copy `data/` first if you want a backup. Back up by copying the whole `data/` folder. It is git-ignored on purpose.

Opening a drill and leaving without a stroke writes nothing. Leaving a drill early (Exit or Esc) keeps the strokes you already did and closes the test as left early: it shows in History as "Left early" with the partial numbers. A run left early is never shown as the last result on the Chapter 4 panel or the Practice tab. A test whose `ended_at` is still empty means the browser tab was closed mid-drill.

The Journal has one limit: if two browser tabs edit the same day's note, the last save wins and can overwrite the other tab's text.

Peek at your strokes (run from the repo root):

```
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/steno.db');console.log(d.prepare('select count(*) n from strokes').get())"

sqlite3 data/steno.db "select t.mode, t.accuracy, s.prompt, s.pressed_levers_json, s.correct, s.latency_ms from strokes s join tests t on t.id = s.test_id order by s.id desc limit 20"
```

The second one needs the `sqlite3` CLI.

## Developing

```
npm test                # vitest
npm run typecheck       # tsc --noEmit
npm run dev             # API server (port 5757) + Vite dev server with hot reload
npm run build:content   # regenerate content/build from the vendored book and dictionary
npm run sync:book       # re-vendor the book at the pinned commit (needs network)
npm run sync:dictionary # re-vendor the dictionary at the pinned commit, or a given one (needs network)
```

`npm run dev` (leave `PORT` unset; the Vite proxy is fixed to 5757) prints the Vite address to open; Vite proxies `/api`, `/content` and `/media` to the server on 5757. `npm run sync:book` is only for re-vendoring the pinned book commit; you do not need it for normal use; the same goes for `npm run sync:dictionary`.

```
content/lapwing-book/   vendored book (generated; do not edit)
content/lapwing-dictionary/   vendored official Lapwing dictionary (generated; do not edit)
content/build/          generated pages and word lists (git-ignored)
scripts/                content pipeline and dev runner
server/                 HTTP server, SQLite archive, journal and chapter notes files, settings
src/                    client: reader, board, drills, chapter tests and gates, free type, history, days, progress, journal, the dock tools, WebHID input
tests/                  vitest suites
docs/superpowers/       specs/ and plans/
data/                   your data (git-ignored)
dist/                   client build (git-ignored)
```

## License

The vendored book content under `content/lapwing-book` is *Lapwing for Beginners* from `aerickt/lapwing-for-beginners`, licensed GPL-3.0, at the commit pinned in `content/lapwing-book/PINNED_COMMIT`. That is fine for a private repo; the GPL applies to content derived from it if this is ever published.

`steno-lessions` (AGPL) was used as reference only; no code from it is used. The vendored dictionary under `content/lapwing-dictionary` is the Lapwing dictionary from `aerickt/plover-lapwing-aio`, licensed MIT (the licence is in that folder), at the commit pinned in `content/lapwing-dictionary/PINNED_COMMIT`.
