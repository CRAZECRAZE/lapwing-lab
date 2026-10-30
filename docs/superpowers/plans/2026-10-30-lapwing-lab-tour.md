# Lapwing Lab: the quick tour — design and plan

A short, website-style walkthrough of every feature. The owner asked for it in one message: "when i click ctrl + shift + t a tutorial will appear with a next and skip button, going through all the features in this project … nothing too long, just a tutorial going over all the things briefly, much like a website tutorial."

Decisions the owner did not make are marked **(my call)** and go in the hand-back.

## Behaviour

- **Open:** `Ctrl+Shift+T` anywhere in the app opens the tour at step 1. The key is matched by physical key (`e.code === 'KeyT'`, so it works on any layout), needs Ctrl and Shift and no Alt or Meta, and calls `preventDefault()` (the browser may still keep the shortcut for itself, see the risk below). Ignored while the tour is already open, and **(my call)** while a run is on screen (routes `drill`, `free`, `fixup-run`, `text-run`) so a run is never disturbed.
- **Fallback button (my call):** a small `Tour` button at the end of the top bar's tool group (with `?`-style key hint `Ctrl+Shift+T` in its title, no `kbd` chip), because browsers reserve `Ctrl+Shift+T` ("reopen closed tab") and may never hand it to the page. The button is also off on run routes.
- **Not automatic (my call):** the tour never opens by itself, not on first visit.
- **The card:** a modal over the page: a dimmed backdrop and one panel, same look as `ConfirmDialog` (reuse its tokens: `--panel`, `--line`, `--heading`, `--muted`, `--bg`; z-index above the dialog layer, 21). Contains: `Step N of M`, a title, one short paragraph (2–3 sentences, plain words), and buttons **Back** (hidden on step 1), **Skip**, **Next** (on the last step the primary button reads **Done** and Skip is hidden). Small progress dots are optional.
- **Highlight (my call, nice-to-have):** a step may name a `target` CSS selector; when the element exists, a quiet ring (`outline` on a positioned overlay box, `--link` colour, no animation) is drawn around its bounding rect and updated on resize/scroll; the card sits at the bottom centre (on narrow screens full-width at the bottom). When the target is missing, no ring and no error. No navigation: the tour never changes the page.
- **Keys inside the tour:** Esc = Skip (closes), ArrowRight or Enter-on-Next = Next, ArrowLeft = Back, Tab stays inside the card (same trap as `ConfirmDialog`), focus starts on **Next** and returns to what had it before when the tour closes. The dock's keys and Esc handling must not fire while the tour is open (the tour's keydown handler stops propagation in the capture phase, or the DockProvider ignores keys while a tour is open: implementer's choice, with a test).
- **Copy rules:** neutral, calm; never scolds or advises ("you should", "make sure"); short. Offline: no network. No new dependencies. Nothing written to `data/` or localStorage.

## Steps (copy is the implementer's to write within these topics, ≤ 40 words each, titles ≤ 5 words)

1. Welcome — a quick look at what is here; Skip any time; reopen with Ctrl+Shift+T or the Tour button. (target none)
2. The book — all 33 pages offline; strokes in the text light up the board on hover or click. (target the Book tab: `.topbar__tabs a[href="/"]`)
3. Practice — free type, Stage 0 drills, chapter drills and tests, gates. (Practice tab)
4. Fix-up, real text and routines — reached from cards on Practice: drill the words you miss; paste a text and practise its words; plan your own checklist. (Practice tab)
5. Ghosts — an earlier run's pace shown as a quiet line, picker best / last / off. (none)
6. History — every test with accuracy, speed, rhythm and misses. (History tab)
7. Days — a month calendar shaded by practice time, totals, each day's tests. (Days tab)
8. Progress — speed, accuracy, steadiness, keys that hold you back, month-end reports and the plateau notice. (Progress tab)
9. Journal — one note per day, saved as you type. (Journal tab)
10. Tools — Lookup `/`, Key chart `K`, Briefs `B`, Notes `N`; Alt plus the key while drilling; Esc closes. (target `.topbar__tools`)
11. Your data — everything stays on this computer in `data/`; copy it to back up. (none)
12. That's all — reopen any time with Ctrl+Shift+T or the Tour button. (none; button Done)

Step data lives in `src/ui/tourSteps.ts` as `TOUR_STEPS: ReadonlyArray<{ id: string; title: string; body: string; target?: string }>`; a test asserts ids are unique, at least 8 steps, every title ≤ 5 words, every body ≤ 40 words, and every `target` that names a tab matches a real `TABS` href (export `TABS`/`TOOLS` from `TopBar.tsx` only if needed, or assert selectors against the rendered TopBar).

## Files

- Create `src/ui/tourSteps.ts`, `src/ui/Tour.tsx` (the modal, `Tour({ onClose })`), `src/ui/tour.css`, `src/state/tour.tsx` (`TourProvider` + `useTourOptional()`: `{ open: boolean; start(); close() }`, owns the Ctrl+Shift+T listener on `window`, capture phase, and the run-route ignore: it takes `disabled: boolean` as a prop, `App` passes it from the current route), `tests/ui/Tour.test.tsx`, `tests/ui/tourSteps.test.ts`, `tests/state/tour.test.tsx`, plus TopBar and App tests for the button and the wiring.
- Modify `src/ui/App.tsx` (wrap in `TourProvider disabled={isRunRoute(route)}`, render `<Tour/>` when open), `src/ui/TopBar.tsx` (the Tour button, only when a tour context exists, like the dock tools), `src/ui/reader.css` (button style mirroring `.topbar__tool`), `README.md` (a short `## Quick tour` section and one line in "What is inside today"), `docs/superpowers/m7-checklist.md` is left alone; add `docs/superpowers/tour-checklist.md` with ≤ 8 owner checks (including: does Ctrl+Shift+T reach the page in your browser or does it reopen a tab? the button then).

## Tests that must exist

- `Ctrl+Shift+T` opens the tour (and calls preventDefault); plain `T`, Ctrl+T, Ctrl+Shift+T with Alt, and the key while `disabled` do nothing; pressing it while open does not reset the step.
- Next goes 1→2…, Back returns, Back hidden on step 1, last step shows Done and no Skip, Done and Skip and Esc close; ArrowRight/Left work.
- Focus starts on Next, Tab is trapped (Shift+Tab too), focus returns to the opener on close.
- While the tour is open, a dock key (`K`, `Alt+K`) and Esc do not open/close the dock.
- A step whose `target` is missing renders without a ring and without error; a present target renders a ring box.
- The TopBar Tour button opens the tour; absent without the provider; not rendered/disabled on run routes.
- Existing suite, typecheck and build stay green.

## Risk to report

Chromium and Firefox reserve `Ctrl+Shift+T` for "reopen closed tab" in normal tabs; a page's `preventDefault` may be ignored. It can work in an installed app/`--app` window. Cannot be verified headlessly; hence the button and the checklist item.
