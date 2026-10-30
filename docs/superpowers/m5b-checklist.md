# M5b checks on your real history

Only you can do these, because they compare the app with what you remember missing and with your real history, in a real browser and on the real Uni. What was checked here: the calculations (by the tests, which use temp folders and made-up strokes only, never your `data/`), and that the code reads from the archive and, in a fix-up run, writes only an ordinary run. What could not be checked here: whether the two lists match the strokes you really get wrong, whether ten clean in a row feels right as the bar for "fixed", how the drill reads at your distance, and how it behaves with a stroke you have been missing for weeks. Start the app with `npm start` and use a Chromium-based browser.

Nothing in this milestone writes anything except what any drill writes: a fix-up run is stored as an ordinary run (a row in `tests` and its rows in `strokes`, in `data/steno.db`), and changing the board or Hint picker saves `data/settings.json` as it does everywhere. The two lists are recomputed from your history each time you open them and nothing is stored for "fixed", so you can open the page and untick things as much as you like.

Words used below: a **run** is one test in History. A **showing** is one appearance of a word on the screen. A showing is **clean** when you finished it with no wrong stroke first. **Fixed** means the latest ten attempts of a word (or of a pattern's key) were all clean.

## The two lists

1. **The Words list.** Open **Practice** and click **Open fix-up** on the Fix-up card (or open `/practice/fixup`). **Practice** is still the highlighted tab and the top bar still has six tabs. The Words tab lists at most 10 words, each with a tick box, its outline, a percentage `Missed` and `Last seen`. Read down the list. These should be words you recognise as the ones you trip over; a word you hardly ever miss should not be there, and the top one should be among your worst. The percentage is misses over showings in the last 30 days, and a word needs at least 5 showings to appear. Tell me about any word that looks wrong, or any you expected that is missing.
2. **The Patterns list.** Click **Patterns**. The address becomes `/practice/fixup/patterns`. It lists at most 10 patterns, written as `-T typed for -S` or `R- missing`, with the number of words available, a rate, a count (`5 of 120`) and `Last seen`. Compare the first few with the `Mix-ups` and `Weakest keys` panels on Progress for the same period (4 weeks is the nearest; this list looks back 30 days). A pair from Mix-ups should be here as `... typed for ...`; a key from Weakest keys can be here as `... missing`. The count of a missing key leaves out the misses already counted as a mix-up, so it can be lower than the Weakest keys figure.

## Choosing what to drill

3. **Unticking.** On either tab untick two items. They stay on the list, only unticked. Untick every item: **Start slowly** goes grey and cannot be pressed. Tick one again and it works. Leave the page and come back: everything is ticked again (nothing is remembered).

## Fixing a word

4. **A word reaches ten.** On Words, untick everything except one word and press **Start slowly**. You see the word, ten empty dots, `Item 1 of 1 · 0 fixed` and `0 clean in a row`. The word's outline is hidden until you miss it (unless Hint is `always`). Type it correctly: a dot fills and the text says `1 clean in a row`. After ten clean ones the result card shows `Fixed 1`, `Not finished 0`, `Showings 10`, `First try 100%` and a `Time`. There is no wpm anywhere on the screen. Press **Back to Fix-up**: that word is gone from the list, because its latest ten attempts are all clean. Nothing was stored to make that happen; it was worked out from the ten showings in your history.
5. **It can come back.** A word that dropped off returns by itself if you start missing it again. This needs real use: if a fixed word turns up on the list some days later after misses in free type or another drill, that is it working. If it never happens, skip this check.
6. **A miss resets.** Start a run on a word and get to 3 or 4 dots. Then press a wrong stroke on purpose. The dots empty, `0 clean in a row` shows, and the board (unless the board is hidden) and the text under the word show the right stroke. Type it correctly: the word stays until you do, but that showing does not fill a dot (still `0 clean in a row`). The next clean showing fills the first dot again.
7. **A punctuation item.** If a punctuation prompt such as `Comma (,)` (`KW-BG`) or `Period (.)` (`TP-PL`, both in the Chapter 20 punctuation list) is on your Words list, drill it alone. It shows its name, accepts its stroke and fills dots like any word. If none is on your list, skip this check.

## Fixing a pattern

8. **The words come from chapters you have reached.** On Patterns, start a run with one pattern ticked. Each prompt is a word that contains the pattern's key (for `-T typed for -S`, words using `-S`). Look at the words: none of them should be from a chapter the book has not taught you yet. The label above the dots names the pattern; the dots fill when a whole word is clean, so a miss on any key of the word empties them, not only a miss on the pattern's key. A pattern with fewer than 4 matching words says `not enough words in the chapters you've reached` in the Words column and its tick box is greyed out and cannot be ticked. If none of yours is like that, skip that half.

## Leaving and the record

9. **Leaving half way.** Start a run, get a few dots, then press Esc (or Exit). You return to Fix-up. Open **History**: the run is there as `Fix-up · words` (or `· patterns`), marked as left early, with the number of strokes you typed.
10. **History shows no wpm.** Open the finished run from check 4. In the list its line reads `Fix-up · words` with the accuracy and a dash where the wpm goes; on its page the speed line is a dash, never `0 wpm`. The strokes and misses below it look like any other run.
11. **Progress speed is unchanged.** Look at Progress on `Free type` and on `Everything` before and after a fix-up run: the wpm tiles, wpm by day and accuracy and consistency should not change, since fix-up runs are left out of speed and quality. The practice time and strokes tiles, the weekly bars and the heatmap do include the run. If the `Everything` speed moves after a fix-up run, tell me.
12. **Days counts the time.** Open **Days** and pick today. The fix-up run is in the list of that day's runs with its time and strokes, the day's total time and strokes include it, and the day is shaded by that time.

## The way in

13. **The Practice card.** On Practice, the Fix-up card sits between `Where you are` and `Free type`. It reads like `10 words, 6 patterns to fix`, or `Nothing to fix right now.` once everything is fixed or too little was missed, and **Open fix-up** goes to the page either way. Its numbers match the two lists.
14. **Drill these.** On Progress, `Weakest keys` and `Mix-ups` each end with a **Drill these** link. Both open the Patterns tab (`/practice/fixup/patterns`), with **Practice** highlighted.

## The note and the cap

15. **The journal heading.** On a fix-up result card press **Add a note**, type a few words and save. Open that day in **Journal**: the heading reads like `### 14:32 — Fix-up · words` (or `patterns`), with no percentage and no wpm after the title.
16. **The 500-showing cap (you may skip this).** A run stops after 500 showings so one cannot go on by accident, and the card then says `Stopped at 500 showings.` It is hard to reach: with ten items and ten clean showings each that is 100 showings, so you would need to miss most of them to get anywhere near 500. It is tested, but I would not spend time trying to hit it by hand.

Tell me which words or patterns look wrong, anything that is hard to read, and any number that disagrees with what you remember.
