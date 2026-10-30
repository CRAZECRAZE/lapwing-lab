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

## Left open by M3

Deferred from the M3 reviews; M4 plans start from these and the items above.

- The panel's chapter-test size uses the index count, which includes duplicates.
- `currentChapter([])` throws on an empty list (the real list is never empty).
- `requirementText` for a `test` gate ignores `maxMinutes` (no chapter has one).
- `ChapterPanel`'s saving guard reads render-time state.
- `setMark` / `clearMark` may resolve before a superseding reload has applied.
- The post-run reload can read stale results if the archive is slower than the drill's finish timeout.
- No test strikes a wrong stroke and then checks the hint in the new drills.
- Result-card markup and test helpers are copied between `DrillRunner`, `FreeRoute` and `Stage0Route`.

## Left open by the M3 tweaks (confirmation dialog)

From the review of the `ConfirmDialog` / `Open anyway` change.

- After a successful skip the opener button is gone, so focus falls to `<body>`; focus the new `Undo` button or the panel instead.
- The content behind the dialog is not `inert` (render through a portal and set `inert` on the app root).
- A click on the dialog backdrop while a write is in flight drops focus to `<body>`.
- Dragging a text selection from the panel onto the backdrop cancels the dialog.
- `chapterList([])` returns a malformed string (callers never pass an empty list).
- No test covers focus after a `ChapterPanel` failure, or a real-provider `setMarks` racing another reload.

## Left open by M4

Deferred from the M4 reviews; M5 plans start from these and the items above.

- **Generated and example data.** Only the first code span of an example bullet is read (about six real "word X or Y" bullets are lost, in Chapters 15 and 22), and about 253 outline-first bullets are skipped (about 24 real, in Chapter 8). A bare `Is` survives (the Chapter 12 `Also` sub-bullets are dropped since M5a). A whitespace-only line in `build-content.ts`, no column-count guard in `punctuationItems`, and the letters error text names Chapter 18 only.
- **Key chart data.** The `*` description keeps the lead-in "For this, press the asterisk key…"; `sounds` holds prose for special keys and spellings (`ff`, `gh`) for consonants, so the UI treats it as text; entries have no chapter field; no test for the partial-chapters throw.
- **Notes server.** `GET /api/notes/N` answers 500 if `chNN.md` is a directory, and `listNotes` throws on a dangling symlink named like a note (same for the journal). Untested: `/api/notes/5/x` 404, `%35`, and `0000005` being accepted as Chapter 5. `getNote` on a malformed 200 body returns `undefined`.
- **Save queue.** The non-integer-key test covers only `5/../6`, `x` and an empty key; the hook's key is fixed at mount (the Notes editor is remounted per chapter for that reason); `Entry.store` and `Entry.key` are unused.
- **Dock keys and drawer.** `BY_CODE` has no own-property check (`BY_KEY` does); `DockHost` does not restore focus if it unmounts while open; "dock" also names the reader's old `.dock` column; the tools are listed in both `TopBar.tsx` and `DockHost.tsx`; the drawer width under a classic scrollbar is unchecked; a time-up can land within 250 ms of the dock opening. The Alt+/ hint is wrong on a layout where `/` is not at the US position, and a bare `/` does not work where it needs Shift (known limits). The four tool buttons need scrolling at about 360 px. A stray Space or Enter from the board can press a focused drawer control such as Close (accepted).
- **Free type sources.** Free type's Chapter 18, 20 and 21 sources draw the generated lists too (acceptable per the spec; a one-line filter in `listIdsFor` if unwanted).
- **Tool caches.** The fetch-once cache boilerplate is copied in Lookup, Key chart and Briefs (a shared `cachedJsonList(url)` would remove it), and in all three a request still in flight when the reset helper runs can set `loaded` afterwards. Fetched bodies are checked only with `Array.isArray`.
- **Lookup UI.** The CSS source-text guard test could pass with a commented-out or `@media`-wrapped rule; the chips are focusable `<code>` without a role.
- **Key chart UI.** The sticky board is about 113 px tall on short windows; the board's `aria-label` is static, so the lit key is invisible to assistive tech (the row carries it); the Tab test only asserts `tabIndex === 0`; the `.keychart` gone-after-switching assertion was dropped.
- **Briefs UI.** The chips are `<code tabIndex=0>` with no handlers, about 125 pointless tab stops across the list; `No briefs match.` with only limit-hidden matches could say `…in Chapters up to N` as Lookup does; `type Briefs` shadows `function Briefs`; the tool `vi.mock`s in the Drill and DockHost tests could become one shared fake-provider wrapper.
- **Live regions.** The `aria-live` regions in the tools are created and removed per state, so the first announcement may be lost (use one persistent region).
- **Notes UI.** A note over the 200000-character server cap gets a 400 on every retry, so `Not saved — will retry` never succeeds and the text is dropped about ten minutes after the drawer closes (same as the Journal; a `maxLength` mirror would duplicate a server constant, so do both or neither). A chapter's first note shows `has notes` only on the next open. An A to B to A switch with the first save in flight is tested at the hook level only, and stale `dock-drawer__soon` class names remain in test stubs (harmless).

## Resolved by M5a

- **Lookup scope.** The generated drill lists are now in Lookup: the build turns the names of keys, symbols and commands into 132 `from the book` cards in `content/build/dictionary.json` (for example `Enter`, `Comma (,)`, `Period (.)`), so `enter` and `comma` find them.
- **The M4 Lookup index.** `lookup.json`, `src/core/lookup.ts`, `scripts/lib/lookup.ts` and their tests are gone; Lookup reads `dictionary.json`. The "Lookup index" and "Lookup tests" items of M4 and the "unticking the box" item of "Lookup UI" went with them (there is no `Include later chapters` box in Lookup any more).
- **Drawer scroll offset.** `scroll-padding-top` in `src/ui/dock.css` is `8rem` (was `6rem`), so a focused chip is not left under the sticky board; a test in `tests/ui/tools/Lookup.test.tsx` reads the rule.

## Left open by M5a

Deferred from the M5a reviews; M5b plans start from these and the items above.

- **Chapter 12 "Also" bullets.** `thirst`'s outline `TH*EURS` (the book: "Also `TH*EURS` (recommended)") is unlabelled because the "Also" sub-bullets are dropped. Attaching a nested "Also" sub-bullet to its parent bullet's word (it would hit exactly two cases, `list` and `thirst`) needs a ruling.
- **Briefs and the chapter limit.** The Briefs tool still limits to the chapters taught so far, with its own `Include later chapters` box (spec call C8); say if it should show everything like Lookup.
- **Sync script.** `sync:dictionary` removes the vendored folder before copying, so a commit that lacks one of the six files leaves a half-written folder (same as `sync:book`; `git checkout content/lapwing-dictionary` restores it). Its guard test would run a real sync if the guard were deleted, and `SOURCE.md` puts the path prefix on the first file name only.
- **Dictionary build tests.** The join key does not trim the dictionary's own translation (spec C11 says both sides trim; one real translation, a plugin-version string, has trailing text and no book entry names it). A dead `!row.x` check in pass 1 of `buildDictionary`. The named-versus-dictionary sort tie-break is redundant (removing it passes every test, and one test comment overstates it). The five-lists test does not assert the "never an `x` row" half. No test for a missing `PINNED_COMMIT`. A nested object in a dictionary file reports `got a object`. A failed size guard leaves an older `dictionary.json` in place (as `lookup.json` did). No test pins the Chapter 8 brief `Enter or Return` (`R-R`) named card, and `mergeDictionaries` does not validate its input (the build does).
- **Outline and search tests.** `mistake` is asserted only by length and `defense`/`defence` only with `has` in the real-file guard. The digit fallback in `outlineKeys` never runs on the pinned data (comment it, or assert that every outline parses). The 500 ms outline-search ceiling is about 7 times looser than the real timings (it still catches sorting with `compareOutlines`). The fingerspell prototype-key guard test cannot fail.
- **Search speed.** One-letter capital queries such as `T` or `S` take about 45 to 97 ms per keystroke (a lazy sort of only the first 30 would fix it); input that is not already in order costs about 27 ms on the first call (the build always writes it in order).
- **Search behavior.** An `x` row's outline is searchable (searching `TP-PL` finds card `.`); this is intended. `Defense` sorts before `defense` (code-unit order, documented).
- **Lookup tests.** The `Try again` test does not assert that `Loading…` shows and the error clears at once (a retry that skips `loading` survives). No test that the card keys stay unique (a key by translation only survives).
- **Lookup accessibility and reading.** The `aria-live` regions are created and removed per state, so the first announcement may be lost (one persistent region is cheap; same as the M4 "Live regions" item). The matching-row emphasis is a 2 px bar with no text or ARIA cue. Card headings are `<p>`, not headings. The chapter label and the kind have no text separator, so copying reads `Chapter 5practice list`.
- **Lookup headings.** `isCode` shows about 38 plain names (`Côte d'Ivoire`, `and/or`, `Johnson & Johnson`) in monospace. The fingerspell cap of 40 letters is arbitrary (spec call C22).
- **Code tidiness.** `LookupList` in `scripts/lib/dictionary.ts` could be renamed (for example `BookList`). No test asserts that `lookup.json` is absent from the build output. One wrapped `<div>` in `Lookup.tsx` is formatted oddly.
- **From the final review.** The matching-row bar (`hit`) marks only the row that placed the card, so for `TK` the card `did` bars `TK` but not `TKEUD`, which also starts with `TK` (README says the rows that matched are marked; reword it, or widen `hit` to every matching row while still sorting by the best). Nineteen brief labels carry a note equal to the word itself (the book's mnemonic highlighting is stripped: `Chapter 5 brief did`); dropping a note equal to the card text would read better. The book spells two names two ways, so `Enter (and capitalize next word)` and `Enter (capitalize next word)` (both `R*R`), and `Capitalize the next word and suppress a space` and `...the next space` (both `KPA*`), show as two `from the book` cards each. A dictionary card missing `r` would throw in render instead of showing `Couldn't load the dictionary.` (only a hand-edited build output can do that). No automated test types into the real Lookup during a drill (the drill tests use a stand-in drawer; checklist item 23 covers it). A future `sync:dictionary` makes a 100,000-line diff (a `.gitattributes` line `content/lapwing-dictionary/*.json -diff` would quiet `git log -p`), and two tests pin the current pinned data (the commit in `dictionary-vendored.test.ts`, and `mistake` having exactly two outlines in `dictionary.test.ts`).

## Left open by M6a

Deferred from the M6a reviews; M6b plans (the plateau notice and the month report) start from these and the items above. Nothing here blocks the Progress page.

- **Known limits of the key statistics.** (a) Multi-stroke blame: the archive does not record which stroke of a multi-stroke word was attempted, so a miss is matched to the closest stroke of any accepted outline; about 0.6 to 0.7% of wrong second strokes were blamed on stroke 1 in a 502,000-stroke simulation, and none for single-stroke, single-outline slips. (b) Blind spot: retyping the previous stroke where a later one was needed has distance 0 to that stroke, so the keys count as required and no miss is recorded (7,909 of 7,923 two-stroke words in the simulation). Fixing either needs the stroke position in the log, which is a schema change for a future milestone. There is no test for the distance-0 case, and `keyStats` has no `Array.isArray` guard for a null `expected` (unreachable now: the archive filters non-arrays).
- **Time zone in the tests.** The dev machine is in Asia/Jerusalem, which has daylight saving, so the DST-sensitive `daysBetween` tests do run in a DST zone here. A reviewer also checked them under other zones (including ones without DST); they pin nothing. The reviews compared the date helpers with a reference in six time zones, including DST ones, with no mismatch.
- **Narrow windows.** The 320 px top bar still scrolls sideways a little (it fits at 420 px; the target was 360 px). SVG text in the charts is 8 to 9 px at 420 px, and its label widths are estimated at 8 units a character (real Chromium is narrower). The ladder's untried rows take two lines at 420 px, and Chapter 4's ladder row has no bar (a blank slot at 1280 px, a bare line at 420 px).
- **A test of the real wiring.** `tests/ui/Progress.test.tsx` mocks `useProgress` for the chapter ladder, and the real `ProgressProvider` path (a ladder row built from real chapter results) was only checked by a scratch test and by hand on a copy of the archive. Add a committed test that renders the Progress page inside the real `ProgressProvider`. The unmount test for the data hook cannot fail (a Preact 11 `setState` after unmount is a no-op).
- **Rhythm, small edge cases.** `runRhythm` throws a `TypeError` for an impossible input (30 gaps of 1e308 with `breakMs` set to `Infinity`): `Math.ceil(NaN)`; fix by setting `quarters` to null when the active time is not finite (unreachable with the default options). The Rhythm run picker's drill options show the raw `describeTest` text (`section · 5-2`). The quarters chart's y axis jumps to 0 to 50 for a top value of 21 (`niceMax`). Only the shown run's strokes are kept, so returning to an earlier mode refetches the newest run's strokes if another run was loaded in between. The strip is capped at 44rem (a wider strip would need a wider viewBox).
- **Server and archive.** A numeric `meta.abandoned: 1` drops a run from `timingsInRange` while `runsInRange` reports it as not abandoned (the app only writes boolean `true`; `selectLast` has the same quirk). `dayStats` does not reject `from` after `to` (the three new ranged methods and the routes do). The `r.endedAt === null` guard in `buildStats` is redundant. The 1,500 ms ceiling in the 200,000-stroke test does not trip on an O(runs x strokes) regression (1.1 to 1.4 s): add a scaling-ratio assertion (100k against 200k, under about 3 times) or a lighter 100k fixture with a 750 ms ceiling. The timing and key-row arrays reach 80 to 90 MB of heap at 200,000 strokes, so they must stay on the server.
- **Helpers in `progressview.ts` and `chartmath.ts`.** `weeksOf` sums near 1e308 overflow to Infinity (impossible input), `movingAverage(..., Infinity)` treats the window as 1, a fractional window is floored and no test pins that, and `utcDay` is wrong for years 0 to 99.
- **Progress panels, tidiness.** Plural, percent, clamp and the panel head are duplicated across the panels; `shown = active !== null ? active : null` in `WeeklyBars.tsx` is a no-op; the date tick labels end a little before the right edge; `Loading…` has no `role="status"`, and the tiles collapse to one line on a switch (a `min-height` would calm the jump); `useYearDays` requests the year even for an empty archive.
- **Charts, small behaviors.** No test catches removing `preventDefault` on the handled arrow keys (correct live). Hover and focus share one active state, so moving the mouse off a keyboard-focused point hides its tooltip. The weekly strokes labels thin by one uniform step set by the widest label, so a single 4-character outlier (`1.5k`) thins 12 to 14 bar views more than needed. The partial-first-week note sits under the svg rather than inside it. A steadiness bar inside the band tint is 2.87:1 against it (the others are 3.31 or better).
- **Colour.** The heatmap's level colours are slightly stronger than the Days tab's; the ladder's amber and green differ in hue only (luminance ratio 1.21:1; the words `met` and `not yet` carry the meaning); a ladder gate test with no pass mark shows `needs —`.
- **Resolved by M6b: Chapter tests read erratic by design.** A chapter test shows each word three times in a row, so the first showing carries reading time and the repeats are quick; through `runRhythm` a run scores steadiness about 18 with about 21 stalls, against about 69 and 0 stalls for the same typist in free type. The page now says so (a note under the figures and a line under the accuracy chart). Next step: a repeat-aware score, using whether a stroke's `prompt` equals the previous stroke's prompt, plus a stall share in the score. M6b scores chapter tests on the second and third showing of each word (first showings are `first showing` bars, left out of the scores) and labels the steadiness `repeats only`.
- **Resolved by M6b: The first gap of a run.** It is the time since the first prompt appeared, so a settle of 2.5 to 10 s before starting shows as a red stall on stroke 1. Option: label stroke 1 `start` and leave it out of the stall and break counts and the typical gap. A call for the owner. M6b labels the first bar `start` and leaves it out of the stall and break counts, the typical gap and the steadiness.
- **Bundle size.** The JS bundle grew from 112.81 to 159.01 kB with M6a.
- **Server memory on all-time.** The stroke-timing and key-row reads materialize every row; iterate the statement instead.
- **Chart tick text** is about 7 px at 360 px wide.
- **`today` is read once at mount.** A tab left open past midnight keeps yesterday's windows until reload.
- **All-time `Show the numbers` tables are not lazy** (about 2,300 rows).
- **Rounding of small changes.** An accuracy change of -0.05 points prints `-0.1`.
- **Layout.** Panel 4 (Rhythm) sits below panel 3 rather than beside it.
- **Tile comparison wording.** The speed and accuracy tiles compare against `the 7 days before`, not `last week`.

## Left open by M6b

Deferred from the M6b reviews. Nothing here blocks the plateau notice, the reports or the Rhythm view.

- **The notice needs data.** The plateau notice needs about three weeks of regular free-type practice (2 or more free-type runs in each of 3 weeks) before it can appear, so it could not be seen on the owner's history when M6b was built.
- **Notice outside the data panels.** On the Progress page the plateau notice renders outside the data panels, so during loading, on an error or in the empty state it can show while its `Weakest keys` and `Mix-ups` links have nothing to scroll to. The cheap fix is to render it inside the ready branch, above the tiles.
- **Extra requests.** Every chapter-page visit now makes one 56-day `/api/stats` request and one `/api/settings` request (per mount).
- **Small feedback gaps.** A failed snooze write gives no feedback (the notice just stays). Accuracy shown as a whole percent in the notice can show a one-point rise for a 1.5-point gain.
- **First showings in long chapter tests.** The `.rhythm__bar--fresh` stroke may look darker than the normal bars on very long chapter tests (over 300 strokes).
- **Two date validators.** `server/journal.ts` has its own `isJournalDate` that overlaps the shared `isIsoDate` in `src/core/dates.ts`.
- **Reports path is a file.** If `data/reports` is a file instead of a folder, the reports routes give HTTP 500, like notes and the journal do.
- **Report page, failure and limits.** A Progress-data error blocks the whole report instead of only the chapters tile. The notes box mounts only once the numbers are ready, so a stats failure also hides it. `firstMonth` looks back only 36 months.
- **Report tiles, empty month.** `reportTiles` shows no change line for time and strokes when this month is empty but the previous month had practice.
- **A clamp that cannot trigger.** The 1,100-day clamp in `reportsWindowStart` can never trigger (36 months is at most about 1,096 days).
- **Rhythm and stats tests (tasks 1 to 3).** The rhythm test `puts a break stroke at the very start...` has a stale name (stroke 0 is now `start`). There is no `buildStats`-level test for malformed chapter-test `expected_json` (the run is scored without first-showing flags). `stats.ts` keeps a `modes` map beside `counted` (one map would be tidier). A RhythmView test title (`does not throw and shows no first showings when stroke rows cannot be replayed`) overstates what it asserts.
- **Chapter-test timings in free mode.** `timingsInRange` parses `expected_json` for chapter-test rows even when the chosen mode is free (cheap but wasted); pass the mode or parse lazily.
- **A third date validator.** `src/ui/Journal.tsx` `isCalendarDate` is a third copy of the shared `isIsoDate` (it was there before M6b).
- **Separate fetches.** The plateau notice, the month-end banner and the report each fetch `/api/settings` and the days separately.
- **Plateau detector.** `plateau.ts` has a `w.wpm as number` cast, and there is no test for a `[41, 42, null, 44]` sequence. The 360 px layout of the plateau notice was not checked in a browser.
- **Report math.** `report.ts` uses an all-dates `EVERYTHING` window to reuse `qualityMean` and `sumOf`; `Tiles.tsx` re-exports `thousands` as a shim.
- **Reports list and banner.** `Reports.tsx` keeps a `latest` ref that duplicates the `live` flag. `.report-banner p` in `reports.css` is dead. There is no direct unit test for `practiceByMonth`. The banner makes its own `/api/days` call over the 36-month reports window, of which the heatmap's year covers only part.
- **Report page tests.** Missing edge tests: `firstMonth` when the previous month is empty but an earlier one has practice; a note-only earlier month; `getSettings` failing; unmount before the data resolves; a late-evening local-date pass and a pass in a later month; and `stores reportSeen once on retry` never retries.
- **First-showing detection after an undo (rare).** `firstShowings` replays a chapter test's stroke rows, and the live drill never logs the undo star. It resyncs when the replay says miss but the row was correct. One case is not covered: you take back an accepted stroke of a multi-stroke word and then press, by accident, a later stroke of the same word instead of retyping it. The drill logs a miss, the replay still has the old stroke and sees a valid one, and the first-showing marks shift for the rest of that run (only the steadiness figure and the pale bars are affected). A cheap extension would resync when the row is a miss and the replay says otherwise. Outlines with a lone `*` stroke or a repeated stroke are also ambiguous in the logs; the book's lists have neither.
- **A timing test that can fail under load.** `tests/core/dictsearch.test.ts` ("does not grow worse than linearly", a timing ratio against a limit of 12) failed once with 12.26 during a review while other work was running, and passed 45 of 45 on re-runs. It is from M5a, not M6b.

## Left open by M5b

Deferred from the M5b reviews (the fix-up drill). Nothing here blocks the Fix-up page or the drill; the first five are limits of the design, the rest are tidiness.

- **Fix-up strokes feed the Weakest keys and Mix-ups panels.** A real slip in a fix-up run is a real slip, so its strokes count there as in every mode (spec). But the drill repeats the very keys you miss, slowly and on purpose, so a run adds many presses of those keys, most of them clean, and may lower their miss rate on those two panels. Whether it flatters them on your real history was not checked. If it does, the fix is to leave `fixup` runs out of the key-row read behind `/api/stats` (the Fix-up lists use their own read and would keep seeing them).
- **Multi-stroke attribution.** The archive does not record which stroke of a multi-stroke word was attempted (the same limit as under M6a). A word attempt is judged as a whole (clean when no row of it was wrong), the Words tab shows only the first accepted outline, and a pattern's blame goes to the closest stroke of any accepted outline, so a slip on a later stroke can be listed against the wrong key. Fixing it needs the stroke position in the log (a schema change).
- **Two meanings of "fixed" for a pattern.** In the list a pattern is fixed when the latest ten strokes that needed its key all pressed it, and a mix-up and a missing key for the same needed key share that status (fixing `-T typed for -S` also hides `-S missing`, and the reverse). In the drill a pattern is fixed when ten whole words in a row are clean, so a miss on a different key resets it. Both are stated in the README; a per-pattern status would need separate logs of each pattern.
- **The 30-day window can truncate a streak.** Only strokes of the last 30 local days are read, so a clean streak that began before the window is counted from the window's edge (an item with 6 clean in the window and 4 just before it still shows as not fixed), and a word needs 5 attempts inside the window to be listed at all. The window is a constant (`FIXUP_WINDOW_DAYS`).
- **The Briefs tool's limit is unchanged.** It still shows only the chapters taught so far with its own `Include later chapters` box (see "Briefs and the chapter limit" under M5a); the fix-up pattern words use the same taught-so-far rule, with no switch.
- **Page behaviour.** `useFixup` refetches on every mount, so each visit to Practice makes one `/api/fixup` request. Like `today` under M6a, the 30-day window is fixed when the page mounts. The Patterns tab's `Words` column stops at 12 (`PATTERN_WORDS`), so 12 and 40 look alike and a disabled row does not show how close it is to 4. `useWordLists` shows the previous lists for one render after the reached chapter changes.
- **Fix-up run on a History detail page.** Rhythm is shown for a finished fix-up run and says `not enough strokes to show the quarters` (there is no speed to show); the wording could say so for mode `fixup`. `TestList.tsx` has a long nested template line for the accuracy and wpm text.
- **Run host details.** `FixupRun.tsx` takes a pattern's identity from `patternId(p)` in one place and `p.id` in another; the `Nothing` message repeats `RunnerMessage`; the title string `Fix-up · kind` is built twice; the `picks` are omitted from the `useMemo` dependencies (the route's `key` on the query makes that safe). `FIXUP_MAX_SHOWINGS` lives in `fixupdrill.ts`, not `fixup.ts` as the spec listed. The `extraMeta` of `Drill` is spread last, so it could override `kind`, `abandoned` or `passed` (the host uses other keys); the immediate-finish path for an empty round passes no `extraMeta`. The only no-wpm check in the UI tests is at the start and result states, not mid-run.
- **Session class.** `FixupSession` reads the clock twice per stroke (once itself and once through its inner `DrillSession`), and its `current` getter creates the inner session lazily. No test types a wrong stroke on a later stroke of a multi-stroke word through it.
- **Pure core.** `rankPatterns` re-implements `keyStats`' one-for-one mix-up rule to find each pattern's last time (a drift would silently give `lastTsMs` 0 and `Last seen` a dash); no test asserts a mix-up's `lastTsMs`, the shared-status test runs one direction only, and a few lines (the sort comparator in `rankWords`, two in `rankPatterns`) are long. There is no `wordAttempts` test for an unlogged undo (`KAT`, `KAT`, `PHREU`).
- **Server and route tests.** The 400 cases for `/api/fixup` with no archive do not assert that `data/` stays absent; the archive test hardcodes stroke ids 1 and 2; two test files have a similar `seedCat` helper. `/api/stats` now checks the date range before the mode, so with both a bad span and a bad mode the 400 message names the span (the status is unchanged; nothing reads the text). There is no stale-response or tab-switch-mid-fetch test for the page, and no `App` test for the `fixup` route branch.
- **Entry-point tests and CSS.** The new `.fixup-card` rules in `practice.css` sit between the `Where you are` comment and its rule; a `plural` helper in `Practice.tsx` duplicates the `times` helper in `Mixups.tsx`; the two `Drill these` link blocks are identical; the failed-fetch test waits for a real 10 ms timeout.
