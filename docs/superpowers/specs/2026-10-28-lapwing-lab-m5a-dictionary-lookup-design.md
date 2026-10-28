# Lapwing Lab M5a: the dictionary lookup (design)

Date: 2026-10-28. Amends `2026-10-27-lapwing-lab-design.md` (§3.3 item 1, §4.3, §9, §11). Everything in the earlier spec still holds unless this document says otherwise.

## 1. Intent

The owner is learning steno from the book *Lapwing for Beginners* and asks "how do I write this word?" all day. Today Lookup (M4) only knows what the book teaches. M5a gives Lookup the whole official Lapwing dictionary, so that for any word the owner sees **every way it can be written**, one under another, shortest first, as Plover's suggestions panel does.

The owner's stance, in their words: "there isnt one correct way in steno", "i want to see all options", "dont guess, lets me judge", "show everything from day one . total control - its up to me how i learn it". The design follows from that: Lookup informs, it never advises, ranks by taste, hides or hand-holds.

## 2. Goals, non-goals, anti-goals

**Goals**
- Search any word in the official Lapwing dictionary and list all its outlines, shortest first.
- Search any outline (or a part of one) and list what it writes.
- Tell the owner, exactly and only, where the book teaches an outline (chapter and kind). That label comes from the book's own tables, never from a guess.
- Work offline, start instantly, cost nothing until the first Lookup open.

**Non-goals (not in M5a)**
- Spaced repetition of briefs (M5b, its own milestone).
- Importing, merging or reading the owner's own Plover dictionaries. The owner chose this on purpose: their own entries can reflect habits they do not want Lookup to echo.
- Classifying outlines as "brief", "write-out" or "in between". No heuristic labels at all.
- Editing the dictionary, adding entries, or any write to `data/`.
- Javelin or modifier dictionaries (see call C3).

**Anti-goals (failure even if it works)**
- Hiding an entry because the owner has not reached its chapter, or listing one outline as "the" answer.
- A label that claims more than the data says.
- Any network access while the app runs, or any change to the owner's `data/`.

## 3. What the owner decided

1. Every outline for a word is shown, not one.
2. Order: shortest to longest, like Plover.
3. No write-out/in-between guessing. The only label is the book's (chapter, and what kind of book mention it is).
4. No "taught so far" limit in Lookup: everything from day one. The `Include later chapters` checkbox is removed from Lookup (the Briefs tool keeps its own; see C8).
5. Source: the official Lapwing dictionary, pulled from the upstream repository, not the owner's stack.

## 4. Behavior

**Search.** One box, as today. The query is matched without regard to case.
- A word-like query matches translations: exact matches first, then those that start with the query, then those that contain it. Within a group, shorter translations first, then alphabetical.
- A steno-looking query (existing `looksLikeSteno` rule) is matched against outlines: exact outline first, then outlines starting with it, then containing it. Each hit lists the translations that outline writes.
- Empty or whitespace-only query: the existing "Start typing" message. Very long queries are accepted and simply find nothing.
- Results are cards, 30 at a time with a `Show more` button that adds 30 more. The count line says how many matched in total.

**A result card** shows the translation, then one row per outline, one under another:
- Ordered by stroke count (fewest first), then number of keys pressed (fewest first), then alphabetical. Deterministic.
- Each row shows the outline as stroke chips (reuse the Lookup chips and the small board preview that lights the hovered or focused stroke).
- A row that the book teaches carries `Chapter N` plus the book's kind(s): `practice list`, `brief`, `example` (merged by outline and chapter as in M4; one row never repeats). Rows the book does not mention carry nothing.
- A row that comes from a file other than the main dictionary carries a small muted tag from the data: `UK`, `names`, `numbers`, `commands`, `movement`. (Exact, because it names the file.)
- When the same outline has different translations in different files (for example `TKEFS` writes `defense` in the main file and `defence` in the UK file), each translation shows it on its own card.

**Plover syntax.** Dictionary translations such as `{^}.sh`, `{.}` or `{#Shift_l(Home)}` are shown exactly as stored, in monospace, so nothing is lost. Where the book names the outline (the generated drills of Chapters 18, 20 and 21 know letters, digits, punctuation and commands by name), that name is searchable and shown beside it: searching `enter` or `comma` finds the book's entry. This replaces the M4 leftover "Lookup does not index the generated drill lists".

**Not found.** Shows `Not in the dictionary.` and, because the owner may still need to write it, a muted line "Fingerspell it:" with the fingerspelling strokes of its letters (from the Chapter 18 lowercase table). Only offered for queries made of letters.

**Loading.** The dictionary file is fetched once, on the first Lookup open, and cached for the session (the same cache pattern as the M4 tools). While it loads the search box is already usable and shows `Loading…`; failure shows `Couldn't load the dictionary.` and `Try again`. It is never fetched by the reader or drill screens.

**Unchanged.** Key chart, Briefs, Notes, the dock keys, the drill pause. The Lookup tool keeps its title, key (`/`) and drawer.

## 5. Data

- Vendor the upstream dictionaries into `content/lapwing-dictionary/`, committed like the book, with `SOURCE.md`, `PINNED_COMMIT` and the upstream `LICENSE` (the upstream repository, `https://github.com/aerickt/plover-lapwing-aio`, is MIT licensed). Files: `lapwing-base.json`, `lapwing-uk-additions.json`, `lapwing-proper-nouns.json`, `lapwing-numbers.json`, `lapwing-commands.json`, `lapwing-semi-modal-movement.json`, all from `plover_lapwing/dictionaries/`. Pinned commit at the time of writing: `4ac5d53cf039a2b1f4c484456663c85e7df4e859`. A script `npm run sync:dictionary` fetches a given commit (like `sync:book`; refuses anything but a full 40-hex hash). Tests never touch the network.
- Measured on those files: about 144,000 outline entries, about 58,000 distinct translations, 36,000 of which have more than one outline; a compact word→outlines index is about 3.3 MB. 13 outlines have different translations in different files.
- The content build adds `content/build/dictionary.json`, a compact index with the source-file tag per outline, with a size guard (built as 8 MB, well above the size of the real build, 5,222,722 bytes).
- The M4 book index (`lookup.json`) was retired in this milestone (C16): the chapter labels are baked into `dictionary.json` at build time, along with the outlines. The generated drill lists (Chapters 18, 20, 21) are added to the book labels as `practice list` entries so that names like `Enter` and `Comma (,)` can be found.

## 6. Constraints

- Offline, local, private repo; `data/` is never read or written by this feature.
- Client bundle stays free of `node:*` and of server code (type-only imports).
- The dictionary file is fetched lazily; the app's start-up cost does not grow.
- Searching must stay instant on every keystroke on a 58,000-word index (set a ceiling in tests, for example a typical query under a few milliseconds on the build machine, measured not assumed).
- Same code style, token-only CSS, calm and dark, no emoji.

## 7. Calls I made without the owner (please check)

- **C1.** Vendor and commit the dictionary (about 5 MB of JSON) like the book, instead of downloading it at install time. This keeps the app fully offline and reproducible.
- **C2.** `Show more` in steps of 30 instead of raising the cap, so common prefixes (`cat` starts 98 translations) do not flood the drawer but nothing is ever out of reach.
- **C3.** The file set follows the dictionaries the book's Appendix C lists for the Plover (not Javelin) set-up: base, UK additions, proper nouns, numbers, commands, semi-modal movement. Left out: the two modifier dictionaries (they ship as Python files for Plover), the Javelin-only additions, and `lapwing-prefixed-proper-nouns.json` (not on the book's list). Say if you want any of them.
- **C4.** Source-file tags (`UK`, `names`, `numbers`, `commands`, `movement`) on non-main outlines. They are facts about the file, not advice.
- **C5.** Raw Plover syntax is displayed as stored; a plain-English name is added only where the book itself names that outline.
- **C6.** Fingerspelling hint for not-found words (was in the earlier spec §4.3).
- **C7.** Sorting by stroke count, then keys pressed, then alphabetical.
- **C8.** The Briefs tool keeps its `Include later chapters` checkbox for now; it is a separate tool with a different purpose (the book's own brief tables up to the current chapter). Say if you want it to show everything too.
- **C9.** First commit on the new branch: `scroll-padding-top` from 6rem to 8rem in `src/ui/dock.css` (the M4 leftover).

## 7a. How the book labels and the dictionary fit together (builder-check rulings; also my calls)

- **C10. A card is one exact translation string.** `defense` and `Defense` are two cards; matching ignores case, and a card whose text matches the query exactly (same case) sorts first among equals. The card's translation is always the dictionary's own text.
- **C11. The join rule.** A book entry (practice-list word, brief, example, generated drill item) attaches its `Chapter N` label to a dictionary row when the outlines are equal **and** the book's word text equals the card's translation after trimming and ignoring case. Nothing attaches by outline alone, so a label never lands on a different translation that merely shares the outline.
- **C12. Book entries whose text is not a dictionary translation** (names and descriptions such as `Enter or Return`, `Comma (,)`, `a^`, `pre-`) become their own cards, titled with the book's text, with the book's outline rows and `Chapter N` labels. Under each such row a muted line says "The dictionary writes this outline as:" followed by every translation the dictionary has for that outline, shown as stored. If the dictionary has none, the line says `not in the dictionary`. Named cards merge by the exact trimmed text (so the book's `a` and `A` stay two cards, like C10).
- **C13. Book entries whose outline is missing from the dictionary** are still shown, on the card for that word (or their own card), marked `book only`. Total control means the owner sees everything the book teaches; the mark tells them the dictionary does not have it.
- **C14. Query kinds.** As in M4: an upper-case steno-looking query (existing `looksLikeSteno` rule, unchanged) searches outlines first and then words, in that order, in one list; anything else, including lower-case `tkad`, searches words only.
- **C15. Outline search.** A card matches when any of its outlines equals the query, or starts with it, or has a stroke boundary after which the rest starts with it (so `TK` matches `TKAT` and `-T/TKAT` but not `-T/KAT`). Cards are ordered: exact outline match, starts-with, contains; inside a group by the shortest matching outline (fewest strokes, then fewest keys), then alphabetically. A card shows all of its outlines in the normal order; the matching ones are emphasised.
- **C16. Where the join happens.** At build time. `content/build/dictionary.json` carries the book labels, the book-only rows and the book-named cards, so Lookup fetches that single file on first open. The M4 `lookup.json` and its `searchLookup`, if nothing else uses them afterwards, are removed in the same milestone (the builder verifies nothing else depends on them). One size guard, on `dictionary.json`.
- **C17. Tags when a pair is in several files.** A row shows a tag for every non-main file the exact (translation, outline) pair is in. A pair only in the main file shows no tag; a pair in the main and UK files shows `UK`.
- **C18. Fingerspelling hint** only for a query that is a single run of lower-case letters.
- **C19. The book's names for keys and commands never join dictionary words (ruling after Task 4).** The generated drill lists whose items are names of things rather than words (`18-lowercase`, `18-numbers`, `18-uppercase`, `20-commands`, `20-punctuation`) always become named cards (C12), even when the name equals a dictionary word: the book's `Enter` is the Enter key, not the word `enter`, so its outline `R-R` must not show as a "book only" row on the dictionary card `enter`. The generated list `21-uk-spellings` holds real words and joins like any other list (C11, C13).
- **C20. A book-only row says what the dictionary does with that outline (ruling after the Task 4 review).** A `book only` row (C13) whose outline the dictionary holds under other translations carries them as `w`, shown with the same muted line as a named card ("The dictionary writes this outline as: ..."). So the book's period brief `.` / `TP-PL` shows `book only` plus `{.}`, not a bare claim that the dictionary lacks it. A book-only row whose outline the dictionary does not hold at all has no `w` and shows only `book only`.
- **C21. The book's example parser must not read "Also" as a word (ruling after the Task 4 review).** Chapter 12's sub-bullets "Also `HR*EUS`" and "Also `TH*EURS`" describe `list` and `thirst`; they are not examples for the word `also`. The example parser drops them (this also fixes the same wrong hits in the M4 `lookup.json`, which was retired in this milestone).
- **C22. Fingerspelling hint length (implementation choice during the build).** The hint is skipped for a query longer than 40 letters, so a pasted paragraph does not draw thousands of chips; such a query shows only `Not in the dictionary.` (`MAX_FINGERSPELL` in `src/ui/tools/Lookup.tsx`).

## 8. Left to the builder

Index schema and file layout, search data structures, how stroke counts and key counts are computed, chip and card styling within the existing look, the exact size guard, test fixtures, naming.

## 9. Amendments to the earlier spec

- §3.3 item 1: Lookup searches the full official Lapwing dictionary with no chapter limit; book labels only.
- §4.3: replace "merged Lapwing dictionary (the owner's real Plover stack…) and labels each result *Book brief* / *Derivable from rules* / *Not in dictionary*" with the behavior in §4 above. The known test cases stay: `especially` writes `EPS`, `ES/PERB/HREU` and `ES/PERBL/KWREU`; `the` writes `-T`.
- §9: M5 is split. M5a: dictionary lookup (this document). M5b: briefs memory (SRS), designed later. M6 and M7 unchanged.
- §11: add C1 to C22 above.
