# M2 checks on the real board

Only the owner can do these, on the real Uni v4. Layout was only checked in headless screenshots, so check how it reads as well. Start the app with `npm start` and use a Chromium-based browser.

1. **Timed free type.** Practice, free type, 30 seconds. The count does not start until your first stroke; then it counts down and the run ends cleanly with a result card.
2. **Unplug during a timed run.** Unplug the board mid-run: the count freezes and the banner appears. Replug: the board reconnects with no click, the count resumes, and no phantom stroke is counted from a half-held chord.
3. **Word-count free type with a chapter source.** Run 25 words from a chapter source (practice lists of Chapters 5 and up; the source list shows the chapters your build has) and from the Chapter 4 pseudo-words. Every word comes from that source, and the run ends with a result card.
4. **Leaving early.** Start a drill or free type, press a few strokes, then leave (Exit, Esc or another tab in the app). Switching browser tabs does not abandon a run. History lists it as `Left early` with real partial accuracy and speed. Open a drill, press nothing and leave: nothing new appears in History.
5. **Miss table.** Deliberately miss a few words, then open the test in History. The miss table's Pressed, Missing and Extra keys match what you actually pressed, and the slowest words look right.
6. **Result-card note.** Click Add a note on a result card and save one. It appears in Journal under today's date with the stamped heading, and in that day's note preview under Days.
7. **Journal text survives switching.** Type in Journal, then switch to another tab or another day and back: the text is still there. Reload to confirm it was saved.
8. **Streak.** After practicing on consecutive days, the streak shows in the status line and in Days, and goes up the next day.
9. **Plover Output on.** With Plover's Output ON, run free type: stray typed text is swallowed and nothing breaks.
10. **Comfort.** The flow line and the result card read comfortably: size, spacing and contrast at your normal distance.
11. **Hint setting.** Free type with a chapter source: set Hint to `always` and confirm the needed keys light on the board, and the notation line shows, from the start of every word. With `on miss` they appear only after a miss. Hint is not offered for the Chapter 4 pseudo-words, and with Board hidden `always` shows only the notation line.
12. **Custom amount.** Practice, free type, Mode: Custom. Type 40 with words and Start: the run is 40 words. Type 90 with seconds and Start: the countdown starts at 1:30 on your first stroke. Type a number out of range (for example 501 words or 4 seconds): Start is disabled and the range shows beneath the box.
