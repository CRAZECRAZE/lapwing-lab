# Lapwing Lab M5b: the fix-up drill

Date: 2026-10-30. Builds on M5a (dictionary lookup), M6a/M6b (Progress page, key statistics, mix-ups). Next after this: M7 (routine planner, ghosts, real-text practice).

## Intent and the why

The owner learns steno on a Uni v4 with Lapwing theory and has said: "if I constantly mix up strokes there should be a test containing my top 10 most mistaken strokes, and fix them slowly. Usually I just did the briefs with the single letter strokes to drill them."

Today the app already knows what the owner gets wrong (every stroke is archived; the Progress page lists weakest keys and mix-ups) but it cannot turn that knowledge into practice. M5b closes that loop: it builds a short, slow, focused drill out of the owner's own mistakes and keeps going until each item comes out clean ten times in a row.

The owner values total control over how they learn, so everything is shown up front, every list can be edited before starting, and nothing starts or nags on its own.

## Goals

1. A **Fix-up page** with two tabs, **Words** and **Patterns**, each listing the owner's top 10 most-missed items with tick boxes (all ticked by default) and its own **Start slowly** button.
2. A **Focus drill**: one item at a time on screen, ten dots that fill with each clean answer, moving to the next item when the ten are full.
3. **Fixed status derived from history**, no new storage: an item is fixed when its latest ten attempts are all clean, whether they happened in this drill or in ordinary practice. A fixed item drops off the list and returns by itself if misses come back.
4. A fix-up run is **recorded as an ordinary run** so it counts in time and strokes on Days and Progress.
5. Entry points: a **Fix-up card on the Practice tab** and links from the Progress **Weakest keys** and **Mix-ups** panels. Not a seventh top-bar tab.

## Non-goals and anti-goals

- No timer, no speed score, no wpm judgement in the drill or its result. The owner is not graded on speed here.
- No spaced-repetition schedule, no reminders, no badges, no streaks, no auto-start. The page is something the owner opens.
- Copy never scolds or advises. It states facts ("missed 24%", "6 clean in a row").
- A fix-up run does not count towards chapter gates, the free-type wpm figures, plateau detection, or the month-end report's wpm/accuracy tiles (see "Recording"). It does count as practice time and strokes.
- The Briefs tool's "taught-so-far chapters only" limit stays as it is.
- No new settings, no new files under `data/`.

## Constraints

- Private, offline, local only; Node 26, Preact 11, plain Node `http` server, Vitest. Colours only from `:root` tokens in `src/ui/reader.css`; no emoji; layouts work down to 360 px; every visual (the ten dots) has a text equivalent ("6 clean in a row") for screen readers; Preact 11 deferred effect cleanup conventions as in M6a/M6b.
- Tests use temp dirs and never touch `data/`.
- Local dates, Monday weeks, `enough()` = 3 runs conventions from M6 apply wherever dates or run counts appear.

## What the owner decided

- **Two lists, two tabs** (Words and Patterns), each with its own Start button. Not one mixed ranked list.
- The thing to fix can be a particular word *and* a particular stroke pattern across words.
- **Fixed = ten clean in a row.** A miss resets that item's count to 0 and shows the right stroke on the board.
- **Drill style = Focus**: one item until it reaches ten, then the next. Not shuffled/mixed.
- The owner may untick items before starting.

## The page

Route `/practice/fixup` (Practice top-bar tab stays highlighted, as for free-type routes). Two tabs, **Words** (default) and **Patterns**, a small tab strip in the page, not the top bar. The tab is remembered in the URL (`/practice/fixup/patterns`) so a link from the Progress panels can land on the right one.

**Words tab.** A table: tick box, word, outline (the first accepted outline), miss rate (percent), last seen (relative: today, yesterday, N days ago). Top 10 by miss rate, ties broken by more attempts, then alphabetically. Under it: **Start slowly**, which starts a Focus drill over the ticked words in list order.

**Patterns tab.** A table: tick box, the pattern in plain words (see below), number of drillable words from the owner's book lists, miss count, last seen. Top 10 by miss count. **Start slowly** drills the ticked patterns in order.

If a tab has no qualifying items, it says so plainly ("Nothing to fix here: no word has been missed often enough yet.") and has no Start button. There is no "enough data" lecture beyond that.

An unticked item is still listed (so the owner sees what they skipped) and nothing is remembered between visits: the next visit starts with all ticked again.

## What counts as an item

All of this is **my design call** unless marked as the owner's.

### Words

Source: archived strokes from the last **30 days** (local dates), from every mode (free type, section drills, chapter tests, stage 0, and earlier fix-up runs). Group by the word shown (`prompt`). A **word attempt** is one presentation of the word. It is **clean** when it was completed with no wrong stroke before it (the existing `attemptNo === 1` and correct on the completing stroke). A word attempt that needed one or more retries is a **miss**. Miss rate = misses / attempts.

A word qualifies when it has at least **5 attempts** (`MIN_WORD_ATTEMPTS`) and at least one miss, and its latest ten attempts are not all clean (i.e. it is not already fixed). Rank as above, top 10.

**Stage 0 and pseudo-words are included** (my call): the owner's own way of fixing strokes was drilling single-letter strokes and briefs, and those items are archived like any other (`prompt`, accepted outlines). The archive does not record whether a prompt was shown as a word or as a stroke. The fix-up drill infers it: when the prompt text equals its only accepted outline (stage 0 rows and pseudo-words), it is shown as a `stroke` item (target visible); otherwise as a `word` item (outline hidden until a miss, per the hints setting). Builder to confirm the rule against `src/stage0/lists.ts` and `src/freetype/free.ts`.

Multi-stroke words: the archive does not record which stroke of a multi-stroke word was attempted. A word attempt is judged as a whole; the displayed outline is the first accepted outline.

### Patterns

A **pattern** is one of two kinds, both derived with the existing `keyStats`/`nearestStroke` logic in `src/core/keystats.ts`:

- **Mix-up**: one key pressed in place of another ("-T typed for -S"), the existing `Mixup {pressed, needed}`.
- **Missing key**: a needed key not pressed ("R- missing"), from the `missed` side of `KeyStat`.

Source and window are the same 30 days. A "key" here is a `Slot` from `src/core/steno.ts`.

Both kinds sit in **one ranked list** on the Patterns tab. Because `keyStats` also adds every mix-up to the needed key's `missed` count, a missing-key pattern is counted **net of mix-ups**: only the misses where the key was left out *without* a single other key standing in for it (my call, so "-T for -S" and "-S missing" do not both report the same mistakes).

A pattern qualifies when its needed key was required at least `MIN_KEY_PRESSES` (30) times in the window, it occurred at least `MIN_MIXUP_COUNT` (3) times, and it is not already fixed. **Rank by rate**, not raw count: occurrences divided by the needed key's required presses (my call, so a key that is simply pressed often does not crowd the list; the owner asked for the *most mistaken* strokes). Ties: higher count, then key order. Top 10. The Patterns table shows both the rate and the count.

Pattern fixed-status and pattern attempts need strokes in order, so the archive read for patterns is a new ordered, ungrouped query (the grouped `keyRowsInRange` is only used for ranking).

**Words a pattern drills.** The words come from the practice lists in `content/build/practice/*.json` (63 files; each list has `items: {prompt, outlines}[]`), restricted to lists of **chapters the owner has reached** (my call, so the drill never asks for strokes the book has not taught; "reached" = the chapter is unlocked in the existing progress state, `src/state/progress.tsx`). A word is chosen when one of its accepted outlines contains the needed key (for both kinds: the needed key of the mix-up, or the missing key). Words are shuffled; **at most 12 words per pattern** (`PATTERN_WORDS`), drawn evenly across the matching lists so one list does not dominate. If fewer than 4 words match in the reached chapters, the pattern is still shown but marked "not enough words in the chapters you've reached" and cannot be ticked. The shown count on the Patterns tab is that drillable number.

### Fixed

An item (word or pattern) is **fixed** when its most recent ten attempts, across all modes, are all clean. Strokes of abandoned or unfinished runs count as attempts too (they are real attempts, and `keyStats` already counts them); a word attempt that was never completed (the run ended mid-word) is dropped. The drill's own dots always **start at 0** (my call): the owner types ten fresh clean showings in the drill even when history already shows a partial streak, so the drill is a deliberate ten rather than a hidden head start. For a pattern, an *attempt* is a stroke where the needed key was required; clean means that key was pressed and no wrong key stood in for it. Fixed status needs no stored state: it is recomputed from the archive on every visit. Old history keeps counting: an item that was fixed and then starts being missed again shows up on the list again by itself.

## The Focus drill

Reuse as much of the existing drill machinery as sensible: `DrillSession` (`src/core/drill.ts`) for matching strokes, `Board`/`DockHost`, `HintPicker` and `VisibilityPicker` pickers, and the `DrillRunner` host pattern (`src/ui/DrillRunner.tsx`). The fix-up drill is a new pure, replayable session class (name is the builder's call) that wraps `DrillSession` semantics and adds the ten-in-a-row rule.

Behaviour:

- Shows "Item N of M · K fixed", the item (the word; for a pattern drill, the word with a small tag of the pattern being drilled, e.g. "-T for -S"), ten dots, and "N clean in a row".
- A **clean answer** (the stroke(s) correct with no miss on this showing) fills the next dot.
- A **miss** resets that item's dots to 0, and shows the right stroke on the board as a miss does today (the existing `miss` result with `diff` and `expected`). The item stays on screen until it is typed correctly, but that showing does not count as clean. The owner keeps going; nothing is lost beyond the count.
- At ten, the item is marked fixed and the next item appears. After the last item the result card shows.
- The hints setting (`miss` / `always`) and board visibility pickers work as everywhere else. Undo (star) behaves as in `DrillSession`.
- Leaving early is allowed at any time (as in other drills) and the run is stored as abandoned the way existing drills are.
- Pattern drills: items are the drillable words, in a fixed shuffled order, grouped by pattern, one pattern at a time. A pattern is fixed when ten clean showings **of words containing its key** have happened in a row, counted on that pattern's words (a miss on the pattern's key resets; a miss on some *other* key in the same word also resets, because the showing is not clean). (My call: this is simpler to explain than tracking per-key cleanliness; the word is clean or not.)
- Because items repeat until fixed, the run has no fixed length. A **safety cap** ends a run after 500 showings and offers to start again (`FIXUP_MAX_SHOWINGS`), so a run cannot go on forever by accident. (My call.)

No timer is shown or measured as a score. The result card shows: items fixed, items not finished, total showings, clean-first-try share for the whole run, and time spent (a plain "Time 12:30" as other result cards have, not wpm). No wpm figure on it.

## Recording

A fix-up run is recorded like any other run: a `tests` row and its `strokes` (existing `createTestLogger`, `logTest` shape `{mode, chapter, section}`). New mode string **`fixup`**; `chapter` null; `section` is `words` or `patterns`. Run `meta` records the item list and which items were fixed (so the history detail page can name them).

Where `fixup` is and is not counted (this is a decision the builder must apply consistently):

- **Counted:** time and strokes on Days and Progress (activity, heat map), the Days run list, History list and detail (named "Fix-up (words)" / "Fix-up (patterns)"), the stroke archive that drives the weak-keys/mix-ups panels and the fixed-status calculation itself.
- **Not counted:** the drill-mode wpm/accuracy aggregation (`DRILL_MODES` in `server/stats.ts`, `src/ui/progress/useRhythm.ts`), `sectionResults`, chapter gates, plateau detection, the month-end report's wpm/accuracy tiles. Free-type wpm is untouched. The reason is that this drill is repetitive by design and slow on purpose; including it would lower the owner's wpm and accuracy figures for doing the right thing.
- The strokes of a fix-up run **do** feed `keyStats`, since a real mistake in one is a real mistake. (If that turns out to flatter the Weakest keys numbers, the follow-ups file records it.)

The abandoned rule is the same as other runs: an abandoned run keeps its strokes in the archive but is excluded from aggregates.

## Entry points

1. **Practice tab**: a new card "Fix-up" between "Where you are" and "Free type". It shows the same two facts the page leads with ("10 words, 6 patterns to fix") and a link to the page. With nothing to fix it shows "Nothing to fix right now." and still links to the page.
2. **Progress page**: the Weakest keys panel and the Mix-ups panel each get a small link "Drill these" to the Patterns tab (and, from the Mix-ups panel, the same tab). No other changes to those panels.

Both counts and lists come from one server endpoint (below) and one pure computation in `src/core`.

## Server and code shape (my suggestion, builder decides)

- `src/core/fixup.ts` (pure): types `FixupWord`, `FixupPattern`; `buildFixupLists(attempts, mixups/keyStats input, lists, reachedChapters)`; the constants `FIXUP_WINDOW_DAYS = 30`, `MIN_WORD_ATTEMPTS = 5`, `FIXED_STREAK = 10`, `LIST_SIZE = 10`, `PATTERN_WORDS = 12`, `MIN_PATTERN_WORDS = 4`, `FIXUP_MAX_SHOWINGS = 500`. Unit-tested without a DOM or server.
- `src/core/fixupdrill.ts` (pure): the Focus session class.
- `server/archive.ts`: a read that returns word attempts for a date range (one pass over `strokes` ordered by test then id, folding rows into word attempts the way `src/ui/Drill.tsx` logs them: `attemptNo`, `correct`, `prompt`) plus the grouped key rows `keyRowsInRange` already returns.
- `server/server.ts`: `GET /api/fixup` returning both lists already computed (no pagination; at most 20 items plus the pattern word lists). Practice lists are read from `content/build/practice` on the client (as `ListDrillRoute` does) so the server stays unaware of content; the endpoint returns patterns as keys (`{kind, pressed?, needed}`), and the client resolves their words.
- UI: `src/ui/Fixup.tsx` (page and tabs), `src/ui/FixupRoute.tsx`/drill host built on `DrillRunner` or a sibling of it, `src/ui/fixup.css`, route additions in `src/router.ts`, card in `src/ui/Practice.tsx`, links in `src/ui/progress/WeakKeys.tsx` and `Mixups.tsx`.

## Edge cases the builder must handle

- Empty archive, or archive with fewer than 5 attempts of any word: both tabs show the "nothing to fix" line; the Practice card says the same.
- A word seen in a mode where it is displayed several times in a row (chapter test repeats three times): each showing is one attempt.
- Stroke rows with unparseable `expected_json` are skipped, as `keyRowsInRange` already skips them.
- A word appearing in the owner's history that is no longer in any practice list (words can come from custom or pseudo sources): still listed on the Words tab (the drill needs only `prompt` and its accepted outlines from the archive row).
- Daylight saving and local dates: the 30-day window uses local dates the way `dateRange` does.
- A run left mid-way by closing the tab: abandoned, like other drills; no state to recover.
- The ten dots and the item counter are announced to screen readers ("6 clean in a row, item 2 of 10").
- Unticking everything disables Start.
- All 63 lists are available offline; if the content fails to load, the Patterns tab says it could not load the word lists and the Words tab still works.

## Left to the builder

Layout details within the conventions above; the exact relative-date wording; the session class API; whether the Words and Patterns drills share one runner; the SQL for folding rows into word attempts (the owner's real history should give the same result under replay as in a live view); performance (the 30-day read must stay quick on a database of hundreds of thousands of strokes).

## Done means

- The Fix-up page, drill, recording, entry points and tests exist and the full suite passes.
- A manual checklist `docs/superpowers/m5b-checklist.md` for the owner to try on real data (like the M6a/M6b checklists).
- README gets a short "Fix-up drill" section; follow-ups for anything left open go in `docs/superpowers/m0-m1-followups.md` under `## Left open by M5b`.
