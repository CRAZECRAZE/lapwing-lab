# Lapwing Lab

A private, offline, interactive version of the book *Lapwing for Beginners*, driven by your Uni v4. The whole book is readable in the app, its strokes light up on an on-screen board, and the Chapter 4 "Stage 0" drills run on your real keyboard and archive every stroke. It is not a replacement for Plover: it never sends strokes to Plover, never types text, and never touches Plover's config.

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

Plover types translations into whatever window has focus. The drill screen swallows stray text, but turn Plover's **Output** off anyway while you practice here (the status line in the app reminds you).

Plover should be able to stay connected at the same time: on Linux, hidraw normally delivers every report to every program that has the device open. This has not been checked against a real board yet. If **Connect** fails while Plover is running, close Plover's machine connection and tell me.

## What is inside today

- **Reader** for all 33 pages of the book (Home, chapters, appendices, Glossary, Changes), with the book's images and videos served locally.
- **Live strokes.** Strokes in the text light up the keys on a board when you hover, focus or click them. While a stroke is shown in the board panel, pressing it on the Uni shows a ✓; for a multi-stroke outline, press the strokes in order starting from the first.
- **Stage 0 drills** on the Chapter 4 page: six key-row drills (left bottom, right bottom, left top, right top, vowels, star), the 100-word layout test with the book's pass mark (90% accuracy within 10 minutes), and two extra practice lists.
- **Board visibility** for the drill screen: always, hover or hidden.
- **Archive.** Every drill stroke is stored with the keys you actually pressed, so a miss can be analysed later.

## Not built yet

Chapter 5+ section drills, chapter tests and gates, briefs memory, reverse lookup, the journal, reports and routines. The order of work is in `docs/superpowers/specs/2026-10-27-lapwing-lab-design.md` section 9.

## Your data

Everything the app writes lives in `data/`:

- `steno.db`, a SQLite database (tables `sessions`, `tests`, `strokes`)
- `settings.json`

Both are created on first save, so `data/` does not exist until you first use a drill or change a setting. Back up by copying the folder. It is git-ignored on purpose.

Leaving a drill early (Exit or Esc) keeps the strokes you already did, but the test is never marked finished, so it will not show up as a result on the Chapter 4 page.

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
server/                 HTTP server, SQLite archive, settings
src/                    client: reader, board, drills, WebHID input
tests/                  vitest suites
docs/superpowers/       specs/ and plans/
data/                   your data (git-ignored)
dist/                   client build (git-ignored)
```

## License

The vendored book content under `content/lapwing-book` is *Lapwing for Beginners* from `aerickt/lapwing-for-beginners`, licensed GPL-3.0, at the commit pinned in `content/lapwing-book/PINNED_COMMIT`. That is fine for a private repo; the GPL applies to content derived from it if this is ever published.

`steno-lessions` (AGPL) was used as reference only; no code from it is used. The Lapwing dictionaries are MIT but are not used yet.
