# M4 checks on the real board

Only the owner can do these, on the real Uni v4. Layout was only checked in headless screenshots, so check how it reads as well. Start the app with `npm start` and use a Chromium-based browser. Some checks change your progress (a drill passed, a note written); your runs stay in History and `Undo` reverses a mark.

Keyboard note: the bare `/` key must be typed without Shift, so on a layout where `/` needs Shift (German, for example) it does nothing; use the **Lookup** button or `Alt+/`. `Alt+/` goes by the physical key, so on such a layout it is the key in the `/` position of a US keyboard. If neither works, tell me which layout you use.

## The dock

1. **Keys in the reader.** Open any chapter page and click on blank text (not in a box). Press `/`: Lookup opens at the right and its search box has the focus. Press Esc: it closes. Do the same with `K` (Key chart), `B` (Briefs so far) and `N` (My notes).
2. **Buttons.** Click **Lookup**, **Key chart**, **Briefs** and **Notes** in the top bar, on the Book tab and then on History: each opens its tool, clicking the same button again closes it, and clicking another button switches tools.
3. **Typing is safe.** With the Lookup box focused, type `kbn/`: the letters go into the box and nothing else opens.
4. **Mid-drill, Alt keys.** Start any drill (a Stage 0 drill or a section drill). Press `Alt+/`: Lookup opens and the drill says `Paused while a tool is open`. Press `/` or `K` with the drill focused: nothing opens.
5. **The pause is real.** While a tool is open, press strokes on the Uni: nothing is counted and the drill does not move. Close the tool, wait a few seconds, then finish the drill: the speed on the result card is not dragged down by the seconds the tool was open.
6. **Esc closes only the tool.** In the drill with a tool open, press Esc: the tool closes and you are still in the drill, and the next stroke you press counts. A second Esc exits the drill as usual.
7. **No typing into the drill.** With `Alt+/` open, type a word into the Lookup box: the letters appear only in the box, and the drill's word and count do not change.
8. **Stray Space or Enter.** With Plover's Output on, open a tool in a drill and press a few strokes: the board's output can press a focused drawer control (for example **Close**) because the drill's own key catcher is not focused while the drawer is open. This is a known limit; tell me how often it happens in practice.
9. **While a dialog is open.** On a locked chapter click **Open anyway** (or **Move on anyway** on an open one) and, with the "Are you sure?" dialog open, press `K` and `Alt+K`: no tool opens. Cancel the dialog.

## Lookup

10. **Finds a word.** Open Lookup and type `cat`: Chapter 5 is among the hits, with an outline you can press. Hover the outline: the board shows it.
11. **Finds a stroke.** Type `TKAD` (capitals): `dad` is among the first hits, with `Chapter 5`.
12. **Hides later chapters.** While you are before the end of the book, search for a word that only a later chapter teaches (say one from Chapter 15 when you are at Chapter 5): `Nothing found in Chapters up to N.` with an **Include later chapters** button. Tick the box (or press the button): the hits appear, each marked `later in the book` and naming its chapter.
13. **Scrolling a long result list.** Type a single letter, such as `a`, so 30 results show. Scroll the drawer down: the small board and stroke at the top of the results stays in view while you scroll, and does not cover the text it describes.
14. **Tabbing upward.** Click into the results and press Tab a few times, then Shift+Tab back up: a focused outline can be partly hidden under that sticky board at the top. This is a known open follow-up; tell me if it gets in the way.

## Key chart

15. **Hover lights the key.** Open Key chart and hover a row, for example `S-` and `-R`: that key lights on the board above the list. Tab to a row: the same.
16. **The sounds match the book.** Compare the left-hand and right-hand sounds with the table in Chapter 5, and the vowels with the vowel sections. Say if a key's sounds are missing, wrong, or hard to read.
17. **The board fits.** The board here is large (about 374 px wide). At your usual drawer width, check that all of it is visible with no sideways scrolling and nothing cut off on the left. Then make the window narrow (about 400 px wide or less) and check again; say if it overflows.

## Briefs

18. **Filter.** Open Briefs and type `the`: only briefs with that in the word, an outline or its explanation remain, grouped under `Chapter N` headings.
19. **Grouping and limit.** With the box off, you see only chapters up to your current one and the count says how many in later chapters are hidden. Tick **Include later chapters**: later groups appear.

## My notes

20. **Survives switching.** Open Notes, pick Chapter 5, type a line. Pick Chapter 6, type a different line, then pick Chapter 5 again: your first line is there. The picker now says `has notes` next to Chapters 5 and 6 the next time you open Notes.
21. **Survives a reload.** Wait until it says `Saved`, reload the page, open Notes on Chapter 5: the text is there. The file is `data/notes/ch05.md`; you can open it in any editor.
22. **A failed load never overwrites.** Stop the server (Ctrl+C in its terminal), open Notes and pick a chapter: it says `Couldn't load your notes for Chapter N.` with **Try again**, and you cannot type into the box. Start the server again and press **Try again**: your text returns. Check the file in `data/notes` was not emptied.
23. **A failed save retries.** Type in a note, stop the server, type some more: it says `Not saved — will retry`. Start the server again: it goes back to `Saved` and the reload keeps the text.

## Generated drills

24. **Chapter 18.** Open Chapter 18: the panel lists three drills (`18-lowercase`, `18-numbers`, `18-uppercase`) and no test.
25. **Fingerspelling.** Start `18-lowercase`: the prompts are letters (`a`, `b`, ...) and the strokes are the starred ones (`A*`, `PW*`, ...). Run it at 90% or better once: it ticks in the panel. A run below 90% does not tick.
26. **Capitals and numbers.** Do the same with `18-uppercase` (prompts `A`, `B`, ...) and `18-numbers`. After all three are ticked, Chapter 18 shows `Cleared` and the chapter after it opens. It no longer asks for `Mark as read`.
27. **Chapters 20 and 21.** Chapter 20 has two drills (`20-commands` and `20-punctuation`, prompts like `Comma (,)`) and Chapter 21 has one (`21-uk-spellings`). Each clears its chapter once done at 90% or better. Chapter 19 still clears by `Mark as read`.
28. **Free type.** On the Practice tab, a Free type source for Chapter 18 or later now includes letters and punctuation names among its words. Say if that is unwelcome.

## Comfort

29. **Reading comfort of the drawer.** Open each tool: size, spacing and contrast at your normal distance read comfortably, the drawer does not cover more of the page than you want, and it works at a narrow window (the top-bar buttons are all reachable, and nothing runs off the side).
30. **Tool buttons at a narrow width.** At about 360 px wide the four buttons may need scrolling in the top bar. Say if one is hard to reach.
