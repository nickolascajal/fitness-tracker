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

Top-level navigation contains only:

* `Your Library` (`/library`)
* `Log a Workout` (`/workout`)

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
* **Section layout refinements (`app/library/page.tsx` + `app/workout/page.tsx`):** Data Backup remains collapsible by default; preset list controls (including `Select`) are consolidated into the preset header action area; `Clear All Saved Data` remains in a lower, less dominant danger-zone area.

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

Manual creation duplicate rule:

* If entered name matches any master exercise in `EXERCISES_BY_LETTER` exactly by characters (case-insensitive), creation is rejected with:
  * `This exercise already exists.`

---

### Workout Logging

* **No library exercise is required** to open `/workout`: users can use the full flow with the **master exercise list** (and presets) even when `exercises` is empty; the old **“Create at least one exercise first…”** block is removed.
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

* On the **Log Workout** page (`/workout`), the **Clear All Saved Data** control is placed at the **bottom** of the page in a **subordinate “danger zone”** (border-top, smaller visual emphasis) so it does not compete with the main workout card; it remains a `<button type="button">` in **`app/workout/page.tsx`** and shares the same confirmation flow.
* Browser `alert()`/`confirm()` are **not used** for this action. Clicking the button opens an **inline confirmation box** near the button with:
  * prompt: `Are you sure you want to clear all saved data? This cannot be undone.`
  * actions: **Cancel** and **Confirm Clear**
* **Cancel** only closes the confirmation UI and does not modify state or storage.
* **Confirm Clear** calls **`clearAllData()`**, then closes the confirmation UI.
* **`clearAllData`** — only persistence + in-memory reset: `removeAllFitnessKeys()`, `clearExercises()`, `clearWorkoutHistory()`, then workout UI state (`selectedId`, `sets`, `submission`).

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

## Next Goals

* [ ] multi-exercise workouts
* [ ] better last-session preview UI
* [ ] UI polish / branding
* [ ] optional graphs (CPS over time)
