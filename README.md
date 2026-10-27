# Lapwing Lab

A private, offline, interactive version of the book *Lapwing for Beginners*, driven by your Uni v4. The whole book is readable in the app, its strokes light up on an on-screen board, and the Chapter 4 "Stage 0" drills, the section drills and chapter tests of the chapters after it, and free type run on your real keyboard and archive every stroke. Chapters ask to be cleared in order, and you can always override that. A history, a day calendar and a daily journal sit on top of that archive, and four quick-pull tools (lookup, key chart, briefs, notes) open beside whatever page you are on. It is not a replacement for Plover: it never sends strokes to Plover, never types text, and never touches Plover's config.

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

The top bar has five tabs: **Book · Practice · History · Days · Journal**, and four tool buttons: **Lookup · Key chart · Briefs · Notes** (see "The dock" below).

- **Book** is the reader for all 33 pages of the book (Home, chapters, appendices, Glossary, Changes), with the book's images and videos served locally. Strokes in the text light up the keys on a board when you hover, focus or click them. While a stroke is shown in the board panel, pressing it on the Uni shows a ✓; for a multi-stroke outline, press the strokes in order starting from the first.
- **Practice** has a **Where you are** panel (the chapter you are on, see below), **free type** and the Chapter 4 **Stage 0 drills**. Free type is a flowing line of words: 25 or 50 words, or 30 or 60 seconds, or choose **Custom** and type your own number of words (1 to 500) or seconds (5 to 600); Start stays off until the number is in range. A timed run starts counting on your first stroke. Stage 0 is six key-row drills (left bottom, right bottom, left top, right top, vowels, star), the 100-word layout test with the book's pass mark (90% accuracy within 10 minutes), and two extra practice lists. The board can be always visible, shown on hover, or hidden.
- **History** lists every test with accuracy and speed; open one to see its misses (what was required, what you pressed, which keys were missing or extra) and its slowest words.
- **Days** is a month calendar shaded by how long you practiced each day, with totals; pick a day to see its tests and its journal note. Your current streak of consecutive days is shown in the status line as well.
- **Journal** is one markdown note per day, saved automatically as you type. A result card also has **Add a note**, which appends to today's note under a stamped heading.

Free type draws only on words the book has taught: the Chapter 4 pseudo-words, or the practice lists of Chapters 5 up to a chapter you pick (each chapter that has practice lists in the built content is offered as a source).

For the chapter word lists, the **Hint** setting chooses when the keys a word needs light up on the board and its stroke is written out: `on miss` (the default, after your first miss on a word) or `always` (from the start of every word). It is stored with the board setting in `data/settings.json` and is only shown for chapter word lists; the pseudo-words always show their target.

"Time practiced" is approximate: for each test it is the time from the first stroke to the last, so pauses inside a test count and time before the first stroke does not.

The order of the remaining work (briefs memory and the full dictionary lookup, reports, routines) is in `docs/superpowers/specs/2026-10-27-lapwing-lab-design.md` section 9.

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

Known limits: Chapter 19 and Chapters 22 and up have no drills or tests; and the gates, tests and the dock have not been tried on the real board yet (see `docs/superpowers/m3-checklist.md` and `docs/superpowers/m4-checklist.md`).

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
- **Lookup** finds words and strokes. Type a word (`cat`) or an outline in capitals (`TKAD`, also a start of one, `TK`), and it lists up to 30 words; each hit says which chapter teaches it (`Chapter 5`) and where it comes from (practice list, brief, example). Hover or focus an outline to see it on a board (the first hit's first stroke shows until you pick another). It searches only what is taught so far, meaning the chapters up to your current one (the first not cleared, never earlier than 4). The **Include later chapters** box adds the rest, and those hits are marked `later in the book`. The box only appears while your current chapter is before the last one.
- **Key chart** shows the board and, for each key, the sounds the book teaches for it (the Chapter 5 consonant table and the vowel sections), with examples. Hover or focus a key's row to light it on the board. It shows all keys at once, whatever chapter you are on.
- **Briefs so far** lists the book's brief tables grouped by chapter, with the same **Include later chapters** box, and a filter that matches the translation, an outline or the explanation.
- **My notes** is one note per chapter (1 to 26), picked with the Chapter list at the top (a chapter that has text says `has notes`). It opens on the chapter you picked last, or else your current one, and saves as you type. If a note cannot be loaded it says so and offers **Try again**, and it never saves over what it could not read. If a save fails it says `Not saved — will retry`.

Notes live in `data/notes/chNN.md` (for example `ch05.md`), plain markdown, one file per chapter, written the first time you type in one. They are part of `data/`, so back them up by copying `data/`.

Known limit: stray Space or Enter from the board's Plover output can press a focused drawer control, such as **Close**, while the drawer has the focus; the drill's own key catcher is not focused while a tool is open. Turn Plover's Output off while you practice (see above).

## Your data

Everything the app writes lives in `data/`:

- `steno.db`, a SQLite database (tables `sessions`, `tests`, `strokes`, and `progress_marks`, which holds only your read and override marks, one row per chapter)
- `settings.json`
- `journal/YYYY-MM-DD.md`, your notes: plain markdown, one file per local day
- `notes/chNN.md`, your notes per chapter from the My notes tool: plain markdown, one file per chapter (1 to 26)

Each is created on first save (the journal folder when you first write a journal note, the notes folder when you first type in My notes), so `data/` does not exist until you first use a drill or change a setting, and on a fresh install merely opening a tab writes nothing. The first start after upgrading from an earlier version adds the empty `progress_marks` table to an existing `steno.db` in place (your tests and strokes are not changed), so copy `data/` first if you want a backup. Back up by copying the whole `data/` folder. It is git-ignored on purpose.

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
npm run build:content   # regenerate content/build from the vendored book
npm run sync:book       # re-vendor the book at the pinned commit (needs network)
```

`npm run dev` (leave `PORT` unset; the Vite proxy is fixed to 5757) prints the Vite address to open; Vite proxies `/api`, `/content` and `/media` to the server on 5757. `npm run sync:book` is only for re-vendoring the pinned book commit; you do not need it for normal use.

```
content/lapwing-book/   vendored book (generated; do not edit)
content/build/          generated pages and word lists (git-ignored)
scripts/                content pipeline and dev runner
server/                 HTTP server, SQLite archive, journal and chapter notes files, settings
src/                    client: reader, board, drills, chapter tests and gates, free type, history, days, journal, the dock tools, WebHID input
tests/                  vitest suites
docs/superpowers/       specs/ and plans/
data/                   your data (git-ignored)
dist/                   client build (git-ignored)
```

## License

The vendored book content under `content/lapwing-book` is *Lapwing for Beginners* from `aerickt/lapwing-for-beginners`, licensed GPL-3.0, at the commit pinned in `content/lapwing-book/PINNED_COMMIT`. That is fine for a private repo; the GPL applies to content derived from it if this is ever published.

`steno-lessions` (AGPL) was used as reference only; no code from it is used. The Lapwing dictionaries are MIT but are not used yet.
