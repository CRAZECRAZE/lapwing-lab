# M3 checks on the real board

Only the owner can do these, on the real Uni v4. Layout was only checked in headless screenshots, so check how it reads as well. Start the app with `npm start` and use a Chromium-based browser. Several checks change your progress; `Undo` on an override and a fresh pass undo most of it, and your runs stay in History.

1. **Chapter 5 follows Stage 0.** Open Chapter 5 before passing Stage 0: its panel says `Locked until Chapter 4 is cleared`. Pass the Stage 0 test (or use `Move on anyway` on Chapter 4): the panel now says `Open`, the nav shows `✓` on Chapter 4 and Chapters 6 and up are greyed (still clickable and readable).
2. **Open anyway and Move on anyway.** On a locked chapter, `Open anyway` clears the chapter that blocks it and the panel changes to `Open`. On an open chapter that is not cleared, `Move on anyway` marks it `Cleared · moved on anyway` and the next chapter unlocks.
3. **Section drill from a book link.** In Chapter 5, click a practice link at the end of a section: the drill starts, runs through the whole list, and ends on a result card. Go back to the chapter: the link's row shows `last …` with your accuracy and wpm, and the panel's drill row shows the same.
4. **Chapter test shape.** Take the Chapter 5 test from the panel. It has 135 prompts: 45 words, each three times in a row. The outline stays hidden until you miss, and then shows for the rest of that word. With Hint set to `always`, the keys and outline show from the start of every word.
5. **A pass.** Run the Chapter 5 test at 90% or better and at 10 wpm or faster: the card says `Passed` and the requirement, Chapter 5 shows `Cleared · passed the test`, the card offers `Next chapter`, and Chapter 6 is open.
6. **Slow but accurate.** Run the test accurately but under 10 wpm: the card says `Not yet`, the chapter stays `Open`, nothing is cleared and the nav is unchanged; the panel's `Last` now shows this run, and the run is in History.
7. **Leaving early.** Start a test, press a few strokes, then press Esc: nothing changes in the panel (no new Last result, no clearing), and History lists the run as `Left early`.
8. **Undo.** After a `Move on anyway` or `Mark as read`, click `Undo`: the chapter is open again (not cleared), the `✓` goes, and the chapters ahead that depended on it grey again.
9. **Where you are.** The Practice tab's `Where you are` shows the first chapter from 4 on that is not cleared, with its panel, and moves on as you clear chapters. `Go to Chapter N` opens that page.
10. **Locked drill link.** With a chapter locked, click one of its practice links: instead of the drill you get a notice naming the blocking chapter and what it asks for, with `Go to Chapter N` and `Open anyway`; `Open anyway` starts the drill.
11. **Chapters 12, 14 and 17.** Do each section drill once at 90% or better (Chapter 12 has 2, Chapter 14 has 2, Chapter 17 has 7): the ticks appear one by one in the panel, and the chapter clears after the last one. A drill below 90% does not tick.
12. **Chapters 18 and up.** `Mark as read` clears the chapter and `Undo` reopens it; there are no drills there yet.
13. **Comfort.** The chapter panel, the practice rows in the text, the locked notice and the `Where you are` panel read comfortably: size, spacing and contrast at your normal distance, and nothing crowds the text on a narrow window.
