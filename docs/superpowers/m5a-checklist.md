# M5a checks on the real board

Only you can do these, in a real browser, and a few on the real Uni v4. The searching and the data were checked by the tests and by running the search over the real built file, so everything here is about what it looks and feels like, and whether the answers match what you know. Nothing could be checked here for: how the drawer looks and scrolls in Chromium, how it feels on a narrow window, how long the first `Loading…` lasts on your machine (on localhost it may be too short to see), and anything with the board plugged in. Start the app with `npm start` (it rebuilds the content, so the dictionary file is fresh) and use a Chromium-based browser.

Nothing in this milestone touches `data/`: you can look words up as much as you like. Lookup never reads your own Plover dictionaries; it only knows the official Lapwing dictionary that came with the app.

## Opening it

1. **Open with `/`.** Open any chapter page and click on blank text (not in a box). Press `/`: Lookup opens at the right and its box has the focus. The first time, it may show `Loading…` for a moment; either way you can start typing at once, and the results appear when it is ready. Press Esc: it closes.
2. **Second open is instant.** Press `/` again: there is no `Loading…` this time.

## Words

3. **`cat`.** Type `cat`. The count line says how many matched (a few hundred). The first card is `cat`, with `KAT` and `Chapter 5 practice list`. Hover `KAT`: the board shows it.
4. **`the`.** Type `the`. The first card is `the` with `-T`, which carries `Chapter 5 brief` (with the book's note) and `Chapter 16 practice list`.
5. **`especially`.** Type `especially`. One card, three outlines, one under another, shortest first: `EPS`, `ES/PERB/HREU`, `ES/PERBL/KWREU`. None of them has a chapter label, because the book does not teach them for this word.
6. **`mistake`.** Type `mistake`. The first card has `SPHAEUBG` and `PHEUS/TAEUBG`; the second row says `Chapter 13 example`. Compare the order with what you would expect: fewest strokes first, then fewest keys.
7. **A word with a label.** Type `dad`. The first card shows `TKAD` with `Chapter 5 practice list, example`. Rows without a label have nothing after the outline.
8. **A UK spelling.** Type `centre`. Rows from the UK file carry a small `UK` tag. Type `defense` and then `defence`: each is its own card, and `TKEFS` appears on both.
9. **`Show more`.** Type `cat` again and scroll to the bottom of the cards: there are 30 and a **Show more** button. Press it: 30 more are added and the first 30 stay where they are. Keep pressing until the button goes away at the last card.

## Strokes

10. **`TKAD` in capitals.** Type `TKAD`. The first card is `dad`, and its `TKAD` row has a bar at its left edge (that is the row that matched). Cards below it start with that outline (`dads`, `daddy`).
11. **A partial outline.** Type `TK`. The first card is `did`, whose `TK` row is marked; the cards that follow have outlines that start with `TK`.
12. **Lower-case is a word search.** Type `tkad` (lower case). No cards: `Not in the dictionary.` and a line `Fingerspell it:` with `T*`, `K*`, `A*`, `TK*`. Lower-case text is always read as a word, never as strokes.

## Names, syntax and book-only rows

13. **`Enter`.** Type `enter`. The cards `enter` and `Enter` are both in the list; the second says `from the book`, shows `R-R` with `Chapter 20 practice list`, and a muted line `The dictionary writes this outline as:` followed by `{^~|\n^}` in monospace.
14. **`Comma`.** Type `comma`. Among the cards is `Comma (,)`, `from the book`, with `KW-BG`, `Chapter 20` and `{,}`. Type `KW-BG`: the cards `,`, `{,}` and `Comma (,)` are among the four that come up.
15. **Plover syntax.** Type `{.}`. The card is shown as `{.}` in monospace with `TP-PL`: nothing is hidden or rewritten. Type `#Shift_l`: the `{#Shift_l(...)}` entries are listed in monospace, with `movement` and `commands` tags.
16. **`book only`.** Type `subway`. The `subway` card has `SUB/WAEU`, marked `book only` and `Chapter 13 example`, and `SUB/WA*EU` below it with no label. `book only` means the book teaches that outline for that word and the dictionary does not have it. Check that you can still read the row.
17. **The period.** Type `.`. The card `.` has `TP-PL` with `Chapter 5 brief`, `book only` and `The dictionary writes this outline as: {.}`.

## Not found

18. **A made-up word.** Type `qzxv`. It says `Not in the dictionary.` and, under it, `Fingerspell it:` with `KW*`, `STKPW*`, `KP*`, `SR*`. Hover one of them: the board shows that letter.
19. **Something that is not letters.** Type `qz1`: `Not in the dictionary.` and no fingerspelling line.

## Comparing with your own habits

20. **Your words.** Type five or six words you really write, especially ones where you use a different outline from the one the book teaches. Look for: your outline is in the list (it may carry no label, or a tag), nothing is missing that you expected, and nothing is hidden because of the chapter you are on. Tell me any word where Lookup lists something you would not want to see, or lacks an outline you know exists in the official dictionary. (Your own Plover dictionaries are not read, so an outline only you have will not be there. That is on purpose.)
21. **Chapters ahead.** Type a word that only a later chapter teaches (say a word from Chapter 15 while you are at Chapter 5): it is listed straight away, with its chapter in the label. There is no `Include later chapters` box any more in Lookup.

## In a drill

22. **The dock still works mid-drill.** Start any drill. Press `Alt+/`: Lookup opens and the drill says `Paused while a tool is open`. Search `cat`: the results come up as usual.
23. **Typing does not reach the drill.** With Lookup open in the drill, type a word into the box: the letters appear only in the box, and the drill's word and count do not change.
24. **Esc closes only the tool.** Press Esc: Lookup closes and you are still in the drill; the next Esc exits the drill as before.

## The drawer with a lot of cards

25. **Scrolling.** Type `a` (over thirty thousand matches; 30 show). Scroll the drawer down: the small board and stroke stay at the top while the cards scroll under it, and they do not cut the text off.
26. **Tab upward.** Click into the cards, press Tab a few times, then Shift+Tab back up: the outline that has the focus stays visible below the board, not hidden under it. Press **Show more** a couple of times and do the same.
27. **A narrow window.** Make the window about 400 px wide or less, open Lookup and search `cat` and `especially`: nothing runs off the side, the outline chips and tags wrap onto the next line, and the board is still reachable. A long card such as `mistaken` (four outlines) is still readable.
28. **Reading comfort.** At your normal distance, check that the rows are readable: the muted `Chapter`, `UK` and `book only` text has enough contrast, and the cards are not crowded. Tell me what to change.

## Offline

29. **No network needed.** Disconnect from the network (or stop the Wi-Fi) and reload the app, then open Lookup and search: it still works (the dictionary is served by the local server).
30. **When the server is down.** Reload the app, then stop the server (Ctrl+C in its terminal) without opening Lookup first, and open it: it says `Couldn't load the dictionary.` with **Try again**. Start the server again (`npm start`, or `node server/main.ts`) and press **Try again**: the dictionary loads and what you typed in the box is still there. (Once Lookup has loaded in a page, it keeps the dictionary until you reload.)
