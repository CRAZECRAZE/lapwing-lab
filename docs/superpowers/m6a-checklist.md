# M6a checks on your real history

Only you can do these, because they compare the Progress page with what you remember and with the other tabs on your real history, in a real browser. What was checked here: the calculations (by the tests, by independent re-computation and by a fake archive with about twelve weeks of made-up practice; the numbers were verified against that fake archive only), the screens at a normal and a narrow width in headless Chromium, and that the page reads from the archive and writes nothing. What could not be checked here: whether the numbers are right for your own runs, whether the weakest keys are the keys you really miss on your board, how long the page takes with your full history, and how it reads at your distance and in your light. Start the app with `npm start` and use a Chromium-based browser. Nothing in this milestone writes to `data/`, so you can open and switch things as much as you like.

Words used below: a **run** is one test in History (a free-type run, a drill or a chapter test). **Finished** means it was not left early and was not cut off by closing the tab.

## Opening it

1. **Open Progress.** Click **Progress** in the top bar (the fifth tab). The page opens on `4 weeks` and `Free type`. After a moment you see four tiles, then the panels in this order: Free-type wpm by day, Accuracy and consistency, Rhythm, Practice time per week, Weakest keys, Mix-ups, Chapter tests, Practice (all modes). Reload the page: the same numbers come back.
2. **Your recent days are there.** Look at the days you remember practicing in the last four weeks. Each has a dot in the wpm chart (if you did a free-type run that day) and a bar in the weekly panel. A day you did not practice has no dot. Tell me if a day you know you practiced is missing, or a day you did not practice has a dot.

## The numbers against the other tabs

3. **Wpm for a day you remember.** Pick a day with exactly one free-type run. In the wpm chart hover or Tab to its dot: the note says the day and `... wpm over 1 run`. Open **History**, open that run: its speed is the same, but History shows it as a whole number and Progress shows one decimal (16.2 wpm there, 16 wpm in History). If the day had two or more runs, the dot is the average of them, counting the run with more words more.
4. **Accuracy the same way.** In the same run, History shows an accuracy in whole percent; the Accuracy and consistency chart (hover the dot of that day) shows it with one decimal. They should agree after rounding.
5. **Time and strokes against Days.** Open the **Days** tab on this month. Note the line under the calendar (`N days practiced · X · N tests`). Go back to Progress and open **Show the numbers** under `Practice, all modes` at the bottom: add up the `Time` of this month's days. It matches the Days total to within about a minute for each day you add (the table rounds each day down to whole minutes, and Days rounds the month's total down once). Then pick one day on Days and add up the strokes shown on each of its test rows; that is the `Strokes` figure for that day in the table.
6. **The tiles against the weekly numbers.** Open **Show the numbers** under `Practice time per week`. The last row is `(so far)`: it is this week, Monday until now. Its time and strokes are the `This week` tile and the `Strokes this week` tile. The line under the strokes tile (`... all time`) is every stroke ever recorded.
7. **Left-early and unfinished runs count for time and strokes.** If you remember leaving a drill early (it says `Left early` in History), check that its strokes are in the strokes figure of that day, and that its speed is not in the wpm chart. That is on purpose: time and strokes count everything, speed and accuracy count only finished runs.
8. **The streak.** The `Current streak` under the heatmap equals the `Streak` line on the Days tab, and the `Longest streak` is the longest run of days in a row you remember from the last year.

## The switches

9. **Mode.** Click `Drills and tests`, then `Everything`, then back to `Free type`. Only these change: the two speed and accuracy tiles, the wpm chart (its title changes), Accuracy and consistency, and the Rhythm panel (its list of runs). These do not change: the `This week` and `Strokes this week` tiles, the weekly bars, Weakest keys, Mix-ups, Chapter tests and the heatmap (their titles say `all modes`, or `ignores the mode switch`).
10. **Range.** Click `3 months`, then `All time`, then back to `4 weeks`. The wpm chart, the accuracy chart, the weekly bars, Weakest keys and Mix-ups change (the last two say `last 3 months` or `all time`). The tiles, the Rhythm panel, Chapter tests and the heatmap do not change. With `All time` the weekly bars start at the first week you ever practiced.
11. **Nothing flickers wrongly.** While a switch loads you may briefly see `Loading…`; the old numbers are not shown under the new switch. If you ever see numbers that belong to the other setting, tell me.

## The trend line

12. **Trend against the tile.** In the wpm chart find the dashed line and read its last value (hover or Tab to the last dot, or open **Show the numbers**: the last `Trend (7-day average)`). Compare it with the `Free-type 7-day average` tile. They may differ by a little, and that is on purpose: the dashed line gives every day the same weight (the chart says `each day counts once` under it), and the tile weighs each day by the words you typed.

## Rhythm in History

13. **A finished run.** Open **History**, open any finished run. Under the numbers there is a `Rhythm` section with four figures (Steadiness out of 100, Stalls, Typical gap, Start vs finish), a strip with one bar per stroke, and a chart of the speed in each quarter. A run with fewer than 10 strokes says so instead of a steadiness score.
14. **The tallest red bar is a pause you remember.** In a run where you remember stopping to think or looking away, find the tallest red bar (a stall): hover or Tab to it. The note says `Stroke N: ... pause, stall`. Its stroke number should fall where you hesitated (the strip counts strokes from the left, including misses and retries). A bar is red only when the pause is more than 2.5 times your typical gap and longer than one second.
15. **The break marker.** In a run where you left the keys for more than ten seconds, you see a dotted vertical line labelled `break` at that stroke. It is not red and does not count as a stall. If you never leave a run for ten seconds, skip this check.
16. **A run left early.** Open a run that says `Left early` in History: the Rhythm section says `Rhythm is shown for finished runs.` and shows nothing else. The same for a run whose tab was closed (`Unfinished`).
17. **Estimated.** The speed in each quarter and `Start vs finish` say they are estimates, and the whole run's wpm is shown beside them `(counted by the app)`. The quarters are not expected to add up to that number exactly.
18. **The numbers behind the strip.** Click `Show the numbers` under the strip: a table of the pause before each stroke, with its kind (`normal`, `stall` or `break`).

## Rhythm on the Progress page

19. **The panel shows a run.** On Progress, the Rhythm panel shows your newest finished run of the current mode, picked in the list `Run` (the 20 latest, newest first). Choose an older run: the figures and the strip change.
20. **Open this run in History.** Click `Open this run in History` under the panel: History opens that run, and its Rhythm section shows the same figures as the panel.
21. **The pick survives a range switch.** Pick an older run, then click `3 months`: the Rhythm panel still shows the run you picked. Changing the mode, by contrast, goes back to the newest run of the new mode.
22. **Drills and tests.** Switch to `Drills and tests`: the list shows your latest drills and chapter tests, found by looking back through your history if recent runs were all free type.
23. **The day-by-day steadiness.** The Accuracy and consistency chart's bars are each day's steadiness (the middle value of that day's runs). A day with one long run has the steadiness of that run. The grey band says `Over the last 14 days your steadiness ranged from A to B` once at least five of those days have a score.

## Keys and mix-ups

24. **Weakest keys light the keys you miss.** Look at the board in `Weakest keys`. The red keys should be the keys you know you miss, and the list beside it names the worst five with the share missed and the counts (`21% missed (63 of 300)`). The colour is on a fixed scale: a key missed in a quarter of its presses or more is fully red, and a key missed in 5% is pale. A calm board means you miss few keys; it does not mean the worst key is fine, and it is not stretched to make your worst key look red. Keys with fewer than 30 presses are not ranked (the table says `too few`).
25. **Mix-ups against a run's Misses.** Open a History run with a few misses. In its `Misses` table, find a pair where you pressed one wrong key in place of the right one. Back on Progress, in `Mix-ups`, the same pair appears if you have made it three or more times (`-P instead of -B · 9 times`). Mix-ups count over every run in the period, so the number is larger than in one run. Only misses with exactly one wrong key and exactly one missing key count.
26. **A multi-stroke word.** For a word with two or more strokes, a miss is matched to the closest stroke of the word; the note under `Weakest keys` says so. If you notice a key blamed for a miss that happened on the other stroke of a word, that is this known limit. Tell me how often you see it.

## Chapter tests and the heatmap

27. **The ladder against the chapter panels.** In `Chapter tests`, each chapter row shows your best wpm and accuracy against the book's mark, and `met`, `not yet` or `not tried yet`. Compare a few rows with that chapter's panel in the Book tab (`Best` and `Last` of the chapter test): the best result matches. A chapter the app shows as cleared by a passed test is `met`. A row marked `not yet` says what it falls short of (`needs 90% accuracy`). A row can say `passed on another run` when your most accurate run was below the mark but another run passed.
28. **The ladder ignores the switch.** Click each mode switch: the ladder does not move.
29. **The heatmap against Days.** The grid at the bottom has one square per day for the last year (today at the right). Pick a month on the **Days** tab: the days that are shaded there are the shaded squares in that month of the heatmap, with the same three steps (under 10 minutes, under 30, more). Hover a square (or Tab to it and use the arrow keys): the note says the day, the time and the strokes.

## Keyboard

30. **Charts are one tab stop each.** Click in the blank space above the wpm chart, then press Tab: the focus goes to the chart's dot (one stop), not to every dot. Press the Right and Left arrows: the focus moves between dots and a note shows. Home and End go to the first and last. Press Tab again: it leaves the chart to the next one. Do the same in the accuracy chart, the weekly bars, the strip and the quarters.
31. **The heatmap.** Tab into the heatmap: one square has the focus (today). Left and Right move a week, Up and Down a day, Home and End go to the first and last day.
32. **Show the numbers.** Under every chart a `Show the numbers` disclosure opens a table of what it draws. Open one with Enter or Space. The table has the same numbers as the picture. Tell me if any picture and table disagree.

## Windows

33. **A narrow window.** Make the browser window about 420 px wide. The top bar wraps to two rows: the six tabs on the first, the four tools on the second, and Journal is visible. Nothing makes the page itself scroll sideways, and the charts shrink to the width. At 320 px the top bar still scrolls sideways a little (known). The text in the charts gets small; tell me if it is not readable.
34. **A very long run.** Open a History run with hundreds of strokes (a chapter test with many misses or a long timed free-type run can have that many). Over 300 strokes the strip is wider than the page and scrolls sideways inside its own box, with the seconds axis staying at the left while the bars scroll. Under 300 strokes it fits the page and does not scroll.

## Honest small data

35. **Few runs.** If you have a range or mode with fewer than three finished runs (try `Drills and tests` on a quiet week), the wpm chart and the accuracy chart say `not enough data yet`, and the tiles show a dash. They never show `NaN` or a made-up zero. The weakest-keys panel says `not enough data yet` if no key has been pressed 30 times.
36. **No mix-ups yet.** If no pair has happened three times, `Mix-ups` says `no repeated mix-ups yet`.

## Fresh archive (skipped)

37. **An empty archive: not checked on your machine.** The empty states (`No practice recorded yet.`, `No finished runs in this range yet.`, `No finished run yet.`) are covered by the tests only. The README documents no option to point the server at another data folder, so the only way to see them on your own machine would be to move or delete `data/`, and this checklist does not ask you to do that. Do not delete your data for this.

## Offline

38. **No network needed.** Disconnect from the network and reload Progress: it still works.

Tell me what looks wrong, what is hard to read, and any number that disagrees with what you know.
