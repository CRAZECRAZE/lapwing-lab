# M0 + M1 follow-ups

What the final review of the M0+M1 build left for later, so the M2 plan starts from a real list. Source: the execution ledger and the final whole-branch review (2026-10-27). Nothing here blocks use of M1.

## Check with the real board (only the owner can do this)

1. Connect shows the Uni in the chooser (filter usage page `0xFF50`, usage `0x4C56`) and `open()` succeeds while Plover is running. The browser needs read **and** write on the hidraw node; a permission error appears in the status line.
2. Every physical key lights its own cell: S1 vs S2, `*1`–`*4`, `#1` vs `#2`. One wrong lamp means the chart or the firmware descriptor differs from Plover's.
3. A stroke completes when you release (an all-zero report arrives) and nothing fires while idle.
4. Unplug mid-drill: banner appears and the clock freezes within about a second. Replug: reconnects with no click and no phantom stroke from a half-held chord.
5. After a page reload the board reconnects by itself.
6. With Plover Output **on**, stray text goes into the drill's sink and nothing changes. The reader page has no sink by design.
7. Brave: confirm `navigator.hid` exists. The README says "untested".
8. Pronunciation videos play; seeking may be poor (no Range support).
9. After one drill: `select count(*) from strokes` is above 0 in `data/steno.db` (README shows the command).

If 1–3 fail, the fix is in `src/core/uni.ts` or `src/hid/uni-link.ts`, not a redesign.

## Open from before M2

These were listed as "decide before M2" and M2 did not take them up.

- **Sessions** are one per attempt and never ended; use stroke timestamps for timelines rather than trusting `sessions`.
- **Single sources of truth:** the Stage 0 pass mark is defined in `src/stage0/lists.ts` and parsed from the book by `scripts/lib/passmark.ts`; the board-visibility values are listed in four places (`server/settings.ts`, `server/server.ts`, `src/api.ts`, `src/ui/VisibilityPicker.tsx`).
- **API writes** accept any content type. Requiring `application/json` on POST/PUT (forces a preflight) needs the client and server changed together.

## Resolved by M2

M2 is done. It resolved only one item of the pre-M2 list (abandoned tests); the others stayed open (above).

- **Abandoned tests.** A drill or free-type run left early is now closed with the partial stats and `meta.abandoned: true` (History shows it as `Left early`; the Chapter 4 panel and the Practice tab do not count it as the last result). `ended_at IS NULL` now only means the browser tab was closed mid-drill. The logger starts lazily on the first stroke, so a test with no strokes is never created. M6 reports should still treat `ended_at IS NULL` and `meta.abandoned` consistently.

## Small items by area

- **Reader:** Back/Forward lands at the top because `scrollToHash` overrides scroll restoration (first on the list for daily use); focus is not moved after a page swap; clicking the current page in the nav drops the hash; main column is under 60ch between 761 and 950 px; the compact board is forced to 14 px with `!important`; `book.json` pages are not validated; hover lighting is only tested in jsdom.
- **Drill / board:** hover placeholder size duplicates the Board's geometry (export constants from Board); the board shows `always` until the settings request returns; no elapsed-time readout though the pass mark has a time limit; Tab is trapped by the sink (Escape and pointer work); capture-phase listeners would still see sink events (add an `isSinkTarget` marker when M3 shortcuts arrive); banner text still says "(Chrome, Edge, Brave)" while the README says Brave is untested.
- **Content pipeline:** a mid-build failure leaves stale root files in `content/build/` (clear the folder first); `tables.ts` returns `[]` silently if a subheading sits between "Chapter briefs" and its table; literal HTML entities are not decoded; practice-link-inside-heading attaches to the previous heading; no scheme check on iframe/link hrefs; Appendix C's `/javelin_dictionaries/*.json` links 404 (rendered but ignored by design); replacing the vendored book is not atomic if a user-supplied commit lacks `src/`.
- **Server / API:** no Range support for the 25 mp4s; `nosniff` header missing; a dedicated `ValidationError` instead of mapping every `RangeError` to 400; `startTest` does not validate `mode`/`section` at the archive layer; `meta` has no size or shape check beyond the 1 MB cap; settings write leaves a temp file if the rename fails; the DB handle leaks if schema creation throws on a corrupt file; `finishTest`/`addStroke` are allowed on an already-finished test (clients may retry finish, so no 409); unknown `sessionId` returns 404 (400 would be more precise).
- **Tests:** no test pins "visibility change keeps the run" or "Again gets a fresh logger and reshuffle"; the double-click Connect test passes without the ref guard (needs a post-settle `requestDevice` count of 1); no test for the single-logger refactor; `slotMask` has no runtime guard for non-`Slot` input (matters when M4 imports a dictionary); CRLF and three-field practice lines are untested; a missed-flag-style gap check for new engine code.
- **Styling:** `#14151a` and `#6fbf8a` are hard-coded in places; the `|| flash` term in the inspector's cycle guard is dead at the current constants (add a comment).

## Left open by M2

Deferred from the M2 reviews; M3 plans start from these and the items above.

- A QuickNote/journal append in one browser tab is overwritten by another tab's autosave (needs a server-side version check).
- Text still unsaved when the page closes, or after 10 minutes of failed orphan retries, is lost (no client-side persistence).
- A 400 on an over-long journal note (200000 chars) retries forever with no reason shown, and the textarea has no `maxLength`.
- The flow line has no live announcement for screen readers.
- The Journal date check is duplicated between `server/journal.ts` and `src/ui/Journal.tsx`, and `isCalendarDate` lives in `Journal.tsx`.
- `isJournalDate` refuses `0000-02-29`.
- History rows show `0%` / `0 wpm` for a finished test with null numbers.
- A POST to a `GET /api/tests/:id`-style path now answers 405 instead of 404.
