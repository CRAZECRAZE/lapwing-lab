# Lapwing Lab M6: the Progress page (design)

Date: 2026-10-28. Amends `2026-10-27-lapwing-lab-design.md` (§4.4, §9, §11). Everything in the earlier spec still holds unless this document says otherwise.

## 1. Intent

The owner practices every day and wants to see, in one visual place, whether it is working: how fast and accurate they are in free type, how steady they are while typing, how much they practice, which keys and mix-ups hold them back, and how they stand against the book's chapter marks. The app already records everything needed (sessions, tests, and every stroke with its time, whether it was right, and the keys pressed), so M6 adds no new logging: the owner's existing history fills the page from day one.

In the owner's words: "an average wpm by day for free types", "a visual page to show me accuracy, consistency", "overall weekly practice time, overall strokes hit", and, about consistency, "inside a run is more important for me to see... how consistent I am when I actually type". The owner chose all ten panels in the mockup ("exactly what I visioned") and chose to see rhythm in both places (the Progress page and each run in History).

## 2. Goals, non-goals, anti-goals

**Goals**
- A **Progress** tab (a sixth top-bar tab: Book, Practice, History, Days, Progress, Journal) with the ten panels in §4.
- **Rhythm** (consistency inside a run) as a panel on Progress and as a section on every run's detail page in History.
- A month-end report the owner can annotate (their words in a file of their own, like the Journal).
- Honest numbers: every figure says what it is computed from, shows "not enough data yet" instead of a misleading value from a handful of runs, and never changes when nothing new was practiced.

**Non-goals (not in M6)**
- Briefs memory (M5b), routine planner, ghost replay, real-text practice (M7).
- Goals, targets, streak rewards or badges. No scores that rank the owner against anyone.
- Any new logging or change to what the archive records; any write to the archive from this page.
- Exporting data, or sharing the report.

**Anti-goals**
- A number that sounds precise but rests on three runs; a trend line drawn through noise as if it meant something.
- Nagging. The plateau notice is one quiet line, never a pop-up, and can be hidden.
- Counting a run the owner left early as if it were a full result.

## 3. The page

The Progress tab has a header with two switches and the panels below.
- **Range:** last 4 weeks (default), last 3 months, or all time.
- **Mode:** Free type (default), Everything, or Chapter tests. Panels that are about one mode say so in their title.

Panels, in this order (spec of each in §4): 1 headline tiles, 2 free-type wpm by day, 3 accuracy and consistency, 4 rhythm, 5 practice time and strokes per week, 6 weakest keys, 7 mix-ups, 8 chapter ladder, 9 year heatmap and streak, 10 plateau notice, then the month-end report as its own section at the bottom with a month picker.

## 4. The ten panels (and rhythm)

1. **Headline tiles.** This week (Monday to Sunday, local time) practice time, strokes, and the free-type 7-day average wpm and first-try accuracy, each with its change against last week; all-time strokes. Changes are shown only when both weeks have data.
2. **Free-type wpm by day.** One dot per day practiced (the day's average wpm over its finished free-type runs), a line through the dots and a dashed trend line (a 7-day moving average over the days practiced). Best day shown. Hover or focus a dot to see the day, its runs and its words per minute.
3. **Accuracy and consistency.** First-try accuracy per day (line) and the day's typical steadiness (bars, from §5); the day-to-day band (the spread of the daily value over the last 14 days, narrower means more reliable).
4. **Rhythm.** The panel the owner cares most about. For one run: steadiness (0 to 100), stalls, the typical gap between strokes, start versus finish (wpm in the last quarter against the first), the strip with one bar per stroke (the pause before it; stalls in red; a dashed line at the typical gap), and wpm in each quarter of the run. It defaults to the latest finished run in the current mode, with a picker for earlier runs (the 20 latest), beside the day-by-day steadiness chart from panel 3. The same section appears on each run's detail page in History (a run's own page shows its own rhythm, never an average).
5. **Practice time and strokes per week.** Weekly bars for time practiced (same definition as the Days tab: first stroke to last stroke of each run, summed) with strokes per week as a second series or labels; the current week drawn lighter as "so far".
6. **Weakest keys.** The board, each key shaded by how often it was missed when it was needed (misses where that key was required ÷ times it was required), with the worst five listed beside it. Needs at least 30 required presses of a key before it is ranked.
7. **Mix-ups.** The pairs the owner confuses, derived from the strokes: a key pressed that was not needed together with the key that was missing in the same stroke ("`-P` instead of `-B`, 9 times"). Top eight; a pair needs at least 3 occurrences.
8. **Chapter ladder.** For each chapter with a test, the owner's best passed or best attempted chapter-test result (wpm and accuracy) beside the book's pass mark, in the same colors the rest of the app uses for "met" and "not yet".
9. **Year heatmap and streak.** A grid of the last 52 weeks, one cell per day shaded by practice time (same shading steps as the Days tab), with the current and longest streak.
10. **Plateau notice.** One quiet line under the tiles when there is something to say. Rule: at least 5 days practiced in the last 14 days, and the free-type 7-day average has not risen by at least 3% over the previous 14 days. The line says what the numbers are and offers one plain observation drawn from the data (for example "your accuracy is 88%: slowing down a little may help" when accuracy is under 90%, or "your most missed key is `-F`"). It can be dismissed for that week.

**Month-end report** (bottom section). A month picker (default: the current month; the previous month once the new month has begun and the report is not yet written). The report shows, computed live and never stored: days practiced, time practiced, strokes, free-type wpm at the start and end of the month with the change, accuracy change, steadiness change, the five weakest keys, the top three mix-ups, chapters cleared in the month, and the longest streak. Under it is a text box for the owner's own notes, saved to `data/reports/YYYY-MM.md` (only their words), with the same autosave behavior as the Journal and Notes (read-only until loaded, never overwrites on a failed load, never creates a file for an empty note).

## 5. Definitions (the numbers mean this)

- **Run:** one finished, non-abandoned test. Runs the owner left early count toward time practiced and strokes, and are left out of wpm, accuracy, steadiness, the ladder and the plateau rule (partial results mislead; History still shows them as `Left early`).
- **Day wpm / accuracy:** averages over that day's runs in the chosen mode, weighted by words (a 50-word run counts more than a 10-word run).
- **Strokes:** every recorded stroke attempt, including misses. A second figure, the share that were right first time, is shown with it.
- **Pause before a stroke (gap):** the time from the previous stroke of the run (or from the first prompt appearing, for the first stroke) to this stroke. Gaps that are really breaks (over 10 seconds) are ignored for rhythm and counted as breaks, not stalls.
- **Typical gap:** the median gap of the run.
- **Stall:** a gap more than 2.5 times the typical gap and at least 1 second long.
- **Steadiness (0 to 100):** how evenly the gaps fall around the typical gap, higher is steadier, computed from the spread of the gaps relative to their median (a robust measure, so one stall does not wreck the score; the exact formula is the builder's, with the properties that a perfectly even run scores near 100, doubling every other gap lowers it clearly, and a run with fewer than 10 gaps shows no score). Its meaning is stated on the page in plain words.
- **Start versus finish:** wpm in the last quarter of the run against the first quarter (by time).
- **Local time:** days and weeks are the machine's local calendar, as on the Days tab; weeks start on Monday.
- **Not enough data:** a figure that rests on fewer than 3 runs (day, week or range) is shown as a dash with "not enough data yet".

## 6. Data and server

- A new read-only route, `GET /api/stats?from=&to=&mode=`, answers everything the page needs for a range in one request (per-day wpm, accuracy, steadiness, time and strokes; per-week totals; weakest keys; mix-ups; ladder; heatmap days; streaks) computed from the existing tables. It follows the existing route conventions (existing archive only, no file created when there is none; a range cap like `/api/days`, large enough for the year view). A second route returns a run's rhythm (the strip, quarters, stalls and steadiness) for History and the Rhythm picker.
- The page keeps no copy of the data: reload gives the same numbers. Nothing here writes to `steno.db`.
- Reports: `GET /api/reports` (which months have notes), `GET/PUT /api/reports/:month` (`YYYY-MM`), implemented like `server/notes.ts` (lazy creation, atomic write, the same size cap), reusing the generalized autosave store in `src/ui/useAutosave.ts` (a `reportsStore`).
- Performance: the strokes table can reach hundreds of thousands of rows; the aggregation must be done in SQL or in one pass in the server, not by loading every stroke into the browser. A measured ceiling (for example a 200,000-stroke fixture answers in under a second) is part of the tests.
- The Board component gets an optional per-key `heat` input (0 to 1) for panel 6; it must not change how the existing prop combinations render.

## 7. Constraints

Offline, local, private repo; `data/` is touched only by the new `data/reports/` notes (lazily); same code style, token-only CSS, calm and dark, no emoji; charts are hand-drawn SVG (no charting dependency; no new dependency at all); every chart has an accessible text alternative or table equivalent (the numbers behind it) and does not rely on color alone (the "met"/"not yet" states carry words); keyboard focus reaches every dot and bar's detail.

## 8. Calls I made without the owner (please check)

- **C1.** Free type is the default mode and range is 4 weeks (the owner asked for free-type wpm by day), with Everything and Chapter tests one click away.
- **C2.** Left-early runs count for time and strokes but not for wpm, accuracy, steadiness, the ladder or the plateau rule.
- **C3.** Weeks start on Monday; "this week" is Monday to now.
- **C4.** Rhythm definitions: gap = time since the previous stroke; breaks over 10 s are ignored; stall = more than 2.5 times the typical gap and at least 1 s; steadiness is a robust 0 to 100 score; no score under 10 gaps. The owner can tune the 2.5 and the 10 s later.
- **C5.** Thresholds for being honest with small data: a figure needs 3 runs; a key needs 30 required presses; a mix-up needs 3 occurrences.
- **C6.** Plateau rule (5 of the last 14 days practiced, under 3% gain on the previous 14 days) and its quiet wording; dismissible for the week.
- **C7.** The month report's numbers are computed live and never stored; the owner's notes live in `data/reports/YYYY-MM.md`.
- **C8.** Delivered in two steps so the owner can use the page early: **M6a** (the stats route, the Progress tab with panels 1 to 9 and Rhythm in both places) and **M6b** (the plateau notice and the month-end report with notes). Each has its own plan and review.
- **C9.** Mix-ups are derived from missing and extra keys within one stroke (the earlier spec §10 leaves the derivation to the builder).

## 9. Left to the builder

The SQL and the aggregation structure, the steadiness formula within §5's properties, chart geometry and styling within the app's look, the exact shading steps, the route shapes beyond §6, fixtures and test design, naming.

## 10. Amendments to the earlier spec

- §4.4: the M6 views are the Progress tab and the month-end report described here.
- §9: M6 is delivered as M6a and M6b (C8). M5b (briefs memory) and M7 are unchanged.
- §11: add C1 to C9 above.
