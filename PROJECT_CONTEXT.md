# CS Fitness Tracker — Project Context

## Overview

This document is the source of truth for how the app works.

A web-based workout tracking app that helps users log sets and automatically guides progressive overload using a structured system.

Core idea:

* User logs sets (weight + reps)
* System evaluates performance
* System generates a recommendation for the next session

## Core Rules

- Do NOT overcomplicate the system
- Keep logic consistent with current progression model
- Do NOT rebuild CPS from scratch — only refine
- Keep UI simple and clean (dashboard style)
- Prioritize clarity over features

---

## Core Features

### Exercise System

* Users can create exercises
* Each exercise includes:

  * set count (2–4)
  * target reps
  * weight increment
  * weight unit (`lbs` or `kg`)
  * optional tracking toggles: `Track RIR`, `Track RPE`
* Manual exercise creation defaults (library + custom setup):
  * Target Reps = `8`
  * Set Count = `3`
  * Increment default follows unit: `5` for `lbs`, `2.5` for `kg`
  * On unit switch, increment auto-updates only if the user has not manually changed increment

### Top-Level Navigation

Top-level navigation for signed-in users contains:

* `Log a Workout` (`/workout`)
* `Your Library` (`/library`)
* `Profile` (`/profile`)
* `Admin Panel` (`/admin`) **only when the session user is authorized admin**

Navigation interaction polish:

* top nav links use path-aware active styling via `app/top-nav.tsx` (`usePathname`)
* default = normal weight, no scale
* inactive hover = subtle `scale(1.05)` + stronger weight with smooth `transition-all` (`200ms`, ease-out)
* active tab = stronger bold emphasis, stable size (no hover scaling jitter while active)
* mobile/touch compatibility is preserved (hover is visual-only; routing behavior unchanged)
* **App shell (`app/layout.tsx` + `app/top-nav.tsx`):** root metadata title is **CS Fitness Tracker**. The app column uses **no top padding** on small screens (`pt-0`; desktop keeps `md:py-8`) so the **navbar is flush with the top of the viewport** (no white strip from outer padding). The **`<header>`** keeps the top **fully black** with a **softer, lighter-banded** vertical `linear-gradient` (mid-stops are slightly less heavy) so the transition into the page feels a bit **less visually weighty** than a harsh band; mobile uses **`pb-10`** with a **longer fade**; at **`md+`**, a compact black → light fade (`md:pb-4`, `via-zinc-900/85`) keeps desktop tidy. **All** branding and nav link text stays **white** (inactive `white/80`). The top-left title is **CS Fitness Tracker**.
* **Home (`app/page.tsx`):** on small screens the hero is **centered** in a **taller min-height** region so it sits **nearer the middle** of the screen; the dark primary CTA is **Your Library** (links to `/library`); **Log a Workout** is unchanged. **Side-by-side** primary/secondary from ~`400px` width, **stack** on very narrow viewports. Desktop (`md+`) keeps **left-aligned** hero and default vertical rhythm without the mobile min-height centering.

The old standalone `Create Exercise` tab/page is removed from navigation; `/exercise` redirects to `/library`.

### Mobile UI Refinements v1

* **Workout date layout (`app/workout/page.tsx`):** in day-list mode, the block now reads top-to-bottom as: `This week` label -> weekday selector row (`WorkoutDateNavigation`) -> `Workout day: <date>` -> `Choose on calendar` button, using tight vertical spacing (`space-y-3`) for cleaner mobile flow.
* **Library tabs (`app/library/page.tsx` + `app/globals.css`):** top tabs are forced to a **single horizontal row** with `overflow-x-auto` and `whitespace-nowrap`; `no-scrollbar` utility hides scrollbar chrome while preserving touch/trackpad horizontal scrolling.
* **Navbar gradient polish (`app/layout.tsx`):** header stays fully black and adds a subtle dedicated fade strip below it (`h-8`, `bg-gradient-to-b from-black/80 via-black/30 to-transparent`) for a softer, slightly longer transition into the page background.

### Mobile UI Refinement Pass v2

* **Navbar gradient adjustment (`app/layout.tsx`):** the fade strip is tuned to be slightly longer and softer (`h-9`, `from-black/75 via-black/25 to-transparent`; `md:h-7`) while keeping the navbar itself pure black and flush to the top (no white gap).
* **Workout day layout changes (`app/workout/page.tsx`):** day-list mode preserves the strict vertical order `This week` -> weekday selector -> `Workout day` text -> `Choose on calendar`, with compact `space-y-3` rhythm.
* **Tab scrolling behavior (`app/library/page.tsx` + `app/globals.css`):** Library tabs are locked to a single row (`whitespace-nowrap`, `shrink-0`) inside `overflow-x-auto no-scrollbar` so labels never wrap to a second line.
* **Input responsiveness improvements (`app/workout/page.tsx`):** both pre-submit and submitted-input tables keep one row per set, use compact mobile column tracks and non-wrapping compact headers, and fall back to local horizontal table scrolling on narrow widths when all optional columns are visible.
* **Section layout refinements (`app/library/page.tsx` + `app/workout/page.tsx`):** Data Backup remains collapsible by default; preset list controls (including `Select`) are consolidated into the preset header action area; global clear-all is hidden from normal user UI.

### Mobile UI Refinement Pass v3

* **Hero vertical centering improvement (`app/page.tsx`):** mobile hero is explicitly centered with `flex`, `flex-col`, `items-center`, `justify-center`, `text-center`, and `min-h-[70vh]`; desktop resets with `md:min-h-0`, `md:items-start`, `md:justify-start`, and `md:text-left`.
* **Tab overflow fix (`app/library/page.tsx` + `app/globals.css`):** library tabs use `w-full overflow-x-auto no-scrollbar` on the parent and `flex min-w-max whitespace-nowrap` on the inner row; each tab remains `shrink-0 whitespace-nowrap`, preventing clipping/cut-off while preserving one-row scroll.
* **Removal of duplicate subtext in workout date section (`app/workout/page.tsx`):** removed the redundant uppercase `Workout date` heading and secondary gray-uppercase treatment so the section no longer repeats low-priority labels.
* **Improved visual hierarchy for workout date section (`app/workout/page.tsx`):** day-list mode uses cleaner order and emphasis: `This week` (dark, semibold) -> weekday selector -> `Workout day: <date>` -> `Choose on calendar`, with tighter `space-y-3` spacing for a compact mobile flow.
* **Navbar gradient adjustment (`app/layout.tsx`):** mobile fade strip is subtly extended and softened (`h-10`, `from-black/80 via-black/28 to-transparent`) to blend into the page without feeling heavy.

### Your Library (`/library`)

`Your Library` is organized into three sections/tabs:

* **Used Exercises** — exercises/configurations that have logged workout history
* **Created Exercises** — only `isUserCreated === true` exercise definitions, with **Create New Exercise**
* **Saved Workout Presets** — templates/splits, with **Create New Preset**; in list mode, **Select** / delete-mode actions live in the section header actions area (right side) and wrap cleanly only when needed on very narrow viewports.

Library beta onboarding callouts (`app/library/page.tsx`, localStorage-backed):

* **Used Exercises tab:** shows a contextual guide card with `Got it` / `Skip guide`; dismissal persisted as `hasSeenUsedExercisesGuide`.
* **Created Exercises tab:** shows a contextual guide card with `Skip guide`; completion persisted as `hasCompletedCreatedExercisesGuide`, and it auto-completes when the user creates an exercise from this tab’s **Create New Exercise** flow.
* **Saved Workout Presets tab:** shows a contextual guide card with `Skip guide`; completion persisted as `hasCompletedPresetsGuide`, and it auto-completes when a new preset is successfully saved.

Manual creation duplicate rule:

* If entered name matches any master exercise in `EXERCISES_BY_LETTER` exactly by characters (case-insensitive), creation is rejected with:
  * `This exercise already exists.`

---

### Workout Logging

* **No library exercise is required** to open `/workout`: users can use the full flow with the **master exercise list** (and presets) even when `exercises` is empty; the old **“Create at least one exercise first…”** block is removed.
* **First-workout guide (`app/workout/page.tsx`):** brand-new users (zero logged workouts) see a lightweight, phase-driven 5-step guide with subtle in-flow callouts and no modal:
  1. Day overview near **Log First Workout**: `Start here — log your first workout.`
  2. Exercise selection: `Choose the exercise you’re doing, or create one if you don’t see it.`
  3. Exercise setup/config: `Adjust sets, target reps, and weight increment here. If you’re unsure, leave the defaults.`
  4. Workout input: `Enter your weight and reps for each set, then press Submit Workout when you’re done.`
  5. Post-submit dashboard: `This dashboard shows your performance numbers, recommendation, and comparison to last time.`
  - Steps 1–4 show only `Skip guide`; step 5 (dashboard) shows `Done` + `Skip guide`.
  - Guide text auto-follows the user’s current phase (no per-step confirmation clicks required), while `firstWorkoutGuideStep` is still persisted for diagnostics/state continuity.
  - `Skip guide`, `Done` on step 5, or leaving the dashboard after the first completed workout marks completion (`hasCompletedFirstWorkoutGuide = true`), so the guide no longer appears.
* **Exercise-selection first-time helper (`app/workout/page.tsx`):** in `Exercise selection`, users with **no logged workouts**, **no saved presets**, and **no created exercises** see helper text: `Your saved exercises and presets will appear here after your first workout.`
* **Workout date (day list + week strip, `isDayExercisesListOpen` true):** the **week strip** renders **first**; the **workout / selected day** line and **Choose on calendar** sit **below** it for a less cramped mobile layout.
* **Set input grid (pre-submit + post-submit edit):** column templates use **tighter `max-md` tracks**; parents use **`max-md:overflow-x-auto`** with a **minimum table width** so when **Weight, Reps, RIR, and RPE** (or time equivalents) are all shown, the row can **scroll horizontally** on narrow viewports instead of breaking. Header copy is **shortened** on small screens (e.g. `Wt (kg)`, `Reps (T 8)`, `Time (T 45s)`) while **preserving unit and target context**.
* Select exercise from workout flow
* Input sets (weight + reps)
* Optional per-set RIR/RPE inputs appear only when enabled on the selected exercise
* Inputs are always fresh (not pre-filled)
* Auto-fill behavior:

  * if a set hits target reps
  * next set weight auto-fills (if empty)

---

### Progression Engine

Determines progression stage based on:

* whether sets hit target reps
* whether weights are consistent across sets

Stages:

* S1_REPS
* S2_WEIGHT
* S2_REPS
* S3_WEIGHT
* S3_REPS
* INCREASE_WEIGHT

---

### Recommendation Engine

Generates human-readable coaching instructions based on progression stage.

Examples:

* “Get your 2nd set up to 15 lbs”
* “Keep your 2nd set at 15 lbs and bring it to 8 reps”
* “Increase weight by 5 next session”

Uses:

* actual set weights
* target reps
* progression stage

---

### CPS (Custom Performance Score)

Purpose:

* quantify workout performance in a controlled way

Logic:

* uses weight² for load
* normalized by divisor
* divisor = average of top 2 valid set weights
* includes rep completion factor (capped at target reps)
* includes controlled overload bonus
* includes small set-count bonus
* prevents score inflation from heavier sets
* rounded to 1 decimal for display

---

### Comparison System

After each workout:

* compares current vs previous session

Metrics:

* CPS (primary)
* volume (secondary)

Outputs:

* Current CPS
* Previous CPS
* CPS % change (primary)
* raw CPS change (secondary)
* Status:

  * Improved
  * Matched previous session
  * Below previous session

Also includes volume comparison.

Simple progression insight:

* In the workout analysis panel, the app checks the selected exercise's 3 most recent sessions.
* If the same progression stage repeats across all 3, it shows a subtle insight message.
* When the repeated stage is a reps stage and Set 2 reps are unchanged across those 3 sessions, the message can call out the Set 2 reps stall.
* This is informational only (no deload/fatigue recommendations yet).

---

### Data Persistence

* Uses localStorage
* Current storage model is client-ready:
  * root keeps a clients collection + active client id
  * default active client is local single-user client (`local-client`, `Local Client`)
  * each client record contains:
    * `id`
    * `name`
    * `exercises`
    * `workoutHistory`
      * persisted as date-grouped entries (`byDate`)
      * each workout entry includes stable `workoutId` + metrics snapshot
* Stores (within active client):

  * exercises
  * workout history
  * CPS
  * volume
  * recommendations
  * progression stage
  * optional per-set RIR/RPE values (when provided)

Backup/restore tooling:

* `Your Library` includes a **Data Backup** block that is **collapsible (default collapsed)**: a **Data Backup** header `button` toggles visibility; expanded content includes description, **Export Data**, and **Import Data** (import/export **logic is unchanged**).
* `Export Data` — downloads `fitness-tracker-backup-YYYY-MM-DD.json`
* `Import Data` — accepts `.json` backup files
* Export payload contains:
  * `clients`
  * `activeClientId`
  * active-client convenience mirrors: `exercises`, `workoutHistory`, `presets`, `restByDate`, `finishedByDate`
* Import performs rough validation before overwrite:
  * file must parse as JSON object
  * must include valid `clients` object
  * must include valid `activeClientId` that exists in `clients`
* Import requires explicit inline confirmation before replacing local data.
* Successful import rewrites local storage snapshot and reloads the app so providers rehydrate from restored data immediately.
* Import/export is storage-layer only; workout/CPS/progression/recommendation logic is unchanged.

Data persists after page refresh.

Migration behavior:

* Legacy single-user keys are automatically migrated into the default local client container on first load.
* UI/behavior remains single-user for now; this is only structural preparation for future multi-client support.

* **Hydration guard:** `ExercisesProvider` and `WorkoutHistoryProvider` only run their “save to localStorage” effects **after** the initial load from localStorage has been applied (`storageHydrated`). This prevents a race where the save effect could run once with the initial empty state (`[]` / `{}`) and overwrite real data before React committed the loaded values.

---

### Reset System

* `clearAllData()` remains in `app/workout/page.tsx` for debug/maintenance workflows, but the **Clear All Saved Data** user-facing control is hidden from normal beta UI.
* Clear-all behavior itself is unchanged when invoked: persistence + in-memory reset (`removeAllFitnessKeys()`, `clearExercises()`, `clearWorkoutHistory()`, and related workout UI state reset), plus the existing remote/pending-sync clear behavior documented below.

---

## UI Structure

### Layout

* 2-mode workout layout

Workout modes on `/workout`:

* **Logging Mode** (before submit): step-based flow; at most one step’s content (plus the persistent date strip) is on screen. Single-column, per-set cards, no horizontal scroll
* **Analysis Mode** (after submit): the pre-submit logging area is hidden and the session analysis panel is shown
  * includes a top-left segmented control with:
    * `Dashboard`
    * `Inputs`
  * default after submit is `Dashboard`

Pre-submit **logging** UI is driven by **`logFlowPhase`** in **`app/workout/page.tsx`**, type **`LogFlowPhase`**: `day_overview` | `exercise_select` | `exercise_setup` | `exercise_log`. **`goBackToDayOverview()`** resets the in-progress flow to **`day_overview`**.

Persistent strip at the top (always in Logging Mode, before analysis):

* **`day_overview`:** (see also staged **Day overview** below) either **(A) day list + week strip** while **`isDayExercisesListOpen`** is **true** (default): **one tap** on the week strip in range updates **`selectedWorkoutDate`**. **Choose on calendar** sets **`isDayExercisesListOpen` false** and shows the full **month** grid plus week strip, or **(B) two-step “calendar” pick** with **`isDayExercisesListOpen` false** : first tap (week or month) only sets the date; a **second tap on the same day** runs **`goBackToDayOverview()`** and reopens the day list. The **big month** is hidden in (A) and in other phases. **`goBackToDayOverview()`** (and **`closeCalendarToDayList`**) also clear **`calendarFirstTapYmdRef`**, set **`isDayExercisesListOpen` true**, and reset the in-flow exercise form as before. **Close calendar** returns to (A) without a second tap (optional exit). **Month** ←/→ calls **`onUserNavigateMonth`**, which clears a pending first tap. Helpers: **`app/workout/workoutDateNavUtils.ts`**, UI **`app/workout/WorkoutDateNavigation.tsx`**
* **Any other phase:** the same **week strip** is read-only (selection still highlighted) without the month grid, plus helper text; **Back to day overview** (**`goBackToDayOverview`**) returns to the day list and week (not the full month) as in (A) above

Staged content (one stage visible, others hidden):

* **`day_overview`:** when **`isDayExercisesListOpen`** is true, **Day overview** for the selected date: entries that day, **Select first workout** (empty day) or **Add another workout** (when the day has entries, and not in selection mode). This block is **hidden** while the user is in **two-step calendar** mode (`isDayExercisesListOpen` false) so the big calendar can fill the view. A date-level **Mark as rest day** checkbox is shown in this block; it persists per date via **`restByDate`** in **`app/workout-history-provider.tsx`** (`setDateRestFlag` / `isDateMarkedRest` / `listRestDates`). Rest days are allowed **only on empty dates**: if the selected day already has workouts, attempting to mark rest is blocked and shows **“This day already has logged workouts and cannot be marked as rest.”** as a temporary inline notice that auto-fades out after a few seconds. Existing workouts are never deleted/overwritten by rest toggles. When checked on an empty day, the helper message **“This day is marked as rest”** appears and add-workout actions are disabled; unchecking only removes the rest flag. The day-finished control is now a reversible **toggle-style button** labeled **`Day Finished`** backed by **`finishedByDate`** (`setDateFinishedFlag` / `isDateFinished` / `listFinishedDates`) when there is at least one workout and the date is not rest. **ON** marks the day finished; **OFF** clears it. Finished days are visually gray with bold day-overview text, stay reopenable/editable, and block only **new add-workout actions** (including preset apply and exercise selection); existing entries remain openable/editable/deletable. Each non-selection row now has a right-side **`⋮`** control for config editing; it opens **`exercise_config_edit`** where only exercise configuration fields can be changed (set count, target reps, increment, unit, trackRIR, trackRPE) with **Back** (discard local edits) and **Submit** (commit). Submit rebinds only that workout entry to an exact-matching existing exercise config when found, otherwise creates a new config variant and rebinds that one entry. This preserves prior history rows, timestamps, and unrelated entries. **Select** enters selection mode: a checkbox on each entry for that date, **Delete permanently** and **Cancel**; row buttons are disabled in selection mode (no `openWorkoutEntry`). **Delete permanently** (with at least one selected) shows inline confirmation: “Delete the selected workout(s)? This cannot be undone.” with **Yes, delete** (runs **`removeWorkoutsFromDate(selectedWorkoutDate, ids)`** in **`app/workout-history-provider.tsx`**) and **No, keep**. Only those session rows are removed from the date bucket; **exercise definitions and other days’ / same exercise’s other sessions stay**. **Cancel** and leaving **`day_overview`** clear selection state (**`exitDayOverviewSelectMode`** in **`app/workout/page.tsx`**). **Choose on calendar** exits selection and opens two-step pick; **openCalendarForDatePicking** and **Close calendar** (**`closeCalendarToDayList`**) also adjust **`isDayExercisesListOpen`**. Each entry’s **primary line** (title) is **`{exerciseName} — {setCount}x{targetReps}`** via lookup of the saved exercise by **`exerciseId`** (**`formatDayOverviewWorkoutTitle`** in **`app/workout/page.tsx`**); if no matching exercise, the title falls back to **`exerciseName`**. The **subline** (sets, CPS, volume) is unchanged. A **CPS trend** (emerald ↑ / amber → / rose ↓) on the title row is visually prominent (**`text-2xl`**, semibold) and vertically centered (`items-center`) with extra title/arrow spacing (`gap-4`) and slight right padding (`pr-1`) so it stays readable and not cramped; it compares the entry’s **sessionCps** to the next-older session in **`historyByExerciseId[exerciseId]`** (same program line as **`exerciseId`**) when both CPS values exist: above previous → up, below previous → down, within **0.05** → flat (**`resolveCpsDayOverviewTrend`**, **`getPreviousComparableWorkoutEntry`** in **`app/workout/page.tsx`**; display only, CPS math unchanged)
* **`exercise_select`:** a **search** field (`exerciseSearchQuery`) filters **Recent** and the **All exercises** (master) list by substring (case-insensitive) as the user types. **All exercises** (master) always continues to **`exercise_setup`** on row click (never straight to inputs). A **Create new exercise** control calls **`startCreateNewExercise`**, which opens the same setup step with an **editable name** (`isCustomExerciseSetup`). Not the day list, not inputs, not setup in parallel
* **`exercise_setup`:** when **`pendingExerciseName !== null`** (including `""` for a new custom name). If **`isCustomExerciseSetup`**, the name is an editable text field; otherwise the title shows the name from the master or recent path. **OK** runs **`handleConfirmExerciseSetup`**: requires a non-empty trimmed name; when custom setup is active, names that case-insensitively match a master exercise in **`EXERCISES_BY_LETTER`** are rejected with **`This exercise already exists.`**. If **`findExerciseWithSameNameAndConfig`** in **`lib/exerciseConfigMatch.ts`** finds a saved exercise with the same normalized name and full config (set count, target reps, increment, unit, RIR, RPE), that exercise is reused; otherwise **`addExercise`** in **`ExercisesProvider`** creates a new one (`isUserCreated: true` for custom path). Then phase **`exercise_log`**, **`isCustomExerciseSetup` cleared**. **Cancel** returns to **`exercise_select`** and clears the pending name and custom flag
* **`exercise_log`:** only the set table, a **Back to exercise list** action ( **`handleBackToExerciseSelector()`** in **`app/workout/page.tsx`**, next to **Submit workout**), **Submit workout**, live volume, and **Last session** below the inputs; no selector, no day list, no setup card. **Back to exercise list** clears the in-progress set rows and selected exercise and returns to **`exercise_select`** without persisting a workout (same date; history unchanged)

CPS, progression, recommendations, and per-set input math are unchanged. Workout **history** can be pruned per date via **`removeWorkoutsFromDate`**. Per-set inputs stay one row per set (Weight/Reps + optional RIR/RPE)

Analysis panel (post-submit only):

* Performance Score (CPS)
* Volume
* Avg Weight
* Avg Reps
* Next Session Focus (highlighted)
* Progression stage (de-emphasized)
* Comparison to last time
* In Analysis Mode, `Inputs` view shows the submitted set rows (weight, reps, and optional RIR/RPE)

---

## UX Behavior

### On Exercise Selection

* Normalized name keys (trim, lowercase, collapse internal whitespace) for comparing names live in **`lib/exerciseNameKey.ts`** as **`exerciseNameKey`**
* **All exercises** (master list) row buttons call **`selectExerciseFromLibrary(name)`** in **`app/workout/page.tsx`**: always sets **`pendingExerciseName`**, **`isCustomExerciseSetup`** false, and phase **`exercise_setup`**. **Create new exercise** calls **`startCreateNewExercise`**: **`isCustomExerciseSetup` true**, **`pendingExerciseName`** `""` until the user types
* **`handleConfirmExerciseSetup`** reuses a saved exercise when the trimmed name (via **`exerciseNameKey`**) and all of set count, target reps, increment, unit, **trackRir**, **trackRpe** match (**`findExerciseWithSameNameAndConfig`**); otherwise adds a new exercise. Then **`exercise_log`**
* **Recent exercises** row buttons call **`selectRecentExercise(exerciseId, displayName)`** in the same file: the decision uses the **history entry’s `exerciseId`**, resolved against **`exercises`**. If that id still exists, the user is taken to **inputs** (phase **`exercise_log`**) via **`handleExerciseChange`**; if the exercise was removed from the list, the flow uses **`displayName`** and opens **Setup** (phase **`exercise_setup`**, name-only matches are not used for Recent rows, avoiding false “already configured” routing)
* The **per-set inputs** block and **Last session** (below inputs) are shown only when **`logFlowPhase === 'exercise_log'`** with a valid **`selectedExercise`**; `handleExerciseChange` initializes the row state from the active exercise config (`buildSetsFromExercise(exercise.setCount)`) and the row renderer uses the selected config's `trackRir` / `trackRpe`
* `handleExerciseChange(id, exerciseOverride?)` accepts the just-created config as an override (used from `handleConfirmExerciseSetup` after `addExercise`) so new configurations initialize rows immediately even before provider state re-renders (prevents fallback/empty-row behavior when set count changes, e.g. 3 → 4)
* **Recent** (still configured) → **`exercise_log`**. **All exercises** (master) → always **`exercise_setup`** first; **OK** may reuse or create as above
* Logged-in top-nav order prioritizes workout flow: **`Log a Workout`** first, then **`Your Library`**, then **`Profile`**
* Auth success routing now lands on **`/workout`** from both **`/login`** and **`/signup`** to reduce first-workout friction
* On workout exercise selection, empty-state clutter is reduced:
  * **Saved presets** section is hidden until at least one preset exists
  * **Your library exercises** section is hidden until at least one user-created exercise exists
  * **Recent exercises** (when available) and **All exercises** remain visible under their existing rules
* On the **input** step, **Back to exercise list** (configured path) mirrors **setup**’s **Cancel** (new-exercise path): it only adjusts client UI state and does not call **`addWorkout`**
* Inputs reset to empty
* A simplified **Last session** preview appears below the input section
* Recent exercise rows show compact config on the same line when configured:
  * `3 sets / 8 reps / +5 lbs / RIR: N / RPE: Y`

Includes:

* last CPS
* last volume
* set summary
* last recommendation

---

### Workout Date Flow

* `/workout` is calendar-first and day-container oriented.
* **Calendar** uses the user’s local timezone; the week strip and month grid are built in local time; the default for **`selectedWorkoutDate`** is still the local “today” string when it falls in 2026 (client-side).
* Calendar day tinting is subtle and status-based in **`WorkoutDateNavigation`**: finished workout day = muted gray (with stronger text), rest day = muted slate/blue, empty day = default white. Rest status has priority over finished status.
* **Selectable** dates remain constrained to 2026 (`2026-01-01` to `2026-12-31`); the month view is **one year** (2026) at a time with month navigation. Days outside the range (e.g. in a Sun–Sat row that straddles late 2025) appear disabled in the week strip.
* The **selected** day is highlighted in the week row always; the month grid, when shown, also highlights the selected day. The **exercise / day list** and **Add another** appear only with **`isDayExercisesListOpen` true** (after two-step confirmation from the month flow, or **Close calendar** to return with the last single-tap selection), while **one tap** on the week in that state switches **`selectedWorkoutDate`** and reloads the list.
* In the full **month** view (with **`historyByExerciseId`**), the calendar uses **8 columns**: **Sun…Sat** plus a final **“Wk”** column. Each week row (Sun–Sat) with at least one in-month day shows an indigo-tinted **W*n* / Review** control in the 8th cell (rows with no in-month days have an empty placeholder; history missing shows a disabled stub). **Open**ing it (**`app/workout/WorkoutDateNavigation.tsx`**, **`WeeklyReviewModal.tsx`**, **`app/workout/weeklyReviewContent.tsx`**) shows a **modal** “weekly review” (not inline). **Back to calendar** closes the modal. Metrics match **`computeWeekReview`** in **`lib/weeklyReview.ts`**: *Top performer* and *Biggest CPS improvement* share the same **largest positive** CPS **percentage** change vs the prior same-`exerciseId` session (label includes secondary raw CPS delta, e.g. `+12.4% ( +1.8 CPS )`); *Biggest volume improvement* = **largest positive** volume **delta** vs the prior same-exercise session. Metric values render as **`(↑/→/↓ value)`** in the modal with trend tones aligned to card indicators (emerald/amber/rose) using UI-only parsing in **`weekReviewBodyFromSnapshot`**. Short *not enough data* copy when a metric is unavailable. **Escape** or the backdrop also closes the modal; body scroll is locked while it is open.
* The selected date acts as a container for multiple workout entries.
* Submitting a workout appends a new entry for that date (does not replace other entries on same day).
* Analysis/session summary shows the selected workout date for the active entry.
* Recent-exercise ordering is derived from workout usage history.

---

### On Workout Submission

Right panel updates to show:

* This session analysis
* CPS + volume + average metrics
* recommendation
* progression stage
* comparison to previous session

Mode transition behavior:

* After submit, the page enters **Analysis Mode** and hides the input section
* The post-submit segmented control defaults to **Dashboard**
* **Inputs** tab re-renders the submitted workout input table
* Inputs in post-submit **Inputs** tab are read-only by default
* Clicking **Edit Workout** creates a deep-copied editable buffer (`editData`) from the submitted session, unlocks inputs, and shows **Save Changes** + **Cancel**
* While editing, input changes are applied only to `editData` (the saved session data is unchanged until save)
* Clicking **Save Changes**:
  * overwrites the current post-submit session with `editData`
  * recalculates CPS, volume, averages, progression stage, and recommendation
  * updates the saved workout entry in place via **`handleSaveWorkoutChanges`** in **`app/workout/page.tsx`** (calls **`updateWorkoutEntry`** in **`app/workout-history-provider.tsx`**)
  * preserves the original log day and original submit timestamp (`submittedAt` as created-at); edit saves set `updatedAt` only
  * does **not** move the workout between dates in day overview/calendar/weekly review
  * returns the tab to **Dashboard** and locks inputs again
* Clicking **Cancel** exits edit mode, discards `editData`, and restores the original submitted values
* Analysis view includes **Back to Day Overview**, which returns to the selected date list
* **Log Another Workout** remains available to jump directly into logging another entry on the same date

Average metric rules:

* **Avg Weight** = average of valid set weights only
* **Avg Reps** = average of valid set reps only
* empty or zero-value sets are ignored
* both averages are rounded to 1 decimal

Unit display:

* Weight-based metrics show the selected exercise unit (`lbs`/`kg`) where appropriate, including **Volume** and **Avg Weight**

RIR/RPE behavior:

* `Track RIR` and `Track RPE` are configured per exercise in `Your Library` manual creation and workout setup creation.
* On `/workout`, the RIR/RPE columns render only when enabled for the selected exercise.
* RIR/RPE values are saved with workout set snapshots when provided.
* RIR/RPE are not part of CPS scoring yet.
* Input layout usability:
  * Horizontal scrolling is not required in logging or post-submit Inputs views.
  * Each set is rendered on a single horizontal row with aligned columns.
  * Weight/Reps use medium-width input columns; optional RIR/RPE use narrower columns.
  * Row spacing and alignment are consistent across sets for faster data entry.

---

## Current State

* Fully functional MVP
* Clean dashboard-style UI
* CPS implemented and tued
* localStorage persistence working
* reset button implemented
* exercise-level units + average metrics implemented

---

## Known Issues

* occasional Next.js dev chunk errors (fixed via restart)
* minor UI polish remaining

*(Resolved: data could appear to vanish “instantly” without a confirm dialog because persistence effects could write empty state to localStorage before hydrate — see **Data Persistence** hydration guard.)*

---

## Tech Stack

- Next.js (App Router)
- React
- LocalStorage (temporary persistence)

## Exercise Library Source

- Canonical starter exercise grouping currently lives in `Exercise_list.md`.
- A TypeScript export is available in `lib/exercises.ts` as `EXERCISES_BY_LETTER`.
- Master list structure is now v2 data objects (not plain strings): `{ name, foundation }`.
- Master list structure now supports typed entries: `{ name, foundation, type }`, where `type` is one of:
  - `weight`
  - `bodyweight`
  - `time`
- `foundation` is a hidden structural numeric field for future CPS/bodyweight support and is not rendered in UI lists/cards/selectors.
- The v2 master list removes duplicate legacy entries (`Flat Bench Press`, `Military Press`) while preserving remaining names.
- Type rules in master data:
  - existing exercises default to `weight` when `foundation` is `0`
  - existing exercises with non-zero `foundation` are marked `bodyweight`
  - time-based entries were added: `Plank`, `Side Plank`, `Wall Sit`, `Hollow Hold`, `Dead Hang`, `Farmer Carry`, `Suitcase Carry` (all with `type: "time"` and defined foundation values)
- Stored exercise compatibility:
  - `Exercise` now includes `type`
  - legacy stored exercises without `type` are normalized to `weight` on load
- Master exercises from `EXERCISES_BY_LETTER` are wired into the workout exercise selector under **All exercises**.
- Manually created exercises from **Your Library** are also available in the workout selector under **Your library exercises**.
- Manual exercise name duplicate checks against master names now ignore:
  - capitalization
  - spaces
  - hyphens
  while still requiring all other characters to match exactly.
- When a manual exercise matches an existing master exercise under those rules, creation is blocked with:
  - `This exercise already exists.`

## Saved Workout Presets (MVP)

- Presets are created from `Your Library` -> `Saved Workout Presets` via a two-step flow:
  - Step 1: enter preset name, then `Next`
  - Step 2: add one or more configured exercises, then `Save Preset`
    - exercise add uses a searchable master-exercise picker with type-to-filter
    - selecting a master exercise fills the preset exercise name for that row
    - when no master exercise matches, typed text can be used as a new exercise name for that preset row
    - per-row config fields stay explicit in the preset draft (`setCount`, `targetReps/time`, `increment`, `unit`, `trackRir`, `trackRpe`)
- `Back to Library` exits the flow without saving partial draft data.
- Nothing is persisted until `Save Preset` is clicked.
- Saved presets in `Your Library` are clickable and open an edit screen.
- Saved presets list now supports multi-select permanent deletion in `Your Library`:
  - top-level `Select` toggle appears in `Saved Workout Presets`
  - selection mode shows a checkbox next to each preset and allows multiple selected presets
  - `Delete permanently` appears when in selection mode and requires at least one selected preset
  - confirmation UI matches existing delete UX:
    - prompt: `Delete the selected preset(s)? This cannot be undone.`
    - actions: `Yes, delete` / `No, keep`
  - confirming removes presets from in-memory state and persisted storage immediately
  - after confirmed deletion, when no presets remain selected, selection mode auto-exits and normal preset list UI is restored (no manual `Cancel` required)
  - choosing `No, keep` closes only the confirmation prompt and preserves current selections
  - deleting presets does not alter already-created workout entries that came from those presets (presets are templates, not linked historical data)
- Preset edit screen supports:
  - editing preset name
  - selection mode for deleting one or more preset exercises
  - editing per-exercise config (`setCount`, `targetReps`, `increment`, `unit`, `trackRir`, `trackRpe`)
- Preset edits use local draft state and are committed only on `Save`; `Back` discards unsaved changes.
- Safe config behavior is preserved:
  - editing preset exercise config never mutates existing saved exercise configs
  - when presets are later applied on `/workout`, exact-name+config matches reuse existing exercise configs; non-matches create new variants.
- Presets are persisted per active client (same storage scope as exercises/workout history).
- Library now includes app-level local backup controls (independent of preset create/edit):
  - `Export Data` creates a full local JSON backup
  - `Import Data` restores from JSON after confirmation and triggers rehydrate via reload
- Preset editing now supports appending new exercises in draft mode:
  - `/library` edit panel includes `Add Exercise` within `Edit Preset`
  - added exercises are appended to local `editingPresetExercises` only
  - no storage commit happens until the main `Save` action is clicked
- On `/workout` exercise selection, presets appear:
  - below `Recent exercises`
  - above `All exercises`
- Clicking a preset creates separate workout entries for the selected day (one per preset exercise), not a combined entry.
- These created entries use the existing day overview list and remain individually openable/editable/deletable through current workout flows.
- Preset-added entries are created as **draft workouts** (`isDraft: true`) until first valid submit:
  - opening a draft goes directly to workout inputs
  - any unsubmitted entry (including legacy blank rows with no valid sets) opens in input-only mode
  - unsubmitted view does not show post-submit dashboard/inputs-toggle/edit/compare/progression cards
  - helper copy appears: `Added from preset — enter your sets to log this workout.`
  - first valid submit updates that same draft row into a normal logged workout (`isDraft: false`) and enables normal post-submit analysis/edit flows.

## Submission Validity Rule

- For `weight`, a set is valid when both:
  - `weight > 0`
  - `reps > 0`
- For `bodyweight`, a set is valid when:
  - `reps > 0`
  - and either `weight > 0` **or** (`weight === 0` and exercise `foundation > 0`)
- For `time`, a set is valid when `timeSeconds > 0` (with a reserved hook for future hybrids that may require both time + weight).
- Submitting (new workout) and saving edited workout inputs both require **at least one valid set**.
- If no valid set exists, submit/save is blocked and inline error is shown:
  - `Log at least one set to submit this workout.`
- On input-only workout screens, **Submit workout** stays disabled (grayed out) until at least one valid set exists.
- On valid submit/save, existing CPS/progression/recommendation logic runs unchanged.
- CPS effective-weight handling now supports hidden foundation values for bodyweight-capable exercises:
  - if entered set weight `> 0`, CPS uses entered weight as-is
  - if entered set weight is `0` and exercise `foundation > 0`, CPS uses `foundation` for that set’s CPS weight only
  - if entered set weight is `0` and `foundation === 0`, behavior is unchanged (set remains invalid for CPS weight)
  - user-entered values and displayed input fields are never overwritten by this mapping
  - implemented in `app/workout/page.tsx` via `buildEffectiveCpsSets(...)` before calling `calculateCPSWithOptions(...)`
- Day overview now shows partial-completion status (informational only):
  - if at least one set is valid but fewer than expected sets are valid, subtext appends `(Partially Done Set)`
  - if all expected sets are valid, no partial label is shown
- Input screen now shows the selected exercise name above the logging table for clearer context.
- Exercise setup/customization now supports setup modes for time-based exercises:
  - setup form includes `Exercise type` with `reps` and `time`
  - `reps` mode keeps existing fields: set count, target reps, increment, unit, track RIR, track RPE
  - `time` mode adapts labels to `Target time (seconds)` and `Track TIR` while preserving optional track RPE
  - selecting a master time exercise (e.g. Plank) opens setup preselected in `time` mode
  - setup dedupe/create logic now resolves by selected setup type so time/reps configs do not cross-match
- Time-exercise input UI now always includes optional load entry:
  - for `time` exercises, set rows show `Time (Target <formatted>)` + `Weight (<unit>)` (+ optional `TIR`, `RPE`); the `Time` column label includes the target duration for quick scanning, parallel to `Reps (Target <n>)`
  - weight remains optional (`0` allowed for bodyweight variants, positive values for weighted variants)
  - this applies to both pre-submit input and post-submit editable inputs, with the same aligned grid layout
- Workout input headers now include active config context for faster scanning:
  - `Weight (<unit>)`, e.g. `Weight (lbs)` / `Weight (kg)`
  - `Reps (Target <n>)`, e.g. `Reps (Target 8)`
  - for `time` exercises, `Time (Target <t>)` where `<t>` is the configured target in seconds, formatted for display: under 60s as e.g. `45s`, 60s+ as `m:ss` (e.g. `1:30`); missing/invalid config shows as `—` (same file: `formatTargetTimeForHeader` in `app/workout/page.tsx`)
- Input rows are now type-aware by selected exercise config:
  - `weight` / `bodyweight`: `Weight` + `Reps` (+ optional `RIR`, `RPE`)
  - `time`: `Time (Target …)` (+ optional `Weight` when supported), `TIR` (replaces `RIR` label), + optional `RPE`
  - one-row-per-set layout remains aligned without horizontal overflow
- Workout set snapshots now support time fields for forward compatibility:
  - `timeSeconds` (internal numeric storage in seconds)
  - `tir`
  - existing `weight` / `reps` / `rir` / `rpe` remain backward compatible
- Time-based CPS path:
  - `lib/calculateCPS.ts` -> `calculateCPSWithOptions(...)` has a dedicated `time` branch
  - completion uses `timeSeconds / targetTimeSeconds` with capping
  - optional weight contribution uses entered weight, or hidden foundation fallback when entered weight is `0` and foundation is positive
  - normalization + modest set-count bonus remain aligned with existing CPS philosophy
- Time storage and migration:
  - `app/workout-history-provider.tsx` -> `normalizeWorkoutEntry(...)` persists/reads `timeSeconds`
  - legacy snapshot field `time` is parsed into `timeSeconds` for compatibility

## Authentication + Backend Integration v1

- Supabase package is installed (`@supabase/supabase-js`).
- Shared client utility exists at `lib/supabaseClient.ts`.
- Client reads:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `lib/supabaseClient.ts` includes explicit runtime checks and clear error messages when either env var is missing.
- `.env.local` is used for local development; Vercel Environment Variables are used in production.
- `NEXT_PUBLIC_SUPABASE_URL` must be the base project URL only (for example `https://<project-ref>.supabase.co`) with no extra path segments such as `/rest/v1` or `/auth/v1`.
- Do not expose Supabase secret/service-role keys in client code or logs.

Auth routes and flows:

- Auth route exists at `app/auth/page.tsx`.
- Supports email/password signup and login through Supabase Auth:
  - `supabase.auth.signUp(...)`
  - `supabase.auth.signInWithPassword(...)`
- Signup behavior currently follows Supabase project settings:
  - when email confirmation is disabled, signup can immediately create a session.
- Logout is available in top navigation via `supabase.auth.signOut()`.
- Auth flow works locally and on Vercel deployment.

Route protection status:

- Auth guards now protect:
  - `/` (`app/page.tsx`)
  - `/workout` (`app/workout/page.tsx`)
  - `/library` (`app/library/page.tsx`)
- Guard implementation uses `supabase.auth.getSession()` in `useEffect` and redirects logged-out users to `/auth`.
- Workout hook-order regression was encountered during initial guard integration; current implementation is refactored so hook order remains stable (no early return before hook declarations).
- Existing workout logic/CPS/localStorage behavior remains unchanged by auth guard work.

Storage and backend scope (current):

- Supabase is currently used for auth + client connection only.
- Workout/exercise/preset data remains in localStorage.
- No workout-data migration to Supabase yet.

Deployment notes:

- App is deployed on Vercel.
- Supabase env vars are configured in Vercel.
- Redeploy is required after production env-var changes.
- Current deployed auth works; keep guard/auth updates in sync with pushed commits.

## Supabase Sync v2

- Workouts sync status:
  - create/insert to `workouts` is active
  - load/hydrate from `workouts` is active
  - edit/delete sync for existing local actions is active via user-scoped Supabase row lookup by `data.workoutId`, then update/delete by row `id`
- Exercises sync status:
  - create/insert to `exercises` is active (full config object in `data`)
  - load/hydrate from `exercises` is active
  - authenticated + successful Supabase fetch now replaces local cache (authoritative remote snapshot), while still overlaying local entries that have unresolved pending `insert`/`update` items so offline-unsynced changes remain visible
  - if Supabase returns no exercise rows, local exercise cache is cleared unless a pending item requires keeping a local unsynced entry
  - current local delete action (`clearExercises`) now also deletes user exercise rows in Supabase
- Presets sync status:
  - preset creation/load works (`presets` rows are inserted and hydrated into provider state)
  - preset content edit sync is fixed through `updatePreset(...)`:
    - adding exercises inside an existing preset
    - removing exercises from an existing preset
    - editing exercise config fields inside an existing preset
    all update the matching Supabase row by writing the full current preset object to `presets.data`
  - local preset create/edit/delete actions now also insert/update/delete Supabase rows
  - matching strategy uses `data.id` / `data.presetId` fallbacks for compatibility
  - preset hydration now uses the same source-of-truth rule: successful authenticated Supabase fetch replaces local preset cache; unresolved pending inserts/updates are overlaid from local state; pending deletes remove matching remote items from hydrated state
  - temporary debug instrumentation is present around preset edit/save/update flow to validate sync path and payload shape across tabs/incognito (safe to remove after verification)
- Presets table + RLS pattern:
  - table shape:
    - `id uuid primary key default gen_random_uuid()`
    - `user_id uuid not null`
    - `data jsonb not null`
    - `created_at timestamptz default now()`
  - policies follow the same user-scoped pattern:
    - SELECT `using (auth.uid() = user_id)`
    - INSERT `with check (auth.uid() = user_id)`
    - UPDATE `using (auth.uid() = user_id) with check (auth.uid() = user_id)`
    - DELETE `using (auth.uid() = user_id)`
- Source-of-truth status:
  - localStorage remains active and required for local-first UX
  - when authenticated and Supabase hydration succeeds, Supabase is authoritative for hydration state replacement
  - data may be temporarily divergent if remote calls fail; local flow must continue
- Matching strategy summary:
  - workouts by `data.workoutId`
  - exercises by `data.id`
  - presets by `data.id` (or `data.presetId` fallback)

## Public Landing + Account Dashboard v1

- `/` is now a public landing page (no auth guard) and keeps the product-facing hero copy:
  - `Track your workouts, manage your exercises, and see your progress over time.`
- Public auth routes:
  - `/login` is the public login page (email/password, logs in, then routes to `/workout`)
  - `/signup` is the public signup page (email/password, signs up, then routes to `/workout` when session is created; otherwise shows confirmation guidance)
- `/auth` is now deprecated as a form route and redirects to `/login`.
- Protected routes:
  - `/library` is protected
  - `/workout` is protected
  - `/profile` is protected
- Beta traffic routing rule:
  - unauthenticated direct visits to protected/internal app routes are redirected to `/` (homepage-first entry) to keep beta user flow anchored on landing.
  - `/`, `/login`, and `/signup` remain publicly accessible without redirect loops.
- Top navigation behavior:
  - Logged out: shows `Log In` and `Sign Up`; hides app-only links
  - Logged in: shows `Log a Workout`, `Your Library`, and `Profile`; hides `Log In`/`Sign Up` and does not show logout in the nav
- Profile route:
  - `/profile` now includes:
    - account metadata fields (`name`, optional `age`) saved via Supabase Auth user metadata (`supabase.auth.updateUser({ data: { name, age } })`)
    - read-only account email + shortened user id
    - password change flow that verifies current password via `signInWithPassword(...)` before `updateUser({ password })`
    - logout button (logout exists on profile page only)
- Payments/subscriptions:
  - planned for later and not implemented in this phase
- Existing workout/CPS/recommendation/localStorage behavior remains unchanged by this routing/account-UX restructuring.

## Admin Dashboard v1

- **Purpose:** read-only beta/coaching view of all user data stored in Supabase (`workouts`, `exercises`, `presets`) plus auth emails. No edits, deletes, or mutations from the admin UI.
- **Routes:**
  - `/admin` — aggregate totals and per-user counts; link to per-user detail.
  - `/admin/user/[userId]` — workout history for one user, grouped by date, with sets, CPS, recommendations, and timestamps (parsed from `workouts.data` JSON).
- **Access control (server-side):**
  - No global middleware is used for admin auth.
  - `/admin` layout checks required env configuration (`ADMIN_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`) via `lib/admin/getAdminAccessState.ts`.
  - Admin pages use client-side Supabase session (`supabase.auth.getSession()`) to obtain an access token and verify user email against `ADMIN_EMAIL`.
  - Admin server actions (`lib/admin/adminDataActions.ts`) validate the provided access token with anon-key Supabase `auth.getUser(accessToken)` and enforce admin email match before any admin data query runs.
- **Data fetching (server-only):**
  - `SUPABASE_SERVICE_ROLE_KEY` is used only in `lib/admin/supabaseServiceRole.ts` (service-role client), consumed by server-side query helpers in `lib/admin/queries.ts` via `lib/admin/adminDataActions.ts`.
  - The service role key must **never** be prefixed with `NEXT_PUBLIC_` and must **never** be imported from client components.
  - Admin overview is dynamic/no-store (`/admin` layout `force-dynamic`, server actions + queries call `noStore`) so deleted Auth users are reflected without stale cache.
  - User rows and active totals are based on the **current** Supabase Auth user list (`auth.admin.listUsers`) and matched against app-table `user_id` values.
  - Rows tied to deleted/missing Auth users are excluded from active dashboard users/totals and reported separately as orphaned row counts (workouts/exercises/presets).
- **Top nav visibility:** `app/top-nav.tsx` calls `GET /api/admin/nav-access` with the signed-in access token; only authorized admin sessions see `Admin Panel`.
- **Normal users:** `/admin` is hidden from main nav; regular app routes and behavior are unchanged.

## Offline Pending Sync v1

- Source of truth direction:
  - Supabase remains the long-term source of truth.
  - localStorage is intentionally retained as fallback/recovery and offline continuity.
- Centralized pending sync architecture:
  - queue ownership is centralized in `lib/pendingSync.ts`.
  - all queue operations route through shared helpers:
    - `loadPendingSyncQueue()`
    - `savePendingSyncQueue(queue)`
    - `addPendingSyncItem(item)`
    - `removePendingInsertForEntity(type, entityId)`
    - `flushPendingSyncQueue(supabase, userId)`
  - providers/pages no longer implement separate queue persistence logic.
- Pending queue storage:
  - failed remote writes now enqueue into localStorage key `fitness-tracker-pending-sync`.
  - queue item shape:
    - `id`
    - `type` (`workout` | `exercise` | `preset`)
    - `action` (`insert` | `update` | `delete`)
    - `payload`
    - `createdAt`
    - `retryCount`
- Failure behavior:
  - local UI/localStorage updates are preserved even when Supabase write/update/delete fails.
  - failures are queued instead of blocking user flow; sync errors are logged but non-fatal.
  - offline/auth-check nuance:
    - write paths now distinguish "logged out" vs "offline auth check failure"
    - if `navigator.onLine === false`, writes are queued immediately (without waiting for `auth.getUser()`)
    - if `auth.getUser()` throws due to network/fetch failure while offline, the intended write is queued (not skipped)
    - if `auth.getUser()` succeeds and no user/session exists, skipping remote write remains acceptable
  - create-path guarantee:
    - workout/exercise/preset create paths now queue insert payloads immediately when offline (`Pending insert queued immediately because offline`) from mutation-level source-of-truth functions.
    - mutation functions now own sync + queue behavior:
      - workouts: `addWorkout`, `updateWorkoutEntry`, `removeWorkoutsFromDate`
      - exercises/presets: `addExercise`, `clearExercises`, `addPreset`, `updatePreset`, `removePresets`
    - UI flows (day overview, exercise setup, presets, submit flow) inherit deterministic pending behavior by calling these mutations.
  - workout delete sync correction:
    - `removeWorkoutsFromDate` now triggers a delete path that always attempts remote workout deletion by current `user_id` + `data.workoutId` when online.
    - if an unresolved pending workout insert exists for the same `workoutId`, that insert is removed first; online delete still checks Supabase row existence and deletes if found.
    - offline delete queues only when appropriate (no unresolved insert to cancel), preventing useless delete jobs for rows Supabase never had.
  - workout duplicate prevention / idempotent sync:
    - workout create/update sync now uses upsert-by-workout identifier semantics:
      - lookup by `user_id` + (`data.workoutId == workoutId` OR fallback `data.id == workoutId`)
      - if found: update `data` + `date`
      - if not found: insert
    - applies across normal submit, draft creation, draft submit (`updateWorkoutEntry` path), and pending sync flush (`insert` and `update` actions).
    - this prevents multiple Supabase rows for the same workout id per user.
- Retry behavior:
  - each provider runs a **mount-only** `useEffect` (empty dependency array) that subscribes to `online` and `onAuthStateChange` and calls centralized `flushPendingSyncQueue(...)`.
  - pending sync flush uses `lib/pendingSyncAuth.ts` (prefer `getSession()` then `getUser()`) with auth/session checks **inside** the flush function, not in the effect.
  - on mount, flush is triggered synchronously, then again via `queueMicrotask` and `setTimeout(0)` to catch session apply timing on reload.
  - `supabase.auth.onAuthStateChange` re-runs flush on every auth event (with console `Pending sync auth event received` while debugging).
  - pending sync flush also runs when browser connectivity returns via the `online` event (with `Pending sync online event received` while debugging).
  - successful retries remove the queue item; when the last item is removed, the `fitness-tracker-pending-sync` key is removed from localStorage.
  - stale/resolved retry handling:
    - items with missing required identifiers/payload are treated as stale and removed (`Pending sync item removed from queue (stale payload)`).
    - for `insert`, if a matching Supabase row already exists, the item is treated as already synced and removed.
    - for `update`/`delete`, if the matching Supabase row does not exist, the item is treated as stale/resolved and removed.
  - max retry guard:
    - if `retryCount >= 10`, the item is removed with `Pending sync item failed (max retries reached)` to prevent infinite retries.
  - failures that continue to retry log item context (`id`, `type`, `action`, `retryCount`) plus failure reason via `console.error`.
  - production logging cleanup:
    - temporary pending-sync/hydration/clear-all debug `console.log` instrumentation has been removed.
    - retained logs are now focused on actionable signals only:
      - `console.error` for failed Supabase/auth/flush operations
      - `console.warn` for non-fatal but important states (table not available, stale payload cleanup, max-retry cleanup, unresolved row lookups)
    - this reduces noisy success-path logging while preserving operational diagnostics.
- Matching strategy retained during retry:
  - workouts matched by `data.workoutId`
  - exercises matched by `data.id`
  - presets matched by `data.id` or `data.presetId`
- Duplicate insert safety guard:
  - before retrying queued inserts, providers check whether a matching row already exists for the user.
  - if it already exists, the queued insert is treated as resolved and removed.
  - if an item is deleted locally before its pending insert is synced, delete flow removes the matching pending insert (`Pending insert removed because item was deleted before sync`) instead of queueing an unnecessary delete.
- Minimal UX signal:
  - app shows subtle status only while queue has pending items:
    - `Saved locally - will sync when online.`
  - avoids adding a persistent disruptive sync banner.
- Current scope:
  - implemented for workouts, exercises, and presets without changing CPS/progression logic or replacing existing localStorage flows.
  - day-overview preset draft creation now participates in pending sync:
    - creating draft workouts (`isDraft: true`) in day overview queues workout pending inserts immediately when offline (`Offline draft workout queued`)
    - while online, draft creation attempts remote insert (`Draft workout Supabase insert/update attempted`)
    - submitting an existing draft now syncs by `workoutId` using update-when-found / insert-when-missing to avoid duplicate remote rows
  - clear-all behavior:
    - `clearAllData()` clears local/in-memory data for exercises, presets, workout history, `restByDate`, and `finishedByDate` immediately.
    - clear-all now also triggers remote deletion for current user rows in `workouts`, `exercises`, and `presets`.
    - if remote clear fails (or app is offline), clear-all queues pending delete-all items instead of silently leaving remote data.
    - clear-all resets the pending sync queue before applying clear operations, so stale prior operations do not repopulate cleared state.
    - workout clear uses bulk delete by authenticated user (`.from("workouts").delete().eq("user_id", activeUserId)`) and now logs:
      - `Clear all Supabase workouts started`
      - `Clear all Supabase workouts complete`
      - `Clear all Supabase workouts failed`
    - `clearAllData()` in `app/workout/page.tsx` now explicitly runs and awaits all three remote bulk deletes (`workouts`, `exercises`, `presets`) itself, logs per-table delete results, and queues per-table pending delete-all fallback when any delete fails.
    - pending sync delete-all support for workouts is handled before workoutId-based matching (`{ type: "workout", action: "delete", payload: { all: true } }`) to avoid stale classification.
  - hydration source-of-truth correction:
    - in `WorkoutHistoryProvider`, authenticated successful Supabase fetch now replaces local workout cache (instead of merging stale local history back in).
    - if Supabase returns empty workouts, workout cache is cleared for the active client and logs `Supabase returned empty workouts — clearing local workout cache`.
    - if hydration fails or user is not authenticated/offline, local fallback remains active and logs `Supabase hydration failed — using local fallback`.
    - pending workout insert/update items are overlaid after remote replacement so unsynced local entries remain visible until flush resolves.
    - pending workout deletes suppress matching hydrated remote rows, preventing deleted-local/pending-delete items from reappearing before retry.

## Data Mutation Architecture Rule

- Rule summary:
  - UI/page components must not perform app-data table writes directly.
  - All workout/exercise/preset create/update/delete must flow through provider mutations.
  - Provider mutations are responsible for local state update first, then Supabase sync + pending queue fallback.
- Allowed write surface:
  - workouts: `addWorkout(entry)`, `updateWorkoutEntry(...)`, `removeWorkoutsFromDate(...)`, `clearWorkoutHistory()`
  - exercises/presets: `addExercise(...)`, `addPreset(...)`, `updatePreset(...)`, `removePresets(...)`, `clearExercises()`, `clearPresets()`
- Disallowed pattern:
  - direct `supabase.from("workouts" | "exercises" | "presets")...` calls inside page/UI components for app-data mutations
  - direct localStorage writes from page/UI components for app-data domains
- Examples:
  - correct: `addWorkout(entry)`
  - incorrect: `supabase.from("workouts").insert(...)` inside `app/workout/page.tsx`
- Why:
  - enforces one mutation layer for local state, remote sync, offline queueing, retry, and duplicate-prevention behavior.

## Next Goals

* [ ] multi-exercise workouts
* [ ] better last-session preview UI
* [ ] UI polish / branding
* [ ] optional graphs (CPS over time)
