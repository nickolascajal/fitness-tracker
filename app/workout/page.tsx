"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { calculateCPSWithOptions } from "@/lib/calculateCPS";
import { calculateProgressionStage } from "@/lib/calculateProgressionStage";
import { generateRecommendation } from "@/lib/generateRecommendation";
import { removeAllFitnessKeys } from "@/lib/storage";
import { EXERCISES_BY_LETTER, getMasterExerciseByName } from "@/lib/exercises";
import { findExerciseWithSameNameAndConfig } from "@/lib/exerciseConfigMatch";
import { exerciseDuplicateKey, exerciseNameKey } from "@/lib/exerciseNameKey";
import { useExercises, type Exercise } from "@/app/exercises-provider";
import { type WorkoutHistoryEntry, useWorkoutHistory } from "@/app/workout-history-provider";
import { WorkoutDateNavigation } from "@/app/workout/WorkoutDateNavigation";
import { isYmdInWorkoutRange } from "@/app/workout/workoutDateNavUtils";
import { supabase } from "@/lib/supabaseClient";

type SetLog = {
  weight: string;
  reps: string;
  timeSeconds: string;
  rir: string;
  tir: string;
  rpe: string;
};

type SubmissionSummary = {
  workoutId: string;
  exerciseId: string;
  exerciseName: string;
  exerciseType: Exercise["type"];
  workoutDate: string;
  exerciseUnit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
  setsSnapshot: SetLog[];
  stageLabel: string;
  recommendation: string;
  sessionVolume: number;
  sessionCps: number | null;
  avgWeight: number;
  avgReps: number;
  /** Original submit timestamp; used as createdAt for this logged workout. */
  submittedAt: string;
  /** Last edit timestamp; null when never edited. */
  updatedAt: string | null;
  previousVolume: number | null;
  previousCps: number | null;
};

type PostSubmitView = "dashboard" | "inputs";
/** Pre-submit logging UI: one stage visible at a time (plus persistent workout date at top). */
type LogFlowPhase =
  | "day_overview"
  | "exercise_select"
  | "exercise_setup"
  | "exercise_config_edit"
  | "exercise_log";
type SetupExerciseType = "reps" | "time";
type ExerciseSetupForm = {
  setupType: SetupExerciseType;
  setCount: number;
  targetReps: number;
  increment: number;
  unit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
};

function getLocalDateString(date: Date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatWorkoutDate(dateString: string): string {
  if (!dateString) return "—";
  const [year, month, day] = dateString.split("-").map(Number);
  if (!year || !month || !day) return dateString;
  return new Date(year, month - 1, day).toLocaleDateString();
}

function buildSetsFromExercise(setCount: number): SetLog[] {
  const count = Math.max(1, Math.floor(setCount));
  return Array.from({ length: count }, () => ({
    weight: "",
    reps: "",
    timeSeconds: "",
    rir: "",
    tir: "",
    rpe: ""
  }));
}

function computeSessionVolume(sets: SetLog[]): number {
  return sets.reduce((accumulator, set) => {
    const weight = Number(set.weight);
    const reps = Number(set.reps);
    if (Number.isNaN(weight) || Number.isNaN(reps)) return accumulator;
    return accumulator + weight * reps;
  }, 0);
}

function averageValidSetValue(
  sets: SetLog[],
  field: "weight" | "reps"
): number {
  const values = sets
    .map((set) => Number(set[field]))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hasAtLeastOneValidSet(
  sets: SetLog[],
  exerciseType: Exercise["type"],
  foundation: number
): boolean {
  const requiresWeightAndTime = false; // Reserved for future hybrid/time+load requirements.
  if (exerciseType === "time") {
    return sets.some((set) =>
      requiresWeightAndTime
        ? Number(set.timeSeconds) > 0 && Number(set.weight) > 0
        : Number(set.timeSeconds) > 0
    );
  }
  return sets.some((set) => {
    const reps = Number(set.reps);
    const weight = Number(set.weight);
    if (!(reps > 0)) return false;
    if (weight > 0) return true;
    if (exerciseType === "bodyweight" && foundation > 0 && weight === 0) return true;
    return false;
  });
}

function hasAtLeastOneValidSnapshotSet(
  sets: Array<{ weight: string; reps: string; timeSeconds?: number }>,
  exerciseType: Exercise["type"],
  foundation: number
): boolean {
  const requiresWeightAndTime = false; // Reserved for future hybrid/time+load requirements.
  if (exerciseType === "time") {
    return sets.some((set) =>
      requiresWeightAndTime
        ? Number(set.timeSeconds ?? 0) > 0 && Number(set.weight) > 0
        : Number(set.timeSeconds ?? 0) > 0
    );
  }
  return sets.some((set) => {
    const reps = Number(set.reps);
    const weight = Number(set.weight);
    if (!(reps > 0)) return false;
    if (weight > 0) return true;
    if (exerciseType === "bodyweight" && foundation > 0 && weight === 0) return true;
    return false;
  });
}

function countValidSetsForWorkoutEntry(
  entry: WorkoutHistoryEntry,
  exercise: Exercise | undefined
): number {
  const exerciseType = exercise?.type ?? "weight";
  const foundation = exercise?.foundation ?? 0;
  if (exerciseType === "time") {
    return entry.sets.filter((set) => Number(set.timeSeconds ?? 0) > 0).length;
  }
  return entry.sets.filter((set) => {
    const reps = Number(set.reps);
    const weight = Number(set.weight);
    if (!(reps > 0)) return false;
    if (weight > 0) return true;
    if (exerciseType === "bodyweight" && foundation > 0 && weight === 0) return true;
    return false;
  }).length;
}

function buildEffectiveCpsSets(
  sets: Array<{ weight: string; reps: string }>,
  foundation: number
): Array<{ weight: string | number; reps: string }> {
  return sets.map((set) => {
    const enteredWeight = Number(set.weight);
    if (enteredWeight === 0 && foundation > 0) {
      return { ...set, weight: foundation };
    }
    return set;
  });
}

function formatVolume(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatOneDecimal(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  const rounded = Math.round(value * 10) / 10;
  return rounded.toFixed(1);
}

function formatChange(current: number, previous: number): string {
  const diff = current - previous;
  if (Math.abs(diff) < 0.01) return "0";
  if (diff > 0) return `+${formatVolume(diff)}`;
  return formatVolume(diff);
}

function volumeStatus(current: number, previous: number): string {
  const diff = current - previous;
  if (Math.abs(diff) < 0.01) return "Matched previous session";
  if (current > previous) return "Improved";
  return "Below previous session";
}

/** Display-only: 1 decimal place for all CPS numbers in the UI. */
function formatCps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return rounded.toFixed(1);
}

function formatCpsChange(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "—";
  const diff = current - previous;
  if (Math.abs(diff) < 0.05) return "0";
  if (diff > 0) return `+${formatCps(diff)}`;
  return formatCps(diff);
}

function computeCpsPercentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (Math.abs(previous) < 1e-6) return null;
  return ((current - previous) / previous) * 100;
}

function formatSignedOneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded) < 0.05) return "0.0";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

function formatCpsChangeSummary(current: number | null, previous: number | null): {
  text: string;
  className: string;
} {
  const percent = computeCpsPercentChange(current, previous);
  if (percent === null || current === null || previous === null) {
    return { text: "—", className: "text-slate-500" };
  }
  const diff = current - previous;
  if (Math.abs(diff) < 0.05) {
    return { text: "→ 0.0% (no change)", className: "text-amber-700" };
  }
  if (diff > 0) {
    return {
      text: `↑ ${formatSignedOneDecimal(percent)}% ( ${formatSignedOneDecimal(diff)} CPS )`,
      className: "text-emerald-700"
    };
  }
  return {
    text: `↓ ${formatSignedOneDecimal(percent)}% ( ${formatSignedOneDecimal(diff)} CPS )`,
    className: "text-rose-700"
  };
}

/** Header display for configured target time (seconds); mirrors reps `Target <n>`. */
function formatTargetTimeForHeader(targetSeconds: number | null | undefined): string {
  if (targetSeconds == null || !Number.isFinite(targetSeconds) || targetSeconds < 0) {
    return "—";
  }
  const s = Math.floor(targetSeconds);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function cpsStatus(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "—";
  return volumeStatus(current, previous);
}

function progressionInsight(recentSessions: WorkoutHistoryEntry[]): string | null {
  if (recentSessions.length < 3) return null;
  const latestThree = recentSessions.slice(0, 3);
  const [first] = latestThree;
  if (!first || !first.progressionStage || first.progressionStage === "—") return null;

  const sameStageThreeSessions = latestThree.every(
    (entry) => entry.progressionStage === first.progressionStage
  );
  if (!sameStageThreeSessions) return null;

  if (first.progressionStage.includes("REPS")) {
    const set2Reps = latestThree.map((entry) => Number(entry.sets[1]?.reps ?? ""));
    const validSet2Reps = set2Reps.every((value) => Number.isFinite(value) && value > 0);
    if (validSet2Reps && set2Reps[0] === set2Reps[1] && set2Reps[1] === set2Reps[2]) {
      return "Set 2 reps have stalled for 3 sessions.";
    }
  }

  return "You've been on the same progression step for 3 sessions.";
}

/** Subtle green / amber / red for Improved / Matched / Below. */
function statusIndicator(status: string): ReactNode {
  if (status === "—") {
    return <span className="text-slate-500">—</span>;
  }
  const tone =
    status === "Improved"
      ? "border-emerald-200/70 bg-emerald-50/90 text-emerald-800"
      : status === "Matched previous session"
        ? "border-amber-200/70 bg-amber-50/90 text-amber-900"
        : status === "Below previous session"
          ? "border-rose-200/70 bg-rose-50/90 text-rose-800"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 text-sm font-semibold leading-tight ${tone}`}
    >
      {status}
    </span>
  );
}

const LOG_TABLE_HEADER = [
  "whitespace-nowrap text-[0.65rem] font-semibold uppercase leading-tight tracking-wide text-slate-500",
  "sm:text-xs"
].join(" ");

function setRowGridClass(
  exerciseType: Exercise["type"],
  trackRir: boolean,
  trackRpe: boolean
): string {
  const base = "grid w-full min-w-0 items-end gap-1.5 sm:gap-3";
  if (exerciseType === "time") {
    if (trackRir && trackRpe) {
      return `${base} max-md:grid-cols-[2.25rem_minmax(2.4rem,1fr)_minmax(2.4rem,1fr)_2.65rem_2.65rem] md:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_4.25rem_4.25rem]`;
    }
    if (trackRir || trackRpe) {
      return `${base} max-md:grid-cols-[2.25rem_minmax(2.4rem,1fr)_minmax(2.4rem,1fr)_2.75rem] md:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_4.25rem]`;
    }
    return `${base} grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)]`;
  }
  if (trackRir && trackRpe) {
    return `${base} max-md:grid-cols-[2.25rem_minmax(2.4rem,1fr)_minmax(2.4rem,1fr)_2.65rem_2.65rem] md:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_4.25rem_4.25rem]`;
  }
  if (trackRir || trackRpe) {
    return `${base} max-md:grid-cols-[2.25rem_minmax(2.4rem,1fr)_minmax(2.4rem,1fr)_2.75rem] md:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_4.25rem]`;
  }
  return `${base} grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)]`;
}

function setLogTableMinWidth(
  exerciseType: Exercise["type"],
  trackRir: boolean,
  trackRpe: boolean
): string {
  if (exerciseType === "time") {
    if (trackRir && trackRpe) return "min-w-[20.5rem] sm:min-w-0";
    if (trackRir || trackRpe) return "min-w-[17.5rem] sm:min-w-0";
  }
  if (trackRir && trackRpe) return "min-w-[20rem] sm:min-w-0";
  if (trackRir || trackRpe) return "min-w-[16.5rem] sm:min-w-0";
  return "min-w-0";
}

function deepCopySetLogs(sets: SetLog[]): SetLog[] {
  return sets.map((set) => ({ ...set }));
}

function defaultIncrementForUnit(unit: "lbs" | "kg"): number {
  return unit === "lbs" ? 5 : 2.5;
}

function setupTypeFromExerciseType(exerciseType: Exercise["type"]): SetupExerciseType {
  return exerciseType === "time" ? "time" : "reps";
}

function buildSetupDefaults(setupType: SetupExerciseType = "reps"): ExerciseSetupForm {
  return {
    setupType,
    setCount: 3,
    targetReps: setupType === "time" ? 60 : 8,
    increment: 5,
    unit: "lbs",
    trackRir: false,
    trackRpe: false
  };
}

/** Day overview primary line: exercise name + config (from saved exercise by id). Display only. */
function formatDayOverviewWorkoutTitle(entry: WorkoutHistoryEntry, exerciseList: Exercise[]): string {
  const meta = exerciseList.find((e) => e.id === entry.exerciseId);
  if (meta) {
    return `${entry.exerciseName} — ${meta.setCount}x${meta.targetReps}`;
  }
  return entry.exerciseName;
}

/** Same band as `formatCpsChange` for treating CPS as “unchanged” (display only). */
const CPS_DAY_TREND_EQUAL_EPS = 0.05;

/**
 * Next-older session for the same exercise id (`historyByExerciseId` is newest first).
 * Display / comparison only — does not change CPS.
 */
function getPreviousComparableWorkoutEntry(
  entry: WorkoutHistoryEntry,
  byExercise: Record<string, WorkoutHistoryEntry[]>
): WorkoutHistoryEntry | null {
  const list = byExercise[entry.exerciseId];
  if (!list) return null;
  const idx = list.findIndex((e) => e.workoutId === entry.workoutId);
  if (idx < 0) return null;
  return list[idx + 1] ?? null;
}

function resolveCpsDayOverviewTrend(
  current: number | null,
  previous: number | null
): "up" | "flat" | "down" | null {
  if (current === null || previous === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const diff = current - previous;
  if (Math.abs(diff) < CPS_DAY_TREND_EQUAL_EPS) return "flat";
  if (diff > 0) return "up";
  return "down";
}

function cpsDayOverviewTrendIndicator(trend: "up" | "flat" | "down"): {
  mark: string;
  label: string;
  className: string;
} {
  if (trend === "up") {
    return {
      mark: "↑",
      label: "CPS up compared to the previous session for this exercise",
      className: "text-emerald-600"
    };
  }
  if (trend === "flat") {
    return {
      mark: "→",
      label: "CPS about the same as the previous session for this exercise",
      className: "text-amber-500"
    };
  }
  return {
    mark: "↓",
    label: "CPS down compared to the previous session for this exercise",
    className: "text-rose-600"
  };
}

export default function WorkoutPage() {
  const router = useRouter();
  const { exercises, presets, addExercise, clearExercises } = useExercises();
  const {
    historyByExerciseId,
    getWorkoutsByDate,
    isDateMarkedRest,
    setDateRestFlag,
    listRestDates,
    isDateFinished,
    setDateFinishedFlag,
    listFinishedDates,
    addWorkout,
    removeWorkoutsFromDate,
    updateWorkoutEntry,
    clearWorkoutHistory
  } = useWorkoutHistory();
  const [selectedId, setSelectedId] = useState("");
  const [selectedWorkoutDate, setSelectedWorkoutDate] = useState(getLocalDateString);
  /** In day overview: `true` = day list + week; `false` = full calendar for two-step day selection. */
  const [isDayExercisesListOpen, setIsDayExercisesListOpen] = useState(true);
  const calendarFirstTapYmdRef = useRef<string | null>(null);
  const [sets, setSets] = useState<SetLog[]>([]);
  const [submission, setSubmission] = useState<SubmissionSummary | null>(null);
  const [isWorkoutSubmitted, setIsWorkoutSubmitted] = useState(false);
  const [postSubmitView, setPostSubmitView] = useState<PostSubmitView>("dashboard");
  const [isInputsEditable, setIsInputsEditable] = useState(false);
  const [editData, setEditData] = useState<SetLog[] | null>(null);
  const [logFlowPhase, setLogFlowPhase] = useState<LogFlowPhase>("day_overview");
  const [pendingExerciseName, setPendingExerciseName] = useState<string | null>(null);
  /** When true, setup step includes an editable name (Create New Exercise path). */
  const [isCustomExerciseSetup, setIsCustomExerciseSetup] = useState(false);
  const [exerciseSearchQuery, setExerciseSearchQuery] = useState("");
  const [setupForm, setSetupForm] = useState<ExerciseSetupForm>(buildSetupDefaults);
  const [setupNameError, setSetupNameError] = useState<string | null>(null);
  const [configEditTargetWorkoutId, setConfigEditTargetWorkoutId] = useState<string | null>(null);
  const [configEditExerciseName, setConfigEditExerciseName] = useState("");
  const [configEditForm, setConfigEditForm] = useState<ExerciseSetupForm>(buildSetupDefaults);
  const [draftWorkoutId, setDraftWorkoutId] = useState<string | null>(null);
  const [submitValidationError, setSubmitValidationError] = useState<string | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  /** Day overview: multi-select to remove specific logged entries for the selected date only. */
  const [dayOverviewSelectMode, setDayOverviewSelectMode] = useState(false);
  const [dayOverviewSelectedWorkoutIds, setDayOverviewSelectedWorkoutIds] = useState<Set<string>>(
    () => new Set()
  );
  const [dayOverviewDeleteConfirmOpen, setDayOverviewDeleteConfirmOpen] = useState(false);
  const [restDayToggleWarning, setRestDayToggleWarning] = useState<string | null>(null);
  const [isRestDayToggleWarningVisible, setIsRestDayToggleWarningVisible] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const guardRoute = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        setAllowed(false);
        setAuthChecked(true);
        return;
      }

      setAllowed(true);
      setAuthChecked(true);
    };

    void guardRoute();
  }, [router]);

  const exitDayOverviewSelectMode = () => {
    setDayOverviewSelectMode(false);
    setDayOverviewSelectedWorkoutIds(new Set());
    setDayOverviewDeleteConfirmOpen(false);
  };

  const selectedExercise = exercises.find((e) => e.id === selectedId);
  const canSubmitCurrentWorkout = hasAtLeastOneValidSet(
    sets,
    selectedExercise?.type ?? "weight",
    selectedExercise?.foundation ?? 0
  );

  const lastSessionForSelected = useMemo((): WorkoutHistoryEntry | null => {
    if (!selectedExercise) return null;
    const history = historyByExerciseId[selectedExercise.id] ?? [];
    return history.find((entry) => entry.isDraft !== true) ?? null;
  }, [selectedExercise, historyByExerciseId]);

  const progressionInsightMessage = useMemo((): string | null => {
    if (!selectedExercise) return null;
    const recent = (historyByExerciseId[selectedExercise.id] ?? []).filter(
      (entry) => entry.isDraft !== true
    );
    return progressionInsight(recent);
  }, [selectedExercise, historyByExerciseId]);

  const workoutsForSelectedDate = useMemo(
    () => getWorkoutsByDate(selectedWorkoutDate),
    [getWorkoutsByDate, selectedWorkoutDate]
  );
  const selectedDateIsRestDay = isDateMarkedRest(selectedWorkoutDate);
  const selectedDateIsFinished = isDateFinished(selectedWorkoutDate);
  const isAddWorkoutBlocked = selectedDateIsRestDay || selectedDateIsFinished;
  const restDates = useMemo(() => new Set(listRestDates()), [listRestDates]);
  const finishedDates = useMemo(() => new Set(listFinishedDates()), [listFinishedDates]);
  const recentExercises = useMemo(() => {
    const allEntries = Object.values(historyByExerciseId).flat();
    const sorted = allEntries.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    const seen = new Set<string>();
    const list: { name: string; exerciseId: string; configured: Exercise | undefined }[] = [];
    for (const entry of sorted) {
      const key = exerciseNameKey(entry.exerciseName);
      if (seen.has(key)) continue;
      seen.add(key);
      const configured = exercises.find((exercise) => exercise.id === entry.exerciseId);
      list.push({ name: entry.exerciseName, exerciseId: entry.exerciseId, configured });
      if (list.length >= 8) break;
    }
    return list;
  }, [historyByExerciseId, exercises]);

  const filteredRecentExercises = useMemo(() => {
    const q = exerciseSearchQuery.trim().toLowerCase();
    if (!q) return recentExercises;
    return recentExercises.filter((r) => r.name.toLowerCase().includes(q));
  }, [recentExercises, exerciseSearchQuery]);

  const userCreatedExercises = useMemo(
    () => exercises.filter((exercise) => exercise.isUserCreated === true),
    [exercises]
  );

  const filteredUserCreatedExercises = useMemo(() => {
    const q = exerciseSearchQuery.trim().toLowerCase();
    if (!q) return userCreatedExercises;
    return userCreatedExercises.filter((exercise) => exercise.name.toLowerCase().includes(q));
  }, [userCreatedExercises, exerciseSearchQuery]);

  const filteredExercisesByLetter = useMemo(() => {
    const q = exerciseSearchQuery.trim().toLowerCase();
    if (!q) {
      return Object.fromEntries(
        Object.entries(EXERCISES_BY_LETTER).map(([letter, entries]) => [
          letter,
          entries.map((entry) => entry.name)
        ])
      ) as Readonly<Record<string, readonly string[]>>;
    }
    const out: Record<string, string[]> = {};
    for (const [letter, entries] of Object.entries(EXERCISES_BY_LETTER)) {
      const filtered = entries.map((entry) => entry.name).filter((n) => n.toLowerCase().includes(q));
      if (filtered.length) out[letter] = filtered;
    }
    return out;
  }, [exerciseSearchQuery]);
  const masterExerciseDuplicateKeys = useMemo(() => {
    const names = new Set<string>();
    for (const list of Object.values(EXERCISES_BY_LETTER)) {
      for (const exercise of list) names.add(exerciseDuplicateKey(exercise.name));
    }
    return names;
  }, []);

  const handleExerciseChange = (id: string, exerciseOverride?: Exercise) => {
    setSelectedId(id);
    setConfigEditTargetWorkoutId(null);
    setConfigEditExerciseName("");
    setConfigEditForm(buildSetupDefaults());
    setDraftWorkoutId(null);
    setSubmitValidationError(null);
    setSubmission(null);
    setIsWorkoutSubmitted(false);
    setPostSubmitView("dashboard");
    setIsInputsEditable(false);
    setEditData(null);
    const exercise = exerciseOverride ?? exercises.find((e) => e.id === id);
    if (exercise) {
      setSets(buildSetsFromExercise(exercise.setCount));
    } else {
      setSets([]);
    }
  };

  /** All-exercises (master) list: always open setup first; OK deduplicates by full config (see `handleConfirmExerciseSetup`). */
  const selectExerciseFromLibrary = (exerciseName: string) => {
    const master = getMasterExerciseByName(exerciseName);
    const setupType = setupTypeFromExerciseType(master?.type ?? "weight");
    setSelectedId("");
    setSets([]);
    setDraftWorkoutId(null);
    setSubmitValidationError(null);
    setIsCustomExerciseSetup(false);
    setSetupNameError(null);
    setPendingExerciseName(exerciseName);
    setSetupForm(buildSetupDefaults(setupType));
    setLogFlowPhase("exercise_setup");
  };

  const selectConfiguredExercise = (exerciseId: string) => {
    const configured = exercises.find((exercise) => exercise.id === exerciseId);
    if (!configured) return;
    setPendingExerciseName(null);
    setIsCustomExerciseSetup(false);
    setSetupNameError(null);
    setSetupForm(buildSetupDefaults());
    handleExerciseChange(configured.id, configured);
    setLogFlowPhase("exercise_log");
  };

  const openExerciseConfigEditor = (entry: WorkoutHistoryEntry) => {
    const exerciseMeta = exercises.find((exercise) => exercise.id === entry.exerciseId);
    const defaultSetCount = Math.max(1, entry.sets.length || 1);
    setConfigEditTargetWorkoutId(entry.workoutId);
    setConfigEditExerciseName(entry.exerciseName);
    setConfigEditForm({
      setCount: exerciseMeta?.setCount ?? defaultSetCount,
      targetReps: exerciseMeta?.targetReps ?? 8,
      increment: exerciseMeta?.increment ?? 5,
      setupType: exerciseMeta ? setupTypeFromExerciseType(exerciseMeta.type) : "reps",
      unit: exerciseMeta?.unit ?? "lbs",
      trackRir:
        exerciseMeta?.trackRir ??
        entry.sets.some((set) => (set.rir ?? "").trim() !== ""),
      trackRpe:
        exerciseMeta?.trackRpe ??
        entry.sets.some((set) => (set.rpe ?? "").trim() !== "")
    });
    setLogFlowPhase("exercise_config_edit");
  };

  const applyPresetToSelectedDay = (presetId: string) => {
    if (isAddWorkoutBlocked) return;
    const preset = presets.find((item) => item.id === presetId);
    if (!preset || preset.exercises.length === 0) return;

    for (const presetExercise of preset.exercises) {
      const config = {
        setCount: presetExercise.setCount,
        targetReps: presetExercise.targetReps,
        increment: presetExercise.increment,
        unit: presetExercise.unit,
        trackRir: presetExercise.trackRir,
        trackRpe: presetExercise.trackRpe
      };
      const existing = findExerciseWithSameNameAndConfig(exercises, presetExercise.name, config);
      const configuredExercise =
        existing ??
        addExercise({
          name: presetExercise.name,
          type: "weight",
          foundation: 0,
          targetReps: config.targetReps,
          setCount: config.setCount,
          increment: config.increment,
          unit: config.unit,
          trackRir: config.trackRir,
          trackRpe: config.trackRpe,
          isUserCreated: true
        });

      const draftEntry: WorkoutHistoryEntry = {
        workoutId: crypto.randomUUID(),
        exerciseId: configuredExercise.id,
        exerciseName: configuredExercise.name,
        workoutDate: selectedWorkoutDate,
        isDraft: true,
        sets: buildSetsFromExercise(configuredExercise.setCount).map(() => ({
          weight: "",
          reps: "",
          timeSeconds: 0,
          rir: "",
          tir: "",
          rpe: ""
        })),
        sessionVolume: 0,
        sessionCps: null,
        progressionStage: "—",
        recommendation: "Added from preset — enter your sets to log this workout.",
        submittedAt: new Date().toISOString()
      };
      addWorkout(draftEntry);

    }
    setExerciseSearchQuery("");
    goBackToDayOverview();
  };

  const startCreateNewExercise = () => {
    setSelectedId("");
    setSets([]);
    setDraftWorkoutId(null);
    setSubmitValidationError(null);
    setIsCustomExerciseSetup(true);
    setSetupNameError(null);
    setPendingExerciseName("");
    setSetupForm(buildSetupDefaults("reps"));
    setLogFlowPhase("exercise_setup");
  };

  /** Recent row: use history `exerciseId` as source of truth (avoids name-only false matches). */
  const selectRecentExercise = (exerciseId: string, displayName: string) => {
    const configured = exercises.find((exercise) => exercise.id === exerciseId);
    if (configured) {
      setPendingExerciseName(null);
      setIsCustomExerciseSetup(false);
      setSetupForm(buildSetupDefaults());
      handleExerciseChange(configured.id);
      setLogFlowPhase("exercise_log");
      return;
    }
    setSelectedId("");
    setSets([]);
    setDraftWorkoutId(null);
    setSubmitValidationError(null);
    setIsCustomExerciseSetup(false);
    setPendingExerciseName(displayName);
    const master = getMasterExerciseByName(displayName);
    setSetupForm(buildSetupDefaults(setupTypeFromExerciseType(master?.type ?? "weight")));
    setLogFlowPhase("exercise_setup");
  };

  const handleConfirmExerciseSetup = () => {
    if (pendingExerciseName === null) return;
    const name = pendingExerciseName.trim();
    if (!name) return;
    if (isCustomExerciseSetup && masterExerciseDuplicateKeys.has(exerciseDuplicateKey(name))) {
      setSetupNameError("This exercise already exists.");
      return;
    }
    setSetupNameError(null);
    const config = {
      setCount: setupForm.setCount,
      targetReps: setupForm.targetReps,
      increment: setupForm.increment,
      unit: setupForm.unit,
      trackRir: setupForm.trackRir,
      trackRpe: setupForm.trackRpe
    };
    const resolvedExerciseType: Exercise["type"] =
      setupForm.setupType === "time"
        ? "time"
        : isCustomExerciseSetup
          ? "weight"
          : (getMasterExerciseByName(name)?.type ?? "weight");
    const existing = findExerciseWithSameNameAndConfig(
      exercises.filter((exercise) => exercise.type === resolvedExerciseType),
      name,
      config
    );
    if (existing) {
      setPendingExerciseName(null);
      setIsCustomExerciseSetup(false);
      handleExerciseChange(existing.id);
      setLogFlowPhase("exercise_log");
      return;
    }
    const created = addExercise({
      name,
      type: resolvedExerciseType,
      foundation: isCustomExerciseSetup
        ? 0
        : (getMasterExerciseByName(name)?.foundation ?? 0),
      targetReps: config.targetReps,
      setCount: config.setCount,
      increment: config.increment,
      unit: config.unit,
      trackRir: config.trackRir,
      trackRpe: config.trackRpe,
      isUserCreated: isCustomExerciseSetup
    });
    setPendingExerciseName(null);
    setIsCustomExerciseSetup(false);
    setSetupNameError(null);
    handleExerciseChange(created.id, created);
    setLogFlowPhase("exercise_log");
  };

  const handleSubmitExerciseConfigEdit = () => {
    if (!configEditTargetWorkoutId) return;
    const trimmedName = configEditExerciseName.trim();
    if (!trimmedName) return;
    const config = {
      setCount: configEditForm.setCount,
      targetReps: configEditForm.targetReps,
      increment: configEditForm.increment,
      unit: configEditForm.unit,
      trackRir: configEditForm.trackRir,
      trackRpe: configEditForm.trackRpe
    };
    const currentEntry = workoutsForSelectedDate.find(
      (entry) => entry.workoutId === configEditTargetWorkoutId
    );
    const currentExercise = currentEntry
      ? exercises.find((exercise) => exercise.id === currentEntry.exerciseId)
      : undefined;
    const existing = findExerciseWithSameNameAndConfig(exercises, trimmedName, config);
    const resolvedExercise =
      existing ??
      addExercise({
        name: trimmedName,
        type: currentExercise?.type ?? "weight",
        foundation: currentExercise?.foundation ?? 0,
        targetReps: config.targetReps,
        setCount: config.setCount,
        increment: config.increment,
        unit: config.unit,
        trackRir: config.trackRir,
        trackRpe: config.trackRpe,
        isUserCreated: currentExercise?.isUserCreated ?? true
      });
    updateWorkoutEntry(configEditTargetWorkoutId, (entry) => ({
      ...entry,
      exerciseId: resolvedExercise.id,
      exerciseName: resolvedExercise.name
    }));
    setConfigEditTargetWorkoutId(null);
    setConfigEditExerciseName("");
    setConfigEditForm(buildSetupDefaults());
    setLogFlowPhase("day_overview");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedExercise) return;
    if (isDateMarkedRest(selectedWorkoutDate)) return;

    if (!canSubmitCurrentWorkout) {
      setSubmitValidationError("Log at least one set to submit this workout.");
      return;
    }
    setSubmitValidationError(null);

    const previousEntry =
      (historyByExerciseId[selectedExercise.id] ?? []).find(
        (entry) => entry.isDraft !== true && entry.workoutId !== draftWorkoutId
      ) ?? null;
    const previousVolume = previousEntry?.sessionVolume ?? null;
    const previousCps = previousEntry?.sessionCps ?? null;

    const performanceSets = sets.map((set) => ({ weight: set.weight, reps: set.reps }));
    const effectiveCpsSets = buildEffectiveCpsSets(performanceSets, selectedExercise.foundation);

    const stage = calculateProgressionStage(
      performanceSets,
      selectedExercise.targetReps,
      selectedExercise.setCount
    );
    const recommendation = generateRecommendation(
      performanceSets,
      stage,
      selectedExercise.targetReps,
      selectedExercise.increment
    );
    const sessionVolume = computeSessionVolume(sets);
    const cpsInputSets = selectedExercise.type === "time"
      ? sets.map((set) => ({
          weight: set.weight,
          reps: set.reps,
          timeSeconds: Number(set.timeSeconds ?? "")
        }))
      : effectiveCpsSets.map((set) => ({ ...set }));
    const sessionCps = calculateCPSWithOptions(
      cpsInputSets,
      selectedExercise.targetReps,
      {
        exerciseType: selectedExercise.type,
        targetTimeSeconds: selectedExercise.targetReps,
        foundation: selectedExercise.foundation
      }
    );
    const submittedAt = new Date().toISOString();
    const workoutId = draftWorkoutId ?? crypto.randomUUID();
    const workoutDate = selectedWorkoutDate || getLocalDateString();
    const setsSnapshot = sets.map((set) => ({
      ...set,
      rir: selectedExercise.trackRir && selectedExercise.type !== "time" ? set.rir : "",
      tir: selectedExercise.trackRir && selectedExercise.type === "time" ? set.tir : "",
      rpe: selectedExercise.trackRpe ? set.rpe : ""
    }));
    const setsSnapshotForStorage = setsSnapshot.map((set) => ({
      weight: set.weight,
      reps: set.reps,
      timeSeconds: Number(set.timeSeconds) > 0 ? Number(set.timeSeconds) : 0,
      rir: set.rir,
      tir: set.tir,
      rpe: selectedExercise.trackRpe ? set.rpe : ""
    }));

    if (draftWorkoutId) {
      updateWorkoutEntry(draftWorkoutId, (entry) => ({
        ...entry,
        isDraft: false,
        exerciseId: selectedExercise.id,
        exerciseName: selectedExercise.name,
        workoutDate,
        sets: setsSnapshotForStorage,
        sessionVolume,
        sessionCps,
        progressionStage: stage ?? "—",
        recommendation,
        submittedAt
      }));
    } else {
      addWorkout({
        workoutId,
        exerciseId: selectedExercise.id,
        exerciseName: selectedExercise.name,
        workoutDate,
        isDraft: false,
        sets: setsSnapshotForStorage,
        sessionVolume,
        sessionCps,
        progressionStage: stage ?? "—",
        recommendation,
        submittedAt
      });
    }

    setSubmission({
      workoutId,
      exerciseId: selectedExercise.id,
      exerciseName: selectedExercise.name,
      exerciseType: selectedExercise.type,
      workoutDate,
      exerciseUnit: selectedExercise.unit,
      trackRir: selectedExercise.trackRir,
      trackRpe: selectedExercise.trackRpe,
      setsSnapshot,
      stageLabel: stage ?? "—",
      recommendation,
      sessionVolume,
      sessionCps,
      avgWeight: averageValidSetValue(sets, "weight"),
      avgReps: averageValidSetValue(sets, "reps"),
      submittedAt,
      updatedAt: null,
      previousVolume,
      previousCps
    });
    setDraftWorkoutId(null);
    setIsWorkoutSubmitted(true);
    setPostSubmitView("dashboard");
    setIsInputsEditable(false);
    setEditData(null);
  };

  const updateSet = (
    index: number,
    field: "weight" | "reps" | "timeSeconds" | "rir" | "tir" | "rpe",
    value: string
  ) => {
    if (!selectedExercise) return;
    const targetReps = selectedExercise.targetReps;
    if (submitValidationError) setSubmitValidationError(null);

    setSets((previous) => {
      let next = previous.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      );

      if (selectedExercise.type === "time") {
        return next;
      }

      const cur = next[index];
      const hasNext = index + 1 < next.length;
      if (!hasNext) return next;
      if (cur.weight.trim() === "" || cur.reps.trim() === "") return next;

      const w = Number(cur.weight);
      const r = Number(cur.reps);
      if (Number.isNaN(w) || Number.isNaN(r) || r < targetReps) return next;
      if (next[index + 1].weight.trim() !== "") return next;

      next = next.map((item, i) =>
        i === index + 1 ? { ...item, weight: cur.weight } : item
      );
      return next;
    });
  };

  const liveVolume = useMemo(() => computeSessionVolume(sets), [sets]);

  const handlePostSubmitSetChange = (
    index: number,
    field: "weight" | "reps" | "timeSeconds" | "rir" | "tir" | "rpe",
    value: string
  ) => {
    if (!isInputsEditable || !editData) return;
    if (submitValidationError) setSubmitValidationError(null);
    setEditData((previous) => {
      if (!previous) return previous;
      return previous.map((set, i) =>
        i === index ? { ...set, [field]: value } : set
      );
    });
  };

  const handleSaveWorkoutChanges = () => {
    if (!selectedExercise || !submission || !editData) return;

    const nextSets = deepCopySetLogs(editData).map((set) => ({
      weight: set.weight,
      reps: set.reps,
      timeSeconds: set.timeSeconds,
      rir: selectedExercise.trackRir && selectedExercise.type !== "time" ? set.rir : "",
      tir: selectedExercise.trackRir && selectedExercise.type === "time" ? set.tir : "",
      rpe: selectedExercise.trackRpe ? set.rpe : ""
    }));
    const nextSetsForStorage = nextSets.map((set) => ({
      weight: set.weight,
      reps: set.reps,
      timeSeconds: Number(set.timeSeconds) > 0 ? Number(set.timeSeconds) : 0,
      rir: set.rir,
      tir: set.tir,
      rpe: set.rpe
    }));
    if (!hasAtLeastOneValidSet(nextSets, selectedExercise.type, selectedExercise.foundation)) {
      setSubmitValidationError("Log at least one set to submit this workout.");
      return;
    }
    setSubmitValidationError(null);
    const performanceSets = nextSets.map((set) => ({ weight: set.weight, reps: set.reps }));
    const effectiveCpsSets = buildEffectiveCpsSets(performanceSets, selectedExercise.foundation);
    const stage = calculateProgressionStage(performanceSets, selectedExercise.targetReps, selectedExercise.setCount);
    const recommendation = generateRecommendation(performanceSets, stage, selectedExercise.targetReps, selectedExercise.increment);
    const sessionVolume = computeSessionVolume(nextSets);
    const cpsInputSets = selectedExercise.type === "time"
      ? nextSets.map((set) => ({
          weight: set.weight,
          reps: set.reps,
          timeSeconds: Number(set.timeSeconds ?? "")
        }))
      : effectiveCpsSets.map((set) => ({ ...set }));
    const sessionCps = calculateCPSWithOptions(
      cpsInputSets,
      selectedExercise.targetReps,
      {
        exerciseType: selectedExercise.type,
        targetTimeSeconds: selectedExercise.targetReps,
        foundation: selectedExercise.foundation
      }
    );

    const nextSubmission: SubmissionSummary = {
      ...submission,
      setsSnapshot: nextSets,
      stageLabel: stage ?? "—",
      recommendation,
      sessionVolume,
      sessionCps,
      avgWeight: averageValidSetValue(nextSets, "weight"),
      avgReps: averageValidSetValue(nextSets, "reps"),
      updatedAt: new Date().toISOString()
    };

    setSets(nextSets);
    setSubmission(nextSubmission);
    updateWorkoutEntry(submission.workoutId, (entry) => ({
      ...entry,
      // Preserve original log day and original created timestamp.
      workoutDate: entry.workoutDate ?? getLocalDateString(new Date(entry.submittedAt)),
      submittedAt: entry.submittedAt,
      updatedAt: nextSubmission.updatedAt ?? undefined,
      sets: nextSetsForStorage,
      sessionVolume,
      sessionCps,
      progressionStage: stage ?? "—",
      recommendation
    }));
    setIsInputsEditable(false);
    setEditData(null);
    setPostSubmitView("dashboard");
  };

  const openWorkoutEntry = (entry: WorkoutHistoryEntry) => {
    const exerciseMeta = exercises.find((exercise) => exercise.id === entry.exerciseId);
    const list = (historyByExerciseId[entry.exerciseId] ?? []).filter((item) => item.isDraft !== true);
    const entryIndex = list.findIndex((item) => item.workoutId === entry.workoutId);
    const previousEntry = entryIndex >= 0 ? list[entryIndex + 1] ?? null : null;
    const setsSnapshot = entry.sets.map((set) => ({
      weight: set.weight,
      reps: set.reps,
      timeSeconds: String(set.timeSeconds ?? 0),
      rir: set.rir ?? "",
      tir: set.tir ?? "",
      rpe: set.rpe ?? ""
    }));
    const exerciseType = exerciseMeta?.type ?? "weight";
    const isUnsubmittedEntry =
      entry.isDraft === true || !hasAtLeastOneValidSnapshotSet(entry.sets, exerciseType, exerciseMeta?.foundation ?? 0);

    setSelectedWorkoutDate(entry.workoutDate ?? getLocalDateString(new Date(entry.submittedAt)));
    setSelectedId(entry.exerciseId);
    setSets(
      setsSnapshot.length > 0
        ? deepCopySetLogs(setsSnapshot)
        : buildSetsFromExercise(exerciseMeta?.setCount ?? 1)
    );
    setSubmitValidationError(null);
    if (isUnsubmittedEntry) {
      setDraftWorkoutId(entry.workoutId);
      setSubmission(null);
      setPostSubmitView("dashboard");
      setIsInputsEditable(false);
      setEditData(null);
      setLogFlowPhase("exercise_log");
      setIsWorkoutSubmitted(false);
      return;
    }
    setDraftWorkoutId(null);
    setSubmission({
      workoutId: entry.workoutId,
      exerciseId: entry.exerciseId,
      exerciseName: entry.exerciseName,
      exerciseType,
      workoutDate: entry.workoutDate ?? getLocalDateString(new Date(entry.submittedAt)),
      exerciseUnit: exerciseMeta?.unit ?? "lbs",
      trackRir: exerciseMeta?.trackRir ?? setsSnapshot.some((set) => set.rir.trim() !== ""),
      trackRpe: exerciseMeta?.trackRpe ?? setsSnapshot.some((set) => set.rpe.trim() !== ""),
      setsSnapshot,
      stageLabel: entry.progressionStage,
      recommendation: entry.recommendation,
      sessionVolume: entry.sessionVolume,
      sessionCps: entry.sessionCps,
      avgWeight: averageValidSetValue(setsSnapshot, "weight"),
      avgReps: averageValidSetValue(setsSnapshot, "reps"),
      submittedAt: entry.submittedAt,
      updatedAt: entry.updatedAt ?? null,
      previousVolume: previousEntry?.sessionVolume ?? null,
      previousCps: previousEntry?.sessionCps ?? null
    });
    setPostSubmitView("dashboard");
    setIsInputsEditable(false);
    setEditData(null);
    setLogFlowPhase("day_overview");
    setIsWorkoutSubmitted(true);
  };

  const goBackToDayOverview = () => {
    exitDayOverviewSelectMode();
    calendarFirstTapYmdRef.current = null;
    setIsDayExercisesListOpen(true);
    setLogFlowPhase("day_overview");
    setSelectedId("");
    setSets([]);
    setDraftWorkoutId(null);
    setSubmitValidationError(null);
    setPendingExerciseName(null);
    setIsCustomExerciseSetup(false);
    setSetupNameError(null);
    setConfigEditTargetWorkoutId(null);
    setConfigEditExerciseName("");
    setConfigEditForm(buildSetupDefaults());
    setExerciseSearchQuery("");
    setSetupForm(buildSetupDefaults());
  };

  /** In day overview with the exercise list: one tap on the week strip to switch days. */
  const handleDayListModeWeek = (ymd: string) => {
    if (!isYmdInWorkoutRange(ymd)) return;
    setSelectedWorkoutDate(ymd);
  };

  /**
   * In calendar (two-step) mode: first tap only selects; second tap on the same
   * day opens the day overview list for that date.
   */
  const handleCalendarTwoStepDay = (ymd: string) => {
    if (!isYmdInWorkoutRange(ymd)) return;
    if (ymd === calendarFirstTapYmdRef.current) {
      goBackToDayOverview();
    } else {
      setSelectedWorkoutDate(ymd);
      calendarFirstTapYmdRef.current = ymd;
    }
  };

  const openCalendarForDatePicking = () => {
    exitDayOverviewSelectMode();
    setIsDayExercisesListOpen(false);
    calendarFirstTapYmdRef.current = null;
  };

  const closeCalendarToDayList = () => {
    setIsDayExercisesListOpen(true);
    calendarFirstTapYmdRef.current = null;
  };

  /** Leave the input step without saving; return to the exercise list for this date. */
  const handleBackToExerciseSelector = () => {
    setLogFlowPhase("exercise_select");
    setSelectedId("");
    setSets([]);
    setDraftWorkoutId(null);
    setSubmitValidationError(null);
    setPendingExerciseName(null);
    setIsCustomExerciseSetup(false);
    setConfigEditTargetWorkoutId(null);
    setConfigEditExerciseName("");
    setConfigEditForm(buildSetupDefaults());
    setExerciseSearchQuery("");
    setSetupForm(buildSetupDefaults());
  };

  const handleBackToDayOverview = () => {
    setIsWorkoutSubmitted(false);
    setSubmission(null);
    setDraftWorkoutId(null);
    setSubmitValidationError(null);
    setPostSubmitView("dashboard");
    setIsInputsEditable(false);
    setEditData(null);
    goBackToDayOverview();
  };

  const handleCancelWorkoutChanges = () => {
    setIsInputsEditable(false);
    setEditData(null);
    setSubmitValidationError(null);
  };

  const clearAllData = () => {
    removeAllFitnessKeys();
    clearExercises();
    clearWorkoutHistory();
    exitDayOverviewSelectMode();
    calendarFirstTapYmdRef.current = null;
    setIsDayExercisesListOpen(true);
    setSelectedId("");
    setSelectedWorkoutDate(getLocalDateString());
    setSets([]);
    setSubmission(null);
    setIsWorkoutSubmitted(false);
    setDraftWorkoutId(null);
    setSubmitValidationError(null);
    setEditData(null);
    setLogFlowPhase("day_overview");
    setPendingExerciseName(null);
    setIsCustomExerciseSetup(false);
    setConfigEditTargetWorkoutId(null);
    setConfigEditExerciseName("");
    setConfigEditForm(buildSetupDefaults());
    setExerciseSearchQuery("");
    setSetupForm(buildSetupDefaults());
  };

  const handleClearAllData = () => {
    setIsClearConfirmOpen(true);
  };

  const handleCancelClearAllData = () => {
    setIsClearConfirmOpen(false);
  };

  const handleConfirmClearAllData = () => {
    clearAllData();
    setIsClearConfirmOpen(false);
  };

  const handleLogAnotherWorkout = () => {
    setSubmission(null);
    setIsWorkoutSubmitted(false);
    setDraftWorkoutId(null);
    setSubmitValidationError(null);
    setPostSubmitView("dashboard");
    setIsInputsEditable(false);
    setEditData(null);
    setSelectedId("");
    setSets([]);
    setLogFlowPhase("exercise_select");
    setPendingExerciseName(null);
    setIsCustomExerciseSetup(false);
    setExerciseSearchQuery("");
    setSetupForm(buildSetupDefaults());
  };

  const isAnalysisMode = isWorkoutSubmitted && submission !== null;

  useEffect(() => {
    if (logFlowPhase !== "day_overview") {
      setDayOverviewSelectMode(false);
      setDayOverviewSelectedWorkoutIds(new Set());
      setDayOverviewDeleteConfirmOpen(false);
    }
  }, [logFlowPhase]);

  const toggleDayOverviewWorkout = (workoutId: string) => {
    setDayOverviewSelectedWorkoutIds((prev) => {
      const next = new Set(prev);
      if (next.has(workoutId)) next.delete(workoutId);
      else next.add(workoutId);
      return next;
    });
  };

  const handleConfirmDeleteSelectedWorkouts = () => {
    const ids = Array.from(dayOverviewSelectedWorkoutIds);
    if (ids.length === 0) return;
    removeWorkoutsFromDate(selectedWorkoutDate, ids);
    exitDayOverviewSelectMode();
  };

  const handleToggleRestDay = (checked: boolean) => {
    if (checked && workoutsForSelectedDate.length > 0) {
      setRestDayToggleWarning("This day already has logged workouts and cannot be marked as rest.");
      return;
    }
    setRestDayToggleWarning(null);
    setDateRestFlag(selectedWorkoutDate, checked);
    if (checked) {
      exitDayOverviewSelectMode();
    }
  };

  const handleFinishSelectedDay = () => {
    if (selectedDateIsRestDay || workoutsForSelectedDate.length === 0) return;
    setDateFinishedFlag(selectedWorkoutDate, !selectedDateIsFinished);
  };

  useEffect(() => {
    if (!restDayToggleWarning) return;
    setIsRestDayToggleWarningVisible(true);
    const hideTimer = window.setTimeout(() => {
      setIsRestDayToggleWarningVisible(false);
    }, 2600);
    const clearTimer = window.setTimeout(() => {
      setRestDayToggleWarning(null);
    }, 3200);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [restDayToggleWarning]);

  useEffect(() => {
    setRestDayToggleWarning(null);
    setIsRestDayToggleWarningVisible(false);
  }, [selectedWorkoutDate]);

  if (!authChecked || !allowed) {
    return null;
  }

  return (
    <section className="space-y-5 pt-1 md:pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Log Workout Session</h1>
        <p className="mt-1 text-sm text-slate-500">Enter your sets, then review performance on the right.</p>
      </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <form onSubmit={handleSubmit}>
            <div className="grid gap-6 p-5 lg:p-6">
              {!isAnalysisMode ? (
                <div className="space-y-5">
                  <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
                    {logFlowPhase === "day_overview" ? (
                      isDayExercisesListOpen ? (
                        <>
                          <div>
                            <WorkoutDateNavigation
                              value={selectedWorkoutDate}
                              showMonthCalendar={false}
                              allowInteraction
                              restDates={restDates}
                              finishedDates={finishedDates}
                              onWeekdayClick={handleDayListModeWeek}
                            />
                          </div>
                          <div className="mt-4 space-y-3">
                            <p className="text-sm text-slate-600">
                              <span className="font-medium text-slate-700">Workout day: </span>
                              <span className="font-semibold text-slate-900">
                                {formatWorkoutDate(selectedWorkoutDate)}
                              </span>
                            </p>
                            <button
                              type="button"
                              onClick={openCalendarForDatePicking}
                              className="w-fit rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-100"
                            >
                              Choose on calendar
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="mt-1 text-sm text-slate-600">
                            <span className="font-medium text-slate-700">Selected: </span>
                            <span className="font-semibold text-slate-900">
                              {formatWorkoutDate(selectedWorkoutDate)}
                            </span>
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            Select a day in the week or the month, then tap the <strong>same</strong> day
                            again to open workouts for that day.
                          </p>
                          <div className="mt-3">
                            <WorkoutDateNavigation
                              value={selectedWorkoutDate}
                              showMonthCalendar
                              allowInteraction
                              historyByExerciseId={historyByExerciseId}
                              restDates={restDates}
                              finishedDates={finishedDates}
                              onWeekdayClick={handleCalendarTwoStepDay}
                              onMonthdayClick={handleCalendarTwoStepDay}
                              onUserNavigateMonth={() => {
                                calendarFirstTapYmdRef.current = null;
                              }}
                            />
                          </div>
                          <div className="mt-3 flex flex-wrap justify-end">
                            <button
                              type="button"
                              onClick={closeCalendarToDayList}
                              className="w-fit rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-100"
                            >
                              Close calendar
                            </button>
                          </div>
                        </>
                      )
                    ) : (
                      <>
                        <div className="mt-2">
                          <WorkoutDateNavigation
                            value={selectedWorkoutDate}
                            showMonthCalendar={false}
                            allowInteraction={false}
                            restDates={restDates}
                            finishedDates={finishedDates}
                          />
                        </div>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-sm text-slate-600">
                            <span className="text-slate-500">Workout date: </span>
                            <span className="font-semibold text-slate-900">
                              {formatWorkoutDate(selectedWorkoutDate)}
                            </span>
                          </p>
                          <button
                            type="button"
                            onClick={goBackToDayOverview}
                            className="w-fit text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                          >
                            Back to day overview
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {logFlowPhase === "day_overview" && isDayExercisesListOpen ? (
                    <div
                      className={`space-y-3 rounded-lg border p-3 sm:p-4 ${
                        selectedDateIsFinished
                          ? "border-slate-300 bg-slate-100/80"
                          : "border-slate-200 bg-slate-50/60"
                      }`}
                    >
                      <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                          checked={selectedDateIsRestDay}
                          onChange={(event) => handleToggleRestDay(event.target.checked)}
                        />
                        <span className="font-medium">Mark as rest day</span>
                      </label>
                      {restDayToggleWarning ? (
                        <p
                          className={`rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700 transition-opacity duration-500 ${
                            isRestDayToggleWarningVisible ? "opacity-100" : "opacity-0"
                          }`}
                        >
                          {restDayToggleWarning}
                        </p>
                      ) : null}
                      {selectedDateIsRestDay ? (
                        <p className="rounded-md border border-slate-200 bg-slate-100/70 px-3 py-2 text-sm text-slate-700">
                          This day is marked as rest
                        </p>
                      ) : null}
                      {selectedDateIsFinished ? (
                        <p className="rounded-md border border-slate-300 bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">
                          This day is finished. Existing workouts can still be edited, but adding new workouts is disabled.
                        </p>
                      ) : null}
                      <div className="flex items-center justify-between">
                        <h3
                          className={`text-sm text-slate-900 ${
                            selectedDateIsFinished ? "font-bold" : "font-normal"
                          }`}
                        >
                          Day overview
                        </h3>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          aria-pressed={selectedDateIsFinished}
                          disabled={
                            selectedDateIsRestDay ||
                            workoutsForSelectedDate.length === 0
                          }
                          onClick={handleFinishSelectedDay}
                          className={`w-fit rounded-md border px-3 py-1.5 text-sm font-medium enabled:hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-45 ${
                            selectedDateIsFinished
                              ? "border-slate-500 bg-slate-300 text-slate-900 shadow-inner"
                              : "border-slate-300 bg-white text-slate-700"
                          }`}
                        >
                          Day Finished
                        </button>
                        {workoutsForSelectedDate.length > 0 && !dayOverviewSelectMode ? (
                          <button
                            type="button"
                            onClick={() => {
                              setDayOverviewSelectMode(true);
                              setDayOverviewSelectedWorkoutIds(new Set());
                              setDayOverviewDeleteConfirmOpen(false);
                            }}
                            className="w-fit rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                          >
                            Select
                          </button>
                        ) : workoutsForSelectedDate.length > 0 && dayOverviewSelectMode ? (
                          <div className="flex flex-col items-end gap-2 md:flex-row md:items-center md:justify-start">
                            <button
                              type="button"
                              disabled={dayOverviewSelectedWorkoutIds.size === 0}
                              onClick={() => {
                                if (dayOverviewSelectedWorkoutIds.size > 0) {
                                  setDayOverviewDeleteConfirmOpen(true);
                                }
                              }}
                              className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-900 enabled:hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Delete permanently
                            </button>
                            <button
                              type="button"
                              onClick={exitDayOverviewSelectMode}
                              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <span />
                        )}
                      </div>
                      {dayOverviewDeleteConfirmOpen && dayOverviewSelectMode ? (
                        <div className="rounded-md border border-rose-200 bg-rose-50/90 px-3 py-3 text-sm text-rose-950">
                          <p>Delete the selected workout(s)? This cannot be undone.</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={handleConfirmDeleteSelectedWorkouts}
                              className="rounded-md bg-rose-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-900"
                            >
                              Yes, delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setDayOverviewDeleteConfirmOpen(false)}
                              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              No, keep
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {workoutsForSelectedDate.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-5 text-center">
                          <p className="text-sm text-slate-600">No workouts logged for this date yet.</p>
                          <button
                            type="button"
                            disabled={isAddWorkoutBlocked}
                            onClick={() => {
                              if (isAddWorkoutBlocked) return;
                              setLogFlowPhase("exercise_select");
                              setSelectedId("");
                              setSets([]);
                              setExerciseSearchQuery("");
                            }}
                            className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            Select first workout
                          </button>
                        </div>
                      ) : (
                        <>
                          <ul className="space-y-2">
                            {workoutsForSelectedDate.map((entry) => {
                              const exerciseMeta = exercises.find((exercise) => exercise.id === entry.exerciseId);
                              const validSetCount = countValidSetsForWorkoutEntry(entry, exerciseMeta);
                              const expectedSetCount = Math.max(1, exerciseMeta?.setCount ?? entry.sets.length);
                              const isPartiallyDone =
                                validSetCount > 0 && validSetCount < expectedSetCount;
                              const previousForTrend = getPreviousComparableWorkoutEntry(
                                entry,
                                historyByExerciseId
                              );
                              const cpsTrend = resolveCpsDayOverviewTrend(
                                entry.sessionCps,
                                previousForTrend?.sessionCps ?? null
                              );
                              const cpsChangeSummary = formatCpsChangeSummary(
                                entry.sessionCps,
                                previousForTrend?.sessionCps ?? null
                              );
                              const cpsTrendUi = cpsTrend
                                ? cpsDayOverviewTrendIndicator(cpsTrend)
                                : null;
                              return (
                                <li key={entry.workoutId}>
                                  {dayOverviewSelectMode ? (
                                    <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                                      <input
                                        type="checkbox"
                                        className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                                        checked={dayOverviewSelectedWorkoutIds.has(entry.workoutId)}
                                        onChange={() => toggleDayOverviewWorkout(entry.workoutId)}
                                        aria-label={`Select ${formatDayOverviewWorkoutTitle(entry, exercises)}`}
                                      />
                                      <div className="min-w-0 flex-1 text-left">
                                        <div className="flex min-w-0 items-center justify-between gap-4">
                                          <p className="min-w-0 text-base font-semibold leading-tight text-slate-900">
                                            {formatDayOverviewWorkoutTitle(entry, exercises)}
                                          </p>
                                          {cpsTrendUi ? (
                                            <span
                                              className={`shrink-0 pr-1 text-2xl font-semibold leading-none ${cpsTrendUi.className}`}
                                              title={cpsTrendUi.label}
                                              aria-label={cpsTrendUi.label}
                                            >
                                              {cpsTrendUi.mark}
                                            </span>
                                          ) : null}
                                        </div>
                                        <p className="text-xs text-slate-600">
                                          {entry.sets.length} sets · CPS {formatCps(entry.sessionCps)} · Volume{" "}
                                          {formatVolume(entry.sessionVolume)}
                                          {cpsChangeSummary.text !== "—"
                                            ? ` · ${cpsChangeSummary.text}`
                                            : ""}
                                          {isPartiallyDone ? " (Partially Done Set)" : ""}
                                        </p>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2">
                                      <button
                                        type="button"
                                        onClick={() => openWorkoutEntry(entry)}
                                        className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left hover:bg-slate-50"
                                      >
                                        <div className="flex min-w-0 items-center justify-between gap-4">
                                          <p className="min-w-0 text-base font-semibold leading-tight text-slate-900">
                                            {formatDayOverviewWorkoutTitle(entry, exercises)}
                                          </p>
                                          {cpsTrendUi ? (
                                            <span
                                              className={`shrink-0 pr-1 text-2xl font-semibold leading-none ${cpsTrendUi.className}`}
                                              title={cpsTrendUi.label}
                                              aria-label={cpsTrendUi.label}
                                            >
                                              {cpsTrendUi.mark}
                                            </span>
                                          ) : null}
                                        </div>
                                        <p className="text-xs text-slate-600">
                                          {entry.sets.length} sets · CPS {formatCps(entry.sessionCps)} · Volume{" "}
                                          {formatVolume(entry.sessionVolume)}
                                          {cpsChangeSummary.text !== "—"
                                            ? ` · ${cpsChangeSummary.text}`
                                            : ""}
                                          {isPartiallyDone ? " (Partially Done Set)" : ""}
                                        </p>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openExerciseConfigEditor(entry)}
                                        className="mt-0.5 shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-lg leading-none text-slate-700 hover:bg-slate-50"
                                        aria-label={`Edit configuration for ${formatDayOverviewWorkoutTitle(entry, exercises)}`}
                                        title="Edit exercise configuration"
                                      >
                                        ⋮
                                      </button>
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                          {!dayOverviewSelectMode ? (
                            <button
                              type="button"
                              disabled={isAddWorkoutBlocked}
                              onClick={() => {
                                if (isAddWorkoutBlocked) return;
                                setLogFlowPhase("exercise_select");
                                setSelectedId("");
                                setSets([]);
                                setExerciseSearchQuery("");
                              }}
                              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              Add another workout
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}

                  {logFlowPhase === "exercise_select" && selectedWorkoutDate ? (
                    <div className="space-y-3">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Exercise selection
                      </h2>
                      <div className="mt-1">
                        <label className="block text-sm font-medium text-slate-700" htmlFor="exercise-search">
                          Search exercises
                        </label>
                        <input
                          id="exercise-search"
                          type="search"
                          value={exerciseSearchQuery}
                          onChange={(e) => setExerciseSearchQuery(e.target.value)}
                          autoComplete="off"
                          placeholder="Type to filter by name…"
                          className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 placeholder:text-slate-400 focus:ring-2"
                        />
                      </div>

                      {filteredRecentExercises.length > 0 ? (
                        <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Recent exercises
                          </h3>
                          <ul className="mt-2 space-y-1.5">
                            {filteredRecentExercises.map((recent) => (
                              <li key={`recent-${recent.exerciseId}-${recent.name}`}>
                                <button
                                  type="button"
                                  onClick={() => selectRecentExercise(recent.exerciseId, recent.name)}
                                  className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
                                >
                                  <span className="text-sm font-medium text-slate-900">{recent.name}</span>
                                  {recent.configured ? (
                                    <span className="text-xs text-slate-500">
                                      {recent.configured.setCount} sets / {recent.configured.targetReps} reps / +
                                      {recent.configured.increment} {recent.configured.unit} / RIR:{" "}
                                      {recent.configured.trackRir ? "Y" : "N"} / RPE:{" "}
                                      {recent.configured.trackRpe ? "Y" : "N"}
                                    </span>
                                  ) : null}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : recentExercises.length > 0 && exerciseSearchQuery.trim() ? (
                        <p className="text-sm text-slate-500">No recent exercises match your search.</p>
                      ) : null}

                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Saved presets
                        </h3>
                        {presets.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-500">
                            No saved presets yet. Create one in Your Library.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-1.5">
                            {presets.map((preset) => (
                              <li key={`preset-${preset.id}`}>
                                <button
                                  type="button"
                                  disabled={isAddWorkoutBlocked}
                                  onClick={() => applyPresetToSelectedDay(preset.id)}
                                  className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <span className="text-sm font-medium text-slate-900">{preset.name}</span>
                                  <span className="text-xs text-slate-500">
                                    {preset.exercises.length} exercise{preset.exercises.length === 1 ? "" : "s"}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Your library exercises
                        </h3>
                        <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1 sm:max-h-48">
                          {filteredUserCreatedExercises.length === 0 ? (
                            <p className="text-sm text-slate-500">
                              {userCreatedExercises.length === 0
                                ? "No manually created exercises yet."
                                : "No manually created exercises match your search."}
                            </p>
                          ) : (
                            <ul className="space-y-1">
                              {filteredUserCreatedExercises.map((exercise) => (
                                <li key={`user-created-${exercise.id}`}>
                                  <button
                                    type="button"
                                    disabled={isAddWorkoutBlocked}
                                    onClick={() => selectConfiguredExercise(exercise.id)}
                                    className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <span className="text-sm font-medium text-slate-900">{exercise.name}</span>
                                    <span className="text-xs text-slate-500">
                                      {exercise.setCount} sets / {exercise.targetReps} reps / +
                                      {exercise.increment} {exercise.unit}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          All exercises
                        </h3>
                        <div className="mt-2 max-h-60 space-y-2 overflow-y-auto pr-1 sm:max-h-72">
                          {Object.keys(filteredExercisesByLetter).length === 0 ? (
                            <p className="text-sm text-slate-500">
                              No library exercises match your search. You can create a new exercise below.
                            </p>
                          ) : (
                            Object.entries(filteredExercisesByLetter).map(([letter, names]) => (
                              <div key={`letter-${letter}`}>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                  {letter}
                                </p>
                                <ul className="space-y-1">
                                  {names.map((name) => (
                                    <li key={`${letter}-${name}`}>
                                      <button
                                        type="button"
                                        disabled={isAddWorkoutBlocked}
                                        onClick={() => selectExerciseFromLibrary(name)}
                                        className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-sm text-slate-700 enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {name}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={isAddWorkoutBlocked}
                          onClick={startCreateNewExercise}
                          className="mt-3 w-full rounded-md border border-dashed border-slate-300 bg-slate-50/80 py-2.5 text-sm font-medium text-slate-800 enabled:hover:border-slate-400 enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Create new exercise
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {logFlowPhase === "exercise_setup" && pendingExerciseName !== null ? (
                    <div className="space-y-3">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Exercise setup
                      </h2>
                      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                        {isCustomExerciseSetup ? (
                          <label className="block space-y-1">
                            <span className="text-sm font-semibold text-slate-900">Exercise name</span>
                            <input
                              type="text"
                              value={pendingExerciseName}
                              onChange={(e) => {
                                setSetupNameError(null);
                                setPendingExerciseName(e.target.value);
                              }}
                              autoComplete="off"
                              placeholder="e.g. Bench Press"
                              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                            />
                          </label>
                        ) : (
                          <p className="text-sm font-semibold text-slate-900">Setup new exercise: {pendingExerciseName}</p>
                        )}
                        {setupNameError ? (
                          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            {setupNameError}
                          </p>
                        ) : null}
                        <div className="mt-3">
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-slate-600">Exercise type</span>
                            <select
                              value={setupForm.setupType}
                              onChange={(event) =>
                                setSetupForm((prev) => {
                                  const nextSetupType = event.target.value as SetupExerciseType;
                                  return {
                                    ...prev,
                                    setupType: nextSetupType,
                                    trackRir: false,
                                    targetReps: nextSetupType === "time" ? 60 : 8
                                  };
                                })
                              }
                              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                            >
                              <option value="reps">Reps</option>
                              <option value="time">Time</option>
                            </select>
                          </label>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-4">
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-slate-600">Set count</span>
                            <input
                              type="number"
                              min={1}
                              value={setupForm.setCount}
                              onChange={(event) =>
                                setSetupForm((prev) => ({ ...prev, setCount: Number(event.target.value) }))
                              }
                              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-slate-600">
                              {setupForm.setupType === "time" ? "Target time (seconds)" : "Target reps"}
                            </span>
                            <input
                              type="number"
                              min={1}
                              value={setupForm.targetReps}
                              onChange={(event) =>
                                setSetupForm((prev) => ({ ...prev, targetReps: Number(event.target.value) }))
                              }
                              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-slate-600">Increment</span>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={setupForm.increment}
                              onChange={(event) =>
                                setSetupForm((prev) => ({ ...prev, increment: Number(event.target.value) }))
                              }
                              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-slate-600">Unit</span>
                            <select
                              value={setupForm.unit}
                              onChange={(event) => {
                                const nextUnit = event.target.value as "lbs" | "kg";
                                setSetupForm((prev) => ({
                                  ...prev,
                                  unit: nextUnit,
                                  increment: defaultIncrementForUnit(nextUnit)
                                }));
                              }}
                              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                            >
                              <option value="lbs">lbs</option>
                              <option value="kg">kg</option>
                            </select>
                          </label>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                            <input
                              type="checkbox"
                              checked={setupForm.trackRir}
                              onChange={(event) =>
                                setSetupForm((prev) => ({ ...prev, trackRir: event.target.checked }))
                              }
                              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                            />
                            <span className="text-sm text-slate-700">
                              {setupForm.setupType === "time" ? "Track TIR" : "Track RIR"}
                            </span>
                          </label>
                          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                            <input
                              type="checkbox"
                              checked={setupForm.trackRpe}
                              onChange={(event) =>
                                setSetupForm((prev) => ({ ...prev, trackRpe: event.target.checked }))
                              }
                              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                            />
                            <span className="text-sm text-slate-700">Track RPE</span>
                          </label>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={handleConfirmExerciseSetup}
                            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingExerciseName(null);
                              setIsCustomExerciseSetup(false);
                              setSetupNameError(null);
                              setSetupForm(buildSetupDefaults());
                              setSelectedId("");
                              setSets([]);
                              setLogFlowPhase("exercise_select");
                            }}
                            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {logFlowPhase === "exercise_config_edit" && configEditTargetWorkoutId !== null ? (
                    <div className="space-y-3">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Edit exercise configuration
                      </h2>
                      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                        <p className="text-sm font-semibold text-slate-900">{configEditExerciseName}</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-4">
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-slate-600">Set count</span>
                            <input
                              type="number"
                              min={1}
                              value={configEditForm.setCount}
                              onChange={(event) =>
                                setConfigEditForm((prev) => ({
                                  ...prev,
                                  setCount: Number(event.target.value)
                                }))
                              }
                              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-slate-600">Target reps</span>
                            <input
                              type="number"
                              min={1}
                              value={configEditForm.targetReps}
                              onChange={(event) =>
                                setConfigEditForm((prev) => ({
                                  ...prev,
                                  targetReps: Number(event.target.value)
                                }))
                              }
                              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-slate-600">Increment</span>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={configEditForm.increment}
                              onChange={(event) =>
                                setConfigEditForm((prev) => ({
                                  ...prev,
                                  increment: Number(event.target.value)
                                }))
                              }
                              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-slate-600">Unit</span>
                            <select
                              value={configEditForm.unit}
                              onChange={(event) => {
                                const nextUnit = event.target.value as "lbs" | "kg";
                                setConfigEditForm((prev) => ({
                                  ...prev,
                                  unit: nextUnit,
                                  increment: defaultIncrementForUnit(nextUnit)
                                }));
                              }}
                              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                            >
                              <option value="lbs">lbs</option>
                              <option value="kg">kg</option>
                            </select>
                          </label>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                            <input
                              type="checkbox"
                              checked={configEditForm.trackRir}
                              onChange={(event) =>
                                setConfigEditForm((prev) => ({
                                  ...prev,
                                  trackRir: event.target.checked
                                }))
                              }
                              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                            />
                            <span className="text-sm text-slate-700">Track RIR</span>
                          </label>
                          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                            <input
                              type="checkbox"
                              checked={configEditForm.trackRpe}
                              onChange={(event) =>
                                setConfigEditForm((prev) => ({
                                  ...prev,
                                  trackRpe: event.target.checked
                                }))
                              }
                              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                            />
                            <span className="text-sm text-slate-700">Track RPE</span>
                          </label>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setConfigEditTargetWorkoutId(null);
                              setConfigEditExerciseName("");
                              setConfigEditForm(buildSetupDefaults());
                              setLogFlowPhase("day_overview");
                            }}
                            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            onClick={handleSubmitExerciseConfigEdit}
                            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                          >
                            Submit
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {logFlowPhase === "exercise_log" && selectedWorkoutDate && selectedExercise && submission === null ? (
                    <div className="space-y-5">
                      <h3 className="text-base font-semibold text-slate-900">{selectedExercise.name}</h3>
                      <p className="text-sm text-slate-600">Log your workout to receive a recommendation.</p>
                      {draftWorkoutId ? (
                        <p className="rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">
                          Added from preset — enter your sets to log this workout.
                        </p>
                      ) : null}
                      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3 sm:p-4">
                        <div className="max-md:-mx-0.5 max-md:overflow-x-auto max-md:pb-0.5 md:mx-0">
                          <div
                            className={`${setLogTableMinWidth(
                              selectedExercise.type,
                              selectedExercise.trackRir,
                              selectedExercise.trackRpe
                            )} sm:min-w-0`}
                          >
                            <div
                              className={`${setRowGridClass(
                                selectedExercise.type,
                                selectedExercise.trackRir,
                                selectedExercise.trackRpe
                              )} border-b border-slate-200 pb-2`}
                            >
                              <span className={LOG_TABLE_HEADER}>Set</span>
                              {selectedExercise.type === "time" ? (
                                <>
                                  <span className={LOG_TABLE_HEADER}>
                                    Time (T {formatTargetTimeForHeader(selectedExercise.targetReps)})
                                  </span>
                                  <span className={LOG_TABLE_HEADER}>Wt ({selectedExercise.unit})</span>
                                </>
                              ) : (
                                <>
                                  <span className={LOG_TABLE_HEADER}>Wt ({selectedExercise.unit})</span>
                                  <span className={LOG_TABLE_HEADER}>
                                    Reps (T {selectedExercise.targetReps})
                                  </span>
                                </>
                              )}
                              {selectedExercise.trackRir ? (
                                <span className={LOG_TABLE_HEADER}>
                                  {selectedExercise.type === "time" ? "TIR" : "RIR"}
                                </span>
                              ) : null}
                              {selectedExercise.trackRpe ? <span className={LOG_TABLE_HEADER}>RPE</span> : null}
                            </div>
                          </div>
                        </div>
                        {sets.map((set, index) => (
                          <div key={`set-${index}`} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 sm:px-3">
                            <div className="max-md:-mx-0.5 max-md:overflow-x-auto max-md:pb-0.5 md:mx-0">
                              <div
                                className={`${setLogTableMinWidth(
                                  selectedExercise.type,
                                  selectedExercise.trackRir,
                                  selectedExercise.trackRpe
                                )} sm:min-w-0`}
                              >
                            <div
                              className={setRowGridClass(
                                selectedExercise.type,
                                selectedExercise.trackRir,
                                selectedExercise.trackRpe
                              )}
                            >
                              <span className="text-sm font-semibold text-slate-700">Set {index + 1}</span>
                              {selectedExercise.type === "time" ? (
                                <>
                                  <label>
                                    <span className="sr-only">Set {index + 1} time</span>
                                    <input
                                      id={`time-${index}`}
                                      type="number"
                                      min={0}
                                      step={1}
                                      value={set.timeSeconds}
                                      onChange={(event) => updateSet(index, "timeSeconds", event.target.value)}
                                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                                    />
                                  </label>
                                  <label>
                                    <span className="sr-only">Set {index + 1} weight</span>
                                    <input
                                      id={`weight-${index}`}
                                      type="number"
                                      min={0}
                                      step={0.5}
                                      value={set.weight}
                                      onChange={(event) => updateSet(index, "weight", event.target.value)}
                                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                                    />
                                  </label>
                                </>
                              ) : (
                                <>
                                  <label>
                                    <span className="sr-only">Set {index + 1} weight</span>
                                    <input
                                      id={`weight-${index}`}
                                      type="number"
                                      min={0}
                                      step={0.5}
                                      value={set.weight}
                                      onChange={(event) => updateSet(index, "weight", event.target.value)}
                                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                                    />
                                  </label>
                                  <label>
                                    <span className="sr-only">Set {index + 1} reps</span>
                                    <input
                                      id={`reps-${index}`}
                                      type="number"
                                      min={0}
                                      value={set.reps}
                                      onChange={(event) => updateSet(index, "reps", event.target.value)}
                                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                                    />
                                  </label>
                                </>
                              )}
                              {selectedExercise.trackRir ? (
                                <label>
                                  <span className="sr-only">
                                    Set {index + 1} {selectedExercise.type === "time" ? "TIR" : "RIR"}
                                  </span>
                                  <input
                                    id={`${selectedExercise.type === "time" ? "tir" : "rir"}-${index}`}
                                    type="number"
                                    min={0}
                                    max={10}
                                    step={0.5}
                                    value={selectedExercise.type === "time" ? set.tir : set.rir}
                                    onChange={(event) =>
                                      updateSet(
                                        index,
                                        selectedExercise.type === "time" ? "tir" : "rir",
                                        event.target.value
                                      )
                                    }
                                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-center text-sm outline-none ring-slate-300 focus:ring-2"
                                  />
                                </label>
                              ) : null}
                              {selectedExercise.trackRpe ? (
                                <label>
                                  <span className="sr-only">Set {index + 1} RPE</span>
                                  <input
                                    id={`rpe-${index}`}
                                    type="number"
                                    min={0}
                                    max={10}
                                    step={0.5}
                                    value={set.rpe}
                                    onChange={(event) => updateSet(index, "rpe", event.target.value)}
                                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-center text-sm outline-none ring-slate-300 focus:ring-2"
                                  />
                                </label>
                              ) : null}
                            </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={handleBackToExerciseSelector}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          Back to exercise list
                        </button>
                        <button
                          type="submit"
                          disabled={!canSubmitCurrentWorkout}
                          className="min-w-[10rem] rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Submit workout
                        </button>
                      </div>
                      {submitValidationError ? (
                        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          {submitValidationError}
                        </p>
                      ) : null}

                      {submission === null ? (
                        <p className="text-sm text-slate-600">
                          Session volume (live):{" "}
                          <span className="font-semibold text-slate-900">
                            {formatVolume(liveVolume)} {selectedExercise.unit}
                          </span>
                        </p>
                      ) : null}

                      <div className="border-t border-slate-100 pt-4">
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Last session</h2>
                        {lastSessionForSelected ? (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                              Workout date:{" "}
                              {lastSessionForSelected.workoutDate
                                ? formatWorkoutDate(lastSessionForSelected.workoutDate)
                                : "—"}
                            </p>
                            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                              <div>
                                <span className="text-slate-500">CPS </span>
                                <span className="font-semibold tabular-nums text-slate-900">
                                  {formatCps(lastSessionForSelected.sessionCps)}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500">Volume </span>
                                <span className="font-semibold tabular-nums text-slate-900">
                                  {formatVolume(lastSessionForSelected.sessionVolume)} {selectedExercise.unit}
                                </span>
                              </div>
                            </div>
                            <ul className="mt-3 space-y-0.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
                              {lastSessionForSelected.sets.map((set, index) => (
                                <li key={`last-preview-${index}`}>
                                  Set {index + 1}:{" "}
                                  {selectedExercise.type === "time"
                                    ? `${set.timeSeconds || "—"} sec`
                                    : `${set.weight || "—"} × ${set.reps || "—"}`}
                                  {selectedExercise.trackRir && selectedExercise.type !== "time" && set.rir
                                    ? ` · RIR ${set.rir}`
                                    : ""}
                                  {selectedExercise.trackRir && selectedExercise.type === "time" && set.tir
                                    ? ` · TIR ${set.tir}`
                                    : ""}
                                  {selectedExercise.trackRpe && set.rpe ? ` · RPE ${set.rpe}` : ""}
                                </li>
                              ))}
                            </ul>
                            <p className="mt-3 text-sm leading-relaxed text-slate-700">
                              {lastSessionForSelected.recommendation}
                            </p>
                          </div>
                        ) : (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-5 text-center">
                            <p className="text-sm text-slate-600">
                              No previous session yet. Log your first workout to see analysis.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {isAnalysisMode ? (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Session analysis</h2>
                <div className="mt-3 inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setPostSubmitView("dashboard");
                        setIsInputsEditable(false);
                        setEditData(null);
                      }}
                      className={`rounded px-3 py-1.5 text-sm font-medium ${
                        postSubmitView === "dashboard"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Dashboard
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostSubmitView("inputs")}
                      className={`rounded px-3 py-1.5 text-sm font-medium ${
                        postSubmitView === "inputs"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Inputs
                    </button>
                  </div>
                {progressionInsightMessage ? (
                  <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {progressionInsightMessage}
                  </p>
                ) : null}

                  <div className="mt-3 space-y-5">
                    {postSubmitView === "dashboard" ? (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">This session</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        <span className="font-medium text-slate-800">{submission.exerciseName}</span>
                        <span className="text-slate-400"> · </span>
                        <span className="text-slate-600">{formatWorkoutDate(submission.workoutDate)}</span>
                        <span className="text-slate-400"> · </span>
                        <time className="text-slate-500" dateTime={submission.submittedAt}>
                          {new Date(submission.submittedAt).toLocaleString()}
                        </time>
                      </p>
                      <ul className="mt-2.5 text-sm text-slate-700">
                        {submission.setsSnapshot.map((set, index) => (
                          <li key={`summary-${index}`}>
                            Set {index + 1}:{" "}
                            {submission.exerciseType === "time"
                              ? `${set.timeSeconds || "—"} sec`
                              : `${set.weight || "—"} × ${set.reps || "—"} reps`}
                            {submission.trackRir && submission.exerciseType !== "time" && set.rir
                              ? ` · RIR ${set.rir}`
                              : ""}
                            {submission.trackRir && submission.exerciseType === "time" && set.tir
                              ? ` · TIR ${set.tir}`
                              : ""}
                            {submission.trackRpe && set.rpe ? ` · RPE ${set.rpe}` : ""}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 grid grid-cols-2 gap-2.5">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2.5 sm:px-3">
                          <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                            {formatCps(submission.sessionCps)}
                          </p>
                          <p className="mt-1 text-xs font-medium leading-tight text-slate-500">
                            Performance Score (CPS)
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2.5 sm:px-3">
                          <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                            {formatVolume(submission.sessionVolume)} {submission.exerciseUnit}
                          </p>
                          <p className="mt-1 text-xs font-medium leading-tight text-slate-500">Volume</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2.5 sm:px-3">
                          <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                            {formatOneDecimal(submission.avgWeight)} {submission.exerciseUnit}
                          </p>
                          <p className="mt-1 text-xs font-medium leading-tight text-slate-500">Avg Weight</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2.5 sm:px-3">
                          <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                            {formatOneDecimal(submission.avgReps)}
                          </p>
                          <p className="mt-1 text-xs font-medium leading-tight text-slate-500">Avg Reps</p>
                        </div>
                      </div>

                      <div className="mt-5 rounded-lg border border-slate-200/90 border-l-[3px] border-l-slate-600 bg-slate-50 px-3 py-3 sm:px-4 sm:py-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Next Session Focus
                        </p>
                        <p className="mt-2 text-base font-medium leading-relaxed text-slate-900 sm:text-lg">
                          {submission.recommendation}
                        </p>
                      </div>

                      <dl className="mt-4 text-sm">
                        <div>
                          <dt className="text-slate-500">Progression stage</dt>
                          <dd className="mt-0.5 font-mono font-semibold text-slate-900">
                            {submission.stageLabel}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">Submitted inputs</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            {isInputsEditable
                              ? "Edit values, then save to recalculate this session."
                              : "Inputs are locked until you choose to edit them."}
                          </p>
                        </div>
                        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3 sm:p-4">
                          <div className="max-md:-mx-0.5 max-md:overflow-x-auto max-md:pb-0.5 md:mx-0">
                            <div
                              className={`${setLogTableMinWidth(
                                submission.exerciseType,
                                submission.trackRir,
                                submission.trackRpe
                              )} sm:min-w-0`}
                            >
                              <div
                                className={`${setRowGridClass(
                                  submission.exerciseType,
                                  submission.trackRir,
                                  submission.trackRpe
                                )} border-b border-slate-200 pb-2`}
                              >
                                <span className={LOG_TABLE_HEADER}>Set</span>
                                {submission.exerciseType === "time" ? (
                                  <>
                                    <span className={LOG_TABLE_HEADER}>
                                      Time (T {formatTargetTimeForHeader(selectedExercise?.targetReps)})
                                    </span>
                                    <span className={LOG_TABLE_HEADER}>Wt ({submission.exerciseUnit})</span>
                                  </>
                                ) : (
                                  <>
                                    <span className={LOG_TABLE_HEADER}>Wt ({submission.exerciseUnit})</span>
                                    <span className={LOG_TABLE_HEADER}>
                                      Reps (T {selectedExercise?.targetReps ?? "—"})
                                    </span>
                                  </>
                                )}
                                {submission.trackRir ? (
                                  <span className={LOG_TABLE_HEADER}>
                                    {submission.exerciseType === "time" ? "TIR" : "RIR"}
                                  </span>
                                ) : null}
                                {submission.trackRpe ? (
                                  <span className={LOG_TABLE_HEADER}>RPE</span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          {(isInputsEditable && editData ? editData : submission.setsSnapshot).map((set, index) => (
                            <div key={`post-submit-set-${index}`} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 sm:px-3">
                              <div className="max-md:-mx-0.5 max-md:overflow-x-auto max-md:pb-0.5 md:mx-0">
                                <div
                                  className={`${setLogTableMinWidth(
                                    submission.exerciseType,
                                    submission.trackRir,
                                    submission.trackRpe
                                  )} sm:min-w-0`}
                                >
                              <div
                                className={setRowGridClass(
                                  submission.exerciseType,
                                  submission.trackRir,
                                  submission.trackRpe
                                )}
                              >
                                <span className="text-sm font-semibold text-slate-700">Set {index + 1}</span>
                                {submission.exerciseType === "time" ? (
                                  <>
                                    <label>
                                      <span className="sr-only">Set {index + 1} time</span>
                                      <input
                                        id={`post-time-${index}`}
                                        type="number"
                                        min={0}
                                        value={set.timeSeconds}
                                        readOnly={!isInputsEditable}
                                        onChange={(event) =>
                                          handlePostSubmitSetChange(index, "timeSeconds", event.target.value)
                                        }
                                        className={`w-full rounded-md border px-3 py-2 text-sm outline-none ${
                                          isInputsEditable
                                            ? "border-slate-300 bg-white ring-slate-300 focus:ring-2"
                                            : "border-slate-200 bg-slate-100 text-slate-600"
                                        }`}
                                      />
                                    </label>
                                    <label>
                                      <span className="sr-only">Set {index + 1} weight</span>
                                      <input
                                        id={`post-weight-${index}`}
                                        type="number"
                                        min={0}
                                        step={0.5}
                                        value={set.weight}
                                        readOnly={!isInputsEditable}
                                        onChange={(event) =>
                                          handlePostSubmitSetChange(index, "weight", event.target.value)
                                        }
                                        className={`w-full rounded-md border px-3 py-2 text-sm outline-none ${
                                          isInputsEditable
                                            ? "border-slate-300 bg-white ring-slate-300 focus:ring-2"
                                            : "border-slate-200 bg-slate-100 text-slate-600"
                                        }`}
                                      />
                                    </label>
                                  </>
                                ) : (
                                  <>
                                    <label>
                                      <span className="sr-only">Set {index + 1} weight</span>
                                      <input
                                        id={`post-weight-${index}`}
                                        type="number"
                                        min={0}
                                        step={0.5}
                                        value={set.weight}
                                        readOnly={!isInputsEditable}
                                        onChange={(event) =>
                                          handlePostSubmitSetChange(index, "weight", event.target.value)
                                        }
                                        className={`w-full rounded-md border px-3 py-2 text-sm outline-none ${
                                          isInputsEditable
                                            ? "border-slate-300 bg-white ring-slate-300 focus:ring-2"
                                            : "border-slate-200 bg-slate-100 text-slate-600"
                                        }`}
                                      />
                                    </label>
                                    <label>
                                      <span className="sr-only">Set {index + 1} reps</span>
                                      <input
                                        id={`post-reps-${index}`}
                                        type="number"
                                        min={0}
                                        value={set.reps}
                                        readOnly={!isInputsEditable}
                                        onChange={(event) =>
                                          handlePostSubmitSetChange(index, "reps", event.target.value)
                                        }
                                        className={`w-full rounded-md border px-3 py-2 text-sm outline-none ${
                                          isInputsEditable
                                            ? "border-slate-300 bg-white ring-slate-300 focus:ring-2"
                                            : "border-slate-200 bg-slate-100 text-slate-600"
                                        }`}
                                      />
                                    </label>
                                  </>
                                )}
                                {submission.trackRir ? (
                                  <label>
                                    <span className="sr-only">
                                      Set {index + 1} {submission.exerciseType === "time" ? "TIR" : "RIR"}
                                    </span>
                                    <input
                                      id={`post-${submission.exerciseType === "time" ? "tir" : "rir"}-${index}`}
                                      type="number"
                                      min={0}
                                      max={10}
                                      step={0.5}
                                      value={submission.exerciseType === "time" ? set.tir : set.rir}
                                      readOnly={!isInputsEditable}
                                      onChange={(event) =>
                                        handlePostSubmitSetChange(
                                          index,
                                          submission.exerciseType === "time" ? "tir" : "rir",
                                          event.target.value
                                        )
                                      }
                                      className={`w-full rounded-md border px-2 py-2 text-center text-sm outline-none ${
                                        isInputsEditable
                                          ? "border-slate-300 bg-white ring-slate-300 focus:ring-2"
                                          : "border-slate-200 bg-slate-100 text-slate-600"
                                      }`}
                                    />
                                  </label>
                                ) : null}
                                {submission.trackRpe ? (
                                  <label>
                                    <span className="sr-only">Set {index + 1} RPE</span>
                                    <input
                                      id={`post-rpe-${index}`}
                                      type="number"
                                      min={0}
                                      max={10}
                                      step={0.5}
                                      value={set.rpe}
                                      readOnly={!isInputsEditable}
                                      onChange={(event) =>
                                        handlePostSubmitSetChange(index, "rpe", event.target.value)
                                      }
                                      className={`w-full rounded-md border px-2 py-2 text-center text-sm outline-none ${
                                        isInputsEditable
                                          ? "border-slate-300 bg-white ring-slate-300 focus:ring-2"
                                          : "border-slate-200 bg-slate-100 text-slate-600"
                                      }`}
                                    />
                                  </label>
                                ) : null}
                              </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        {submitValidationError ? (
                          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            {submitValidationError}
                          </p>
                        ) : null}
                        {isInputsEditable ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={handleSaveWorkoutChanges}
                              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                            >
                              Save Changes
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelWorkoutChanges}
                              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex">
                            <button
                              type="button"
                              onClick={() => {
                                setEditData(deepCopySetLogs(submission.setsSnapshot));
                                setIsInputsEditable(true);
                                setSubmitValidationError(null);
                              }}
                              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                            >
                              Edit Workout
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="border-t border-slate-100 pt-4">
                      <h3 className="text-sm font-semibold text-slate-900">Compare to last time</h3>
                      {submission.previousVolume === null ? (
                        <p className="mt-2 text-sm text-slate-600">
                          This is your first logged session for this exercise.
                        </p>
                      ) : (
                        <div className="mt-3 space-y-5">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Performance Score (CPS)</p>
                            <dl className="mt-2 grid gap-2.5 text-sm sm:grid-cols-2">
                              <div>
                                <dt className="text-slate-500">Current CPS</dt>
                                <dd className="font-semibold text-slate-900">{formatCps(submission.sessionCps)}</dd>
                              </div>
                              <div>
                                <dt className="text-slate-500">Previous CPS</dt>
                                <dd className="font-semibold text-slate-900">
                                  {formatCps(submission.previousCps)}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-slate-500">Change</dt>
                                <dd
                                  className={`font-semibold ${formatCpsChangeSummary(
                                    submission.sessionCps,
                                    submission.previousCps
                                  ).className}`}
                                >
                                  {formatCpsChangeSummary(submission.sessionCps, submission.previousCps).text}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-slate-500">Raw CPS diff</dt>
                                <dd className="font-semibold text-slate-900">
                                  {formatCpsChange(submission.sessionCps, submission.previousCps)}
                                  {submission.sessionCps !== null && submission.previousCps !== null ? " CPS" : ""}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-slate-500">Status</dt>
                                <dd className="text-slate-900">
                                  {statusIndicator(
                                    cpsStatus(submission.sessionCps, submission.previousCps)
                                  )}
                                </dd>
                              </div>
                            </dl>
                          </div>
                          <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-2.5">
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Volume</p>
                            <dl className="mt-1.5 grid gap-2 text-xs sm:grid-cols-2 sm:gap-2.5">
                              <div>
                                <dt className="text-slate-400">Current volume</dt>
                                <dd className="font-medium text-slate-600">
                                  {formatVolume(submission.sessionVolume)} {submission.exerciseUnit}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-slate-400">Previous volume</dt>
                                <dd className="font-medium text-slate-600">
                                  {formatVolume(submission.previousVolume)} {submission.exerciseUnit}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-slate-400">Change</dt>
                                <dd className="font-medium text-slate-600">
                                  {formatChange(submission.sessionVolume, submission.previousVolume)}{" "}
                                  {submission.exerciseUnit}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-slate-400">Status</dt>
                                <dd className="text-slate-600">
                                  {statusIndicator(
                                    volumeStatus(submission.sessionVolume, submission.previousVolume)
                                  )}
                                </dd>
                              </div>
                            </dl>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="border-t border-slate-100 pt-4">
                      <div className="flex justify-center gap-2">
                        <button
                          type="button"
                          onClick={handleBackToDayOverview}
                          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Back to Day Overview
                        </button>
                        <button
                          type="button"
                          onClick={handleLogAnotherWorkout}
                          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                        >
                          Log Another Workout
                        </button>
                      </div>
                    </div>
                  </div>
              </div>
              ) : null}
            </div>
          </form>
        </div>

      <div className="mt-1 border-t border-slate-200/90 pt-4 sm:pt-5">
        <div className="mx-auto max-w-sm space-y-2 sm:ml-0 sm:max-w-md">
          <p className="text-center text-xs text-slate-500 sm:text-left">Danger zone</p>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <button
              type="button"
              onClick={handleClearAllData}
              className="w-full rounded-md border border-rose-200/90 bg-slate-50/80 px-3 py-2 text-sm font-medium text-rose-800/95 hover:bg-rose-50/90 sm:w-auto"
            >
              Clear All Saved Data
            </button>
            {isClearConfirmOpen ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900">
                <p>Are you sure you want to clear all saved data? This cannot be undone.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCancelClearAllData}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmClearAllData}
                    className="rounded-md bg-rose-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-800"
                  >
                    Confirm Clear
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
