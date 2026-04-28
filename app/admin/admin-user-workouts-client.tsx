"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  addAdminSingleWorkoutToUserDateAction,
  addAdminHistoricalPresetToUserDateAction,
  assignAdminPresetToUserDateAction,
  createAdminPresetForUserAction,
  deleteAdminUserWorkoutAction,
  fetchAdminUserExerciseConfigsAction,
  fetchAdminUserRestDatesAction,
  fetchAdminAssignablePresetsAction,
  fetchAdminUserWorkoutsAction,
  setAdminUserRestDayAction,
  updateAdminUserWorkoutAction
} from "@/lib/admin/adminDataActions";
import { supabase } from "@/lib/supabaseClient";
import { canSubmitWorkoutInputs } from "@/lib/workoutInputValidation";
import { actionButtonClass, actionButtonClasses } from "@/components/action-button";
import {
  EXERCISE_CONFIG_HELP,
  FieldLabelHelp,
  TrackCheckboxRow
} from "@/components/help-tooltip";

type WorkoutRow = {
  id: string;
  createdAt: string | null;
  date: string | null;
  parsed: {
    exerciseName: string;
    submittedAt: string;
    updatedAt?: string;
    isDraft?: boolean;
    sessionCps: number | null;
    sessionVolume: string | number;
    progressionStage: string;
    recommendation: string;
    workoutDate?: string;
    sets: Array<{
      weight: string | number;
      reps: string | number;
      timeSeconds: string | number;
      rir?: string | number;
      tir?: string | number;
      rpe?: string | number;
    }>;
  } | null;
  rawPreview: string | null;
};

function formatCps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return (Math.round(value * 10) / 10).toFixed(1);
}

function groupWorkoutsByDate(rows: WorkoutRow[]): Map<string, WorkoutRow[]> {
  const map = new Map<string, WorkoutRow[]>();
  for (const row of rows) {
    const dateKey =
      row.parsed?.workoutDate?.trim() ||
      (typeof row.date === "string" && row.date.trim() !== "" ? row.date : "") ||
      "unknown";
    const list = map.get(dateKey) ?? [];
    list.push(row);
    map.set(dateKey, list);
  }
  const sortedKeys = Array.from(map.keys()).sort();
  const ordered = new Map<string, WorkoutRow[]>();
  for (const k of sortedKeys) {
    ordered.set(k, map.get(k)!);
  }
  return ordered;
}

type Phase = "loading" | "login" | "unauthorized" | "ready" | "fetch_error";
type AssignablePreset = {
  id: string;
  name: string;
  exerciseCount: number;
  exercises: Array<{
    id: string;
    name: string;
    type: "weight" | "bodyweight" | "time";
    targetReps: number;
    setCount: number;
    increment: number;
    unit: "lbs" | "kg";
    trackRir: boolean;
    trackRpe: boolean;
  }>;
};
type PresetExerciseDraft = {
  name: string;
  exerciseType: "weight" | "bodyweight" | "time";
  targetMode: "reps" | "time";
  targetReps: number;
  setCount: number;
  increment: number;
  unit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
};

type UserExerciseConfig = {
  id: string;
  name: string;
  type: "weight" | "bodyweight" | "time";
  targetReps: number;
  setCount: number;
  increment: number;
  unit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
  foundation: number;
};

type SingleExerciseMode = "existing" | "quick";
type SingleAddSet = { weight: string; reps: string; timeSeconds: string; rir: string; tir: string; rpe: string };

function addMonths(ymd: string, deltaMonths: number): string {
  const date = new Date(`${ymd}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return new Date().toISOString().slice(0, 10);
  date.setMonth(date.getMonth() + deltaMonths);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function buildMonthGrid(selectedDate: string): string[] {
  const date = new Date(`${selectedDate}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return [];
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0);
  const start = new Date(monthStart);
  start.setDate(monthStart.getDate() - monthStart.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const copy = new Date(start);
    copy.setDate(start.getDate() + index);
    const local = new Date(copy.getTime() - copy.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  });
}

const initialPresetExerciseDraft: PresetExerciseDraft = {
  name: "",
  exerciseType: "weight",
  targetMode: "reps",
  targetReps: 8,
  setCount: 3,
  increment: 5,
  unit: "lbs",
  trackRir: false,
  trackRpe: false
};

export function AdminUserWorkoutsClient({
  userId,
  expectedAdminEmail
}: {
  userId: string;
  expectedAdminEmail: string;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [rows, setRows] = useState<WorkoutRow[] | null>(null);
  const [assignablePresets, setAssignablePresets] = useState<AssignablePreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [assignDate, setAssignDate] = useState(new Date().toISOString().slice(0, 10));
  const [addWorkoutMode, setAddWorkoutMode] = useState<"planned" | "historical">("planned");
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [historicalSetsByExerciseId, setHistoricalSetsByExerciseId] = useState<
    Record<string, Array<{ weight: string; reps: string; timeSeconds: string; rir: string; tir: string; rpe: string }>>
  >({});
  const [draftPrefillByExerciseId, setDraftPrefillByExerciseId] = useState<
    Record<string, { weight: string; reps: string; timeSeconds: string; rir: string; tir: string; rpe: string }>
  >({});
  const [restDates, setRestDates] = useState<string[]>([]);
  const [adminAccessToken, setAdminAccessToken] = useState<string | null>(null);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [newPresetName, setNewPresetName] = useState("");
  const [presetExerciseDraft, setPresetExerciseDraft] = useState<PresetExerciseDraft>(
    initialPresetExerciseDraft
  );
  const [newPresetExercises, setNewPresetExercises] = useState<PresetExerciseDraft[]>([]);
  const [isCreatingPreset, setIsCreatingPreset] = useState(false);
  const [createPresetMessage, setCreatePresetMessage] = useState<string | null>(null);
  const [createPresetError, setCreatePresetError] = useState<string | null>(null);
  const [isSavingWorkout, setIsSavingWorkout] = useState(false);
  const [isUpdatingRestDay, setIsUpdatingRestDay] = useState(false);
  const [userExerciseConfigs, setUserExerciseConfigs] = useState<UserExerciseConfig[]>([]);
  const [singleExerciseMode, setSingleExerciseMode] = useState<SingleExerciseMode>("existing");
  const [singleExistingExerciseId, setSingleExistingExerciseId] = useState("");
  const [singleQuickConfig, setSingleQuickConfig] = useState<PresetExerciseDraft>(initialPresetExerciseDraft);
  const [singleAddMode, setSingleAddMode] = useState<"planned" | "historical">("planned");
  const [singleDraftPrefill, setSingleDraftPrefill] = useState({
    weight: "",
    reps: "",
    timeSeconds: "",
    rir: "",
    tir: "",
    rpe: ""
  });
  const [singleHistoricalSets, setSingleHistoricalSets] = useState<SingleAddSet[]>([
    { weight: "", reps: "", timeSeconds: "", rir: "", tir: "", rpe: "" }
  ]);
  const [editingWorkoutRowId, setEditingWorkoutRowId] = useState<string | null>(null);
  const [editWorkoutMode, setEditWorkoutMode] = useState<"planned" | "historical">("planned");
  const [editDraftPrefill, setEditDraftPrefill] = useState({
    weight: "",
    reps: "",
    timeSeconds: "",
    rir: "",
    tir: "",
    rpe: ""
  });
  const [editHistoricalSets, setEditHistoricalSets] = useState<SingleAddSet[]>([
    { weight: "", reps: "", timeSeconds: "", rir: "", tir: "", rpe: "" }
  ]);

  const adminPresetCfgId = useId();

  const selectedPreset = assignablePresets.find((preset) => preset.id === selectedPresetId) ?? null;

  const historicalAssignInputsValid = useMemo(() => {
    if (!selectedPreset || addWorkoutMode !== "historical") return true;
    for (const exercise of selectedPreset.exercises) {
      const rows = historicalSetsByExerciseId[exercise.id];
      if (!rows?.length) return false;
      if (!canSubmitWorkoutInputs(rows, exercise.type, 0)) return false;
    }
    return true;
  }, [selectedPreset, addWorkoutMode, historicalSetsByExerciseId]);

  const loadUserAdminData = useCallback(async (accessToken: string) => {
    const [workoutsRes, presetsRes, restDatesRes, exerciseConfigsRes] = await Promise.all([
      fetchAdminUserWorkoutsAction(userId, accessToken),
      fetchAdminAssignablePresetsAction(userId, accessToken),
      fetchAdminUserRestDatesAction(userId, accessToken),
      fetchAdminUserExerciseConfigsAction(userId, accessToken)
    ]);

    if (!workoutsRes.ok) {
      setFetchMessage(workoutsRes.message);
      setPhase("fetch_error");
      return false;
    }

    if (!presetsRes.ok) {
      setFetchMessage(presetsRes.message);
      setPhase("fetch_error");
      return false;
    }
    if (!restDatesRes.ok) {
      setFetchMessage(restDatesRes.message);
      setPhase("fetch_error");
      return false;
    }
    if (!exerciseConfigsRes.ok) {
      setFetchMessage(exerciseConfigsRes.message);
      setPhase("fetch_error");
      return false;
    }

    setRows(workoutsRes.data as WorkoutRow[]);
    setAssignablePresets(presetsRes.data as AssignablePreset[]);
    setRestDates(restDatesRes.data.restDates);
    setUserExerciseConfigs(exerciseConfigsRes.data as UserExerciseConfig[]);
    setSelectedPresetId((current) => {
      if (current && presetsRes.data.some((preset) => preset.id === current)) return current;
      return presetsRes.data[0]?.id ?? "";
    });
    setSingleExistingExerciseId((current) => {
      if (current && exerciseConfigsRes.data.some((cfg) => cfg.id === current)) return current;
      return exerciseConfigsRes.data[0]?.id ?? "";
    });
    setPhase("ready");
    return true;
  }, [userId]);

  useEffect(() => {
    if (!selectedPreset) return;
    setHistoricalSetsByExerciseId((current) => {
      const next: Record<string, Array<{ weight: string; reps: string; timeSeconds: string; rir: string; tir: string; rpe: string }>> = {};
      for (const exercise of selectedPreset.exercises) {
        const existing = current[exercise.id];
        if (existing && existing.length === exercise.setCount) {
          next[exercise.id] = existing;
          continue;
        }
        next[exercise.id] = Array.from({ length: Math.max(1, exercise.setCount) }, () => ({
          weight: "",
          reps: "",
          timeSeconds: "",
          rir: "",
          tir: "",
          rpe: ""
        }));
      }
      return next;
    });
  }, [selectedPreset]);

  useEffect(() => {
    if (!selectedPreset) return;
    setDraftPrefillByExerciseId((current) => {
      const next: Record<string, { weight: string; reps: string; timeSeconds: string; rir: string; tir: string; rpe: string }> = {};
      for (const exercise of selectedPreset.exercises) {
        next[exercise.id] = current[exercise.id] ?? {
          weight: "",
          reps: "",
          timeSeconds: "",
          rir: "",
          tir: "",
          rpe: ""
        };
      }
      return next;
    });
  }, [selectedPreset]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const expected = expectedAdminEmail.trim().toLowerCase();
      if (!expected) {
        if (!cancelled) {
          setFetchMessage("Admin email is not configured.");
          setPhase("fetch_error");
        }
        return;
      }

      const {
        data: { session },
        error: sessionError
      } = await supabase.auth.getSession();

      if (cancelled) return;

      const accessToken = session?.access_token;
      const user = session?.user;

      if (sessionError || !user?.email || !accessToken) {
        setPhase("login");
        return;
      }

      if (user.email.trim().toLowerCase() !== expected) {
        setPhase("unauthorized");
        return;
      }

      setAdminAccessToken(accessToken);
      setPhase("loading");
      const ok = await loadUserAdminData(accessToken);
      if (cancelled) return;
      if (!ok) return;
    })();

    return () => {
      cancelled = true;
    };
  }, [expectedAdminEmail, loadUserAdminData]);

  if (phase === "loading" && rows === null) {
    return (
      <p className="text-sm text-slate-600" aria-live="polite">
        Loading user workouts…
      </p>
    );
  }

  if (phase === "login") {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-sm text-slate-800" role="status">
        Please log in first.
      </div>
    );
  }

  if (phase === "unauthorized") {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-950" role="status">
        Not authorized.
      </div>
    );
  }

  if (phase === "fetch_error" || !rows) {
    return (
      <section className="space-y-4">
        <Link href="/admin" className="text-sm font-medium text-slate-700 underline underline-offset-2">
          ← Back to admin
        </Link>
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
          {fetchMessage ?? "Could not load workouts. Check server configuration."}
        </p>
      </section>
    );
  }

  const byDate = groupWorkoutsByDate(rows);
  const calendarDays = buildMonthGrid(assignDate);
  const selectedDateRows = byDate.get(assignDate) ?? [];
  const selectedDateIsRestDay = restDates.includes(assignDate);
  const selectedMonthDate = new Date(`${assignDate}T12:00:00`);
  const selectedMonthLabel = Number.isFinite(selectedMonthDate.getTime())
    ? selectedMonthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : assignDate;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm font-medium text-slate-700 underline underline-offset-2">
            ← Back to admin
          </Link>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">User workouts</h2>
          <p className="mt-1 font-mono text-xs text-slate-600">{userId}</p>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Create Preset for User</h3>
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-600">Preset name</span>
          <input
            type="text"
            value={newPresetName}
            onChange={(event) => setNewPresetName(event.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
            placeholder="e.g. Push Day A"
          />
        </label>
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Add exercise</p>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">Exercise name</span>
            <input
              type="text"
              value={presetExerciseDraft.name}
              onChange={(event) =>
                setPresetExerciseDraft((prev) => ({ ...prev, name: event.target.value }))
              }
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              placeholder="Exercise name"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">Exercise type</span>
            <select
              value={presetExerciseDraft.exerciseType}
              onChange={(event) =>
                setPresetExerciseDraft((prev) => ({
                  ...prev,
                  exerciseType: event.target.value as "weight" | "bodyweight" | "time",
                  targetMode: event.target.value === "time" ? "time" : "reps"
                }))
              }
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
            >
              <option value="weight">Weight</option>
              <option value="bodyweight">Bodyweight</option>
              <option value="time">Time</option>
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">Target mode</span>
              <select
                id={`${adminPresetCfgId}-target-mode`}
                value={presetExerciseDraft.targetMode}
                onChange={(event) =>
                  setPresetExerciseDraft((prev) => ({
                    ...prev,
                    targetMode: event.target.value as "reps" | "time"
                  }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              >
                <option value="reps">Target reps</option>
                <option value="time">Target time (seconds)</option>
              </select>
            </label>
            <div className="space-y-1">
              <FieldLabelHelp
                htmlFor={`${adminPresetCfgId}-target-value`}
                label={presetExerciseDraft.targetMode === "time" ? "Target time" : "Target reps"}
                helpText={
                  presetExerciseDraft.targetMode === "time"
                    ? EXERCISE_CONFIG_HELP.targetTime
                    : EXERCISE_CONFIG_HELP.targetReps
                }
              />
              <input
                id={`${adminPresetCfgId}-target-value`}
                type="number"
                min={1}
                value={presetExerciseDraft.targetReps}
                onChange={(event) =>
                  setPresetExerciseDraft((prev) => ({ ...prev, targetReps: Number(event.target.value) }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <FieldLabelHelp
                htmlFor={`${adminPresetCfgId}-sets`}
                label="Sets"
                helpText={EXERCISE_CONFIG_HELP.sets}
              />
              <input
                id={`${adminPresetCfgId}-sets`}
                type="number"
                min={1}
                value={presetExerciseDraft.setCount}
                onChange={(event) =>
                  setPresetExerciseDraft((prev) => ({ ...prev, setCount: Number(event.target.value) }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              />
            </div>
            <div className="space-y-1">
              <FieldLabelHelp
                htmlFor={`${adminPresetCfgId}-increment`}
                label="Increment"
                helpText={EXERCISE_CONFIG_HELP.increment}
              />
              <input
                id={`${adminPresetCfgId}-increment`}
                type="number"
                min={0}
                step={0.5}
                value={presetExerciseDraft.increment}
                onChange={(event) =>
                  setPresetExerciseDraft((prev) => ({ ...prev, increment: Number(event.target.value) }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              />
            </div>
            <div className="space-y-1">
              <FieldLabelHelp
                htmlFor={`${adminPresetCfgId}-unit`}
                label="Unit"
                helpText={EXERCISE_CONFIG_HELP.unit}
              />
              <select
                id={`${adminPresetCfgId}-unit`}
                value={presetExerciseDraft.unit}
                onChange={(event) =>
                  setPresetExerciseDraft((prev) => ({ ...prev, unit: event.target.value as "lbs" | "kg" }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              >
                <option value="lbs">lbs</option>
                <option value="kg">kg</option>
              </select>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <TrackCheckboxRow
              checked={presetExerciseDraft.trackRir}
              onChange={(checked) =>
                setPresetExerciseDraft((prev) => ({ ...prev, trackRir: checked }))
              }
              labelText={presetExerciseDraft.targetMode === "time" ? "Track TIR" : "Track RIR"}
              helpText={
                presetExerciseDraft.targetMode === "time"
                  ? EXERCISE_CONFIG_HELP.tir
                  : EXERCISE_CONFIG_HELP.rir
              }
            />
            <TrackCheckboxRow
              checked={presetExerciseDraft.trackRpe}
              onChange={(checked) =>
                setPresetExerciseDraft((prev) => ({ ...prev, trackRpe: checked }))
              }
              labelText="Track RPE"
              helpText={EXERCISE_CONFIG_HELP.rpe}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              const name = presetExerciseDraft.name.trim();
              if (!name) return;
              setNewPresetExercises((prev) => [...prev, { ...presetExerciseDraft, name }]);
              setPresetExerciseDraft((prev) => ({
                ...initialPresetExerciseDraft,
                unit: prev.unit
              }));
            }}
            className={actionButtonClasses.secondary}
          >
            Add exercise
          </button>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preset exercises</p>
          {newPresetExercises.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No exercises added yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {newPresetExercises.map((exercise, index) => (
                <li key={`${exercise.name}-${index}`} className="rounded border border-slate-200 bg-white px-2.5 py-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{exercise.name}</p>
                      <p className="text-slate-600">
                        {exercise.exerciseType} ·{" "}
                        {exercise.setCount} sets ·{" "}
                        {exercise.targetMode === "time"
                          ? `T ${exercise.targetReps}s`
                          : `T ${exercise.targetReps} reps`}{" "}
                        · +{exercise.increment} {exercise.unit} · RIR/TIR: {exercise.trackRir ? "Y" : "N"} · RPE:{" "}
                        {exercise.trackRpe ? "Y" : "N"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setNewPresetExercises((prev) => prev.filter((_, i) => i !== index))
                      }
                      className={actionButtonClasses.destructiveSm}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isCreatingPreset || !adminAccessToken}
            onClick={async () => {
              if (!adminAccessToken) return;
              setCreatePresetMessage(null);
              setCreatePresetError(null);

              const trimmedName = newPresetName.trim();
              if (!trimmedName) {
                setCreatePresetError("Preset name is required.");
                return;
              }
              if (newPresetExercises.length === 0) {
                setCreatePresetError("Add at least one exercise.");
                return;
              }

              setIsCreatingPreset(true);
              const res = await createAdminPresetForUserAction(
                userId,
                {
                  name: trimmedName,
                  exercises: newPresetExercises.map((exercise) => ({
                    id: crypto.randomUUID(),
                    name: exercise.name,
                    type: exercise.exerciseType,
                    targetReps: exercise.targetReps,
                    setCount: exercise.setCount,
                    increment: exercise.increment,
                    unit: exercise.unit,
                    trackRir: exercise.trackRir,
                    trackRpe: exercise.trackRpe
                  }))
                },
                adminAccessToken
              );
              if (!res.ok) {
                setCreatePresetError(res.message);
                setIsCreatingPreset(false);
                return;
              }

              setCreatePresetMessage("Created preset for this user.");
              setNewPresetName("");
              setNewPresetExercises([]);
              setPresetExerciseDraft(initialPresetExerciseDraft);
              await loadUserAdminData(adminAccessToken);
              setIsCreatingPreset(false);
            }}
            className={actionButtonClass("primary", "disabled:cursor-not-allowed")}
          >
            {isCreatingPreset ? "Creating..." : "Create preset for user"}
          </button>
        </div>
        {createPresetMessage ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {createPresetMessage}
          </p>
        ) : null}
        {createPresetError ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            {createPresetError}
          </p>
        ) : null}
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Calendar Day Control</h3>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)]">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                className={actionButtonClasses.secondarySm}
                onClick={() => setAssignDate(addMonths(assignDate, -1))}
              >
                Prev
              </button>
              <p className="text-sm font-semibold text-slate-800">{selectedMonthLabel}</p>
              <button
                type="button"
                className={actionButtonClasses.secondarySm}
                onClick={() => setAssignDate(addMonths(assignDate, 1))}
              >
                Next
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {calendarDays.map((day) => {
                const d = new Date(`${day}T12:00:00`);
                const sameMonth = Number.isFinite(d.getTime()) && d.getMonth() === selectedMonthDate.getMonth();
                const isSelected = day === assignDate;
                const count = (byDate.get(day) ?? []).length;
                const isRest = restDates.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setAssignDate(day)}
                    className={`rounded px-1 py-1.5 text-xs ${
                      isSelected
                        ? "bg-slate-900 text-white"
                        : sameMonth
                          ? "bg-white text-slate-800 hover:bg-slate-100"
                          : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    <div>{Number.isFinite(d.getTime()) ? d.getDate() : "?"}</div>
                    <div className={`text-[0.6rem] ${isSelected ? "text-white/90" : "text-slate-500"}`}>
                      {isRest ? "rest" : count > 0 ? `${count}w` : "—"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">Day overview: {assignDate}</p>
              <p className="text-xs text-slate-600">
                {selectedDateIsRestDay ? "Rest day marked" : "Not marked as rest day"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isUpdatingRestDay || !adminAccessToken}
                onClick={async () => {
                  if (!adminAccessToken) return;
                  setAssignMessage(null);
                  setAssignError(null);
                  setIsUpdatingRestDay(true);
                  const result = await setAdminUserRestDayAction(userId, assignDate, true, adminAccessToken);
                  if (!result.ok) {
                    setAssignError(result.message);
                    setIsUpdatingRestDay(false);
                    return;
                  }
                  setRestDates(result.data.restDates);
                  setAssignMessage("Marked this date as rest day for this user.");
                  await loadUserAdminData(adminAccessToken);
                  setIsUpdatingRestDay(false);
                }}
                className={actionButtonClass("info", "disabled:cursor-not-allowed")}
              >
                Mark rest day
              </button>
              <button
                type="button"
                disabled={isUpdatingRestDay || !adminAccessToken}
                onClick={async () => {
                  if (!adminAccessToken) return;
                  setAssignMessage(null);
                  setAssignError(null);
                  setIsUpdatingRestDay(true);
                  const result = await setAdminUserRestDayAction(userId, assignDate, false, adminAccessToken);
                  if (!result.ok) {
                    setAssignError(result.message);
                    setIsUpdatingRestDay(false);
                    return;
                  }
                  setRestDates(result.data.restDates);
                  setAssignMessage("Cleared rest day for this user.");
                  await loadUserAdminData(adminAccessToken);
                  setIsUpdatingRestDay(false);
                }}
                className={actionButtonClass("secondary", "disabled:cursor-not-allowed")}
              >
                Clear rest day
              </button>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Add single exercise</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setSingleExerciseMode("existing")}
                  className={singleExerciseMode === "existing" ? actionButtonClasses.primary : actionButtonClasses.secondary}
                >
                  Use existing config
                </button>
                <button
                  type="button"
                  onClick={() => setSingleExerciseMode("quick")}
                  className={singleExerciseMode === "quick" ? actionButtonClasses.primary : actionButtonClasses.secondary}
                >
                  Quick create config
                </button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setSingleAddMode("planned")}
                  className={singleAddMode === "planned" ? actionButtonClasses.primary : actionButtonClasses.secondary}
                >
                  Add planned draft
                </button>
                <button
                  type="button"
                  onClick={() => setSingleAddMode("historical")}
                  className={singleAddMode === "historical" ? actionButtonClasses.primary : actionButtonClasses.secondary}
                >
                  Add completed historical
                </button>
              </div>

              {singleExerciseMode === "existing" ? (
                <label className="mt-2 block space-y-1">
                  <span className="text-xs font-medium text-slate-600">Exercise config</span>
                  <select
                    value={singleExistingExerciseId}
                    onChange={(event) => setSingleExistingExerciseId(event.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm"
                  >
                    {userExerciseConfigs.length === 0 ? (
                      <option value="">No exercise configs found</option>
                    ) : (
                      userExerciseConfigs.map((cfg) => (
                        <option key={cfg.id} value={cfg.id}>
                          {cfg.name} ({cfg.type}, {cfg.setCount} sets)
                        </option>
                      ))
                    )}
                  </select>
                </label>
              ) : (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input
                    value={singleQuickConfig.name}
                    onChange={(event) => setSingleQuickConfig((prev) => ({ ...prev, name: event.target.value }))}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm"
                    placeholder="Exercise name"
                  />
                  <select
                    value={singleQuickConfig.exerciseType}
                    onChange={(event) =>
                      setSingleQuickConfig((prev) => ({
                        ...prev,
                        exerciseType: event.target.value as "weight" | "bodyweight" | "time",
                        targetMode: event.target.value === "time" ? "time" : "reps"
                      }))
                    }
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm"
                  >
                    <option value="weight">weight</option>
                    <option value="bodyweight">bodyweight</option>
                    <option value="time">time</option>
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={singleQuickConfig.targetReps}
                    onChange={(event) => setSingleQuickConfig((prev) => ({ ...prev, targetReps: Number(event.target.value) }))}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm"
                    placeholder={singleQuickConfig.exerciseType === "time" ? "Target time (s)" : "Target reps"}
                  />
                  <input
                    type="number"
                    min={1}
                    value={singleQuickConfig.setCount}
                    onChange={(event) => setSingleQuickConfig((prev) => ({ ...prev, setCount: Number(event.target.value) }))}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm"
                    placeholder="Sets"
                  />
                </div>
              )}

              {singleAddMode === "planned" ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <input type="number" value={singleDraftPrefill.weight} onChange={(event) => setSingleDraftPrefill((prev) => ({ ...prev, weight: event.target.value }))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="Weight" />
                  <input type="number" value={singleDraftPrefill.reps} onChange={(event) => setSingleDraftPrefill((prev) => ({ ...prev, reps: event.target.value }))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="Reps" />
                  <input type="number" value={singleDraftPrefill.timeSeconds} onChange={(event) => setSingleDraftPrefill((prev) => ({ ...prev, timeSeconds: event.target.value }))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="Time (s)" />
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  {singleHistoricalSets.map((set, setIndex) => (
                    <div key={`single-hist-${setIndex}`} className="grid gap-2 sm:grid-cols-6">
                      <input type="number" value={set.weight} onChange={(event) => setSingleHistoricalSets((prev) => prev.map((row, i) => i === setIndex ? { ...row, weight: event.target.value } : row))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="Weight" />
                      <input type="number" value={set.reps} onChange={(event) => setSingleHistoricalSets((prev) => prev.map((row, i) => i === setIndex ? { ...row, reps: event.target.value } : row))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="Reps" />
                      <input type="number" value={set.timeSeconds} onChange={(event) => setSingleHistoricalSets((prev) => prev.map((row, i) => i === setIndex ? { ...row, timeSeconds: event.target.value } : row))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="Time (s)" />
                      <input type="text" value={set.rir} onChange={(event) => setSingleHistoricalSets((prev) => prev.map((row, i) => i === setIndex ? { ...row, rir: event.target.value } : row))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="RIR" />
                      <input type="text" value={set.tir} onChange={(event) => setSingleHistoricalSets((prev) => prev.map((row, i) => i === setIndex ? { ...row, tir: event.target.value } : row))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="TIR" />
                      <input type="text" value={set.rpe} onChange={(event) => setSingleHistoricalSets((prev) => prev.map((row, i) => i === setIndex ? { ...row, rpe: event.target.value } : row))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="RPE" />
                    </div>
                  ))}
                  <button type="button" onClick={() => setSingleHistoricalSets((prev) => [...prev, { weight: "", reps: "", timeSeconds: "", rir: "", tir: "", rpe: "" }])} className={actionButtonClasses.secondarySm}>
                    Add set row
                  </button>
                </div>
              )}

              <div className="mt-2">
                <button
                  type="button"
                  disabled={!adminAccessToken || isSavingWorkout}
                  className={actionButtonClass("primary", "disabled:cursor-not-allowed")}
                  onClick={async () => {
                    if (!adminAccessToken) return;
                    setAssignMessage(null);
                    setAssignError(null);
                    setIsSavingWorkout(true);
                    const payload =
                      singleExerciseMode === "existing"
                        ? {
                            date: assignDate,
                            mode: singleAddMode,
                            exerciseId: singleExistingExerciseId,
                            prefill: singleDraftPrefill,
                            sets: singleHistoricalSets
                          }
                        : {
                            date: assignDate,
                            mode: singleAddMode,
                            exerciseConfig: {
                              name: singleQuickConfig.name,
                              type: singleQuickConfig.exerciseType,
                              targetReps: singleQuickConfig.targetReps,
                              setCount: singleQuickConfig.setCount,
                              increment: singleQuickConfig.increment,
                              unit: singleQuickConfig.unit,
                              trackRir: singleQuickConfig.trackRir,
                              trackRpe: singleQuickConfig.trackRpe
                            },
                            prefill: singleDraftPrefill,
                            sets: singleHistoricalSets
                          };
                    const result = await addAdminSingleWorkoutToUserDateAction(userId, payload, adminAccessToken);
                    if (!result.ok) {
                      setAssignError(result.message);
                      setIsSavingWorkout(false);
                      return;
                    }
                    setAssignMessage(
                      singleAddMode === "planned" ? "Added planned workout to this day." : "Added completed workout to this day."
                    );
                    await loadUserAdminData(adminAccessToken);
                    setIsSavingWorkout(false);
                  }}
                >
                  {isSavingWorkout ? "Saving..." : singleAddMode === "planned" ? "Add planned workout" : "Add completed workout"}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workouts on selected day</p>
              {selectedDateRows.length === 0 ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No workouts for this date.</p>
              ) : (
                selectedDateRows.map((row) => {
                  const parsed = row.parsed;
                  if (!parsed) {
                    return (
                      <div key={row.id} className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
                        Unparseable workout row: {row.id}
                      </div>
                    );
                  }
                  const isDraft = parsed.isDraft === true;
                  const status = isDraft ? "draft/planned" : parsed.sessionCps === null ? "partial" : "completed";
                  const isEditing = editingWorkoutRowId === row.id;
                  return (
                    <div key={row.id} className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{parsed.exerciseName}</p>
                        <p className="text-xs uppercase tracking-wide text-slate-500">{status}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        CPS: {formatCps(parsed.sessionCps)} · Volume: {parsed.sessionVolume}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={actionButtonClasses.secondarySm}
                          onClick={() => {
                            setEditingWorkoutRowId(row.id);
                            if (isDraft) {
                              setEditWorkoutMode("planned");
                              const first = parsed.sets[0] ?? { weight: "", reps: "", timeSeconds: 0, rir: "", tir: "", rpe: "" };
                              setEditDraftPrefill({
                                weight: String(first.weight ?? ""),
                                reps: String(first.reps ?? ""),
                                timeSeconds: String(first.timeSeconds ?? ""),
                                rir: String(first.rir ?? ""),
                                tir: String(first.tir ?? ""),
                                rpe: String(first.rpe ?? "")
                              });
                            } else {
                              setEditWorkoutMode("historical");
                              setEditHistoricalSets(
                                parsed.sets.map((set) => ({
                                  weight: String(set.weight ?? ""),
                                  reps: String(set.reps ?? ""),
                                  timeSeconds: String(set.timeSeconds ?? ""),
                                  rir: String(set.rir ?? ""),
                                  tir: String(set.tir ?? ""),
                                  rpe: String(set.rpe ?? "")
                                }))
                              );
                            }
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={actionButtonClasses.destructiveSm}
                          onClick={async () => {
                            if (!adminAccessToken) return;
                            if (!window.confirm("Delete this workout entry for the selected user and date?")) return;
                            setAssignMessage(null);
                            setAssignError(null);
                            const result = await deleteAdminUserWorkoutAction(userId, row.id, adminAccessToken);
                            if (!result.ok) {
                              setAssignError(result.message);
                              return;
                            }
                            setAssignMessage("Workout entry removed.");
                            await loadUserAdminData(adminAccessToken);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                      {isEditing ? (
                        <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => setEditWorkoutMode("planned")} className={editWorkoutMode === "planned" ? actionButtonClasses.primary : actionButtonClasses.secondary}>Planned</button>
                            <button type="button" onClick={() => setEditWorkoutMode("historical")} className={editWorkoutMode === "historical" ? actionButtonClasses.primary : actionButtonClasses.secondary}>Completed</button>
                          </div>
                          {editWorkoutMode === "planned" ? (
                            <div className="grid gap-2 sm:grid-cols-3">
                              <input type="number" value={editDraftPrefill.weight} onChange={(event) => setEditDraftPrefill((prev) => ({ ...prev, weight: event.target.value }))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="Weight" />
                              <input type="number" value={editDraftPrefill.reps} onChange={(event) => setEditDraftPrefill((prev) => ({ ...prev, reps: event.target.value }))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="Reps" />
                              <input type="number" value={editDraftPrefill.timeSeconds} onChange={(event) => setEditDraftPrefill((prev) => ({ ...prev, timeSeconds: event.target.value }))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="Time (s)" />
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {editHistoricalSets.map((set, setIndex) => (
                                <div key={`edit-${row.id}-${setIndex}`} className="grid gap-2 sm:grid-cols-6">
                                  <input type="number" value={set.weight} onChange={(event) => setEditHistoricalSets((prev) => prev.map((rowSet, i) => i === setIndex ? { ...rowSet, weight: event.target.value } : rowSet))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="Weight" />
                                  <input type="number" value={set.reps} onChange={(event) => setEditHistoricalSets((prev) => prev.map((rowSet, i) => i === setIndex ? { ...rowSet, reps: event.target.value } : rowSet))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="Reps" />
                                  <input type="number" value={set.timeSeconds} onChange={(event) => setEditHistoricalSets((prev) => prev.map((rowSet, i) => i === setIndex ? { ...rowSet, timeSeconds: event.target.value } : rowSet))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="Time (s)" />
                                  <input type="text" value={set.rir} onChange={(event) => setEditHistoricalSets((prev) => prev.map((rowSet, i) => i === setIndex ? { ...rowSet, rir: event.target.value } : rowSet))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="RIR" />
                                  <input type="text" value={set.tir} onChange={(event) => setEditHistoricalSets((prev) => prev.map((rowSet, i) => i === setIndex ? { ...rowSet, tir: event.target.value } : rowSet))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="TIR" />
                                  <input type="text" value={set.rpe} onChange={(event) => setEditHistoricalSets((prev) => prev.map((rowSet, i) => i === setIndex ? { ...rowSet, rpe: event.target.value } : rowSet))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" placeholder="RPE" />
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={actionButtonClasses.primary}
                              disabled={!adminAccessToken}
                              onClick={async () => {
                                if (!adminAccessToken) return;
                                const result = await updateAdminUserWorkoutAction(
                                  userId,
                                  row.id,
                                  {
                                    date: assignDate,
                                    mode: editWorkoutMode,
                                    prefill: editDraftPrefill,
                                    sets: editHistoricalSets
                                  },
                                  adminAccessToken
                                );
                                if (!result.ok) {
                                  setAssignError(result.message);
                                  return;
                                }
                                setAssignMessage("Workout entry updated.");
                                setEditingWorkoutRowId(null);
                                await loadUserAdminData(adminAccessToken);
                              }}
                            >
                              Save changes
                            </button>
                            <button type="button" className={actionButtonClasses.secondary} onClick={() => setEditingWorkoutRowId(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        {assignMessage ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {assignMessage}
          </p>
        ) : null}
        {assignError ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            {assignError}
          </p>
        ) : null}
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Add Workout for User</h3>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Calendar control</p>
          <p className="mt-1 text-xs text-slate-600">
            {restDates.includes(assignDate) ? "This date is currently marked as rest day." : "This date is not marked as rest day."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isUpdatingRestDay || !adminAccessToken || !assignDate}
              onClick={async () => {
                if (!adminAccessToken || !assignDate) return;
                setAssignMessage(null);
                setAssignError(null);
                setIsUpdatingRestDay(true);
                const result = await setAdminUserRestDayAction(userId, assignDate, true, adminAccessToken);
                if (!result.ok) {
                  setAssignError(result.message);
                  setIsUpdatingRestDay(false);
                  return;
                }
                setRestDates(result.data.restDates);
                setAssignMessage("Marked this date as rest day for this user.");
                await loadUserAdminData(adminAccessToken);
                setIsUpdatingRestDay(false);
              }}
              className={actionButtonClass("info", "disabled:cursor-not-allowed")}
            >
              Mark rest day
            </button>
            <button
              type="button"
              disabled={isUpdatingRestDay || !adminAccessToken || !assignDate}
              onClick={async () => {
                if (!adminAccessToken || !assignDate) return;
                setAssignMessage(null);
                setAssignError(null);
                setIsUpdatingRestDay(true);
                const result = await setAdminUserRestDayAction(userId, assignDate, false, adminAccessToken);
                if (!result.ok) {
                  setAssignError(result.message);
                  setIsUpdatingRestDay(false);
                  return;
                }
                setRestDates(result.data.restDates);
                setAssignMessage("Cleared rest day for this user.");
                await loadUserAdminData(adminAccessToken);
                setIsUpdatingRestDay(false);
              }}
              className={actionButtonClass("secondary", "disabled:cursor-not-allowed")}
            >
              Clear rest day
            </button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setAddWorkoutMode("planned")}
            className={
              addWorkoutMode === "planned"
                ? actionButtonClasses.primary
                : actionButtonClasses.secondary
            }
          >
            Assign as planned workout
          </button>
          <button
            type="button"
            onClick={() => setAddWorkoutMode("historical")}
            className={
              addWorkoutMode === "historical"
                ? actionButtonClasses.primary
                : actionButtonClasses.secondary
            }
          >
            Add as completed historical workout
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Date</span>
            <input
              type="date"
              value={assignDate}
              onChange={(event) => setAssignDate(event.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Saved preset</span>
            <select
              value={selectedPresetId}
              onChange={(event) => setSelectedPresetId(event.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
            >
              {assignablePresets.length === 0 ? (
                <option value="">No presets found</option>
              ) : (
                assignablePresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} ({preset.exerciseCount} exercise{preset.exerciseCount === 1 ? "" : "s"})
                  </option>
                ))
              )}
            </select>
          </label>
        </div>
        {addWorkoutMode === "historical" && selectedPreset ? (
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Completed set data</p>
            {selectedPreset.exercises.map((exercise) => (
              <div key={exercise.id} className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
                <p className="text-sm font-medium text-slate-900">
                  {exercise.name} ({exercise.type}) · {exercise.setCount} sets
                </p>
                <div className="space-y-2">
                  {(historicalSetsByExerciseId[exercise.id] ?? []).map((set, setIndex) => (
                    <div key={`${exercise.id}-${setIndex}`} className="grid gap-2 sm:grid-cols-6">
                      <div className="space-y-1">
                        <span className="text-[0.65rem] font-medium text-slate-600">Weight</span>
                        <input
                          type="number"
                          step={0.5}
                          value={set.weight}
                          onChange={(event) =>
                            setHistoricalSetsByExerciseId((prev) => ({
                              ...prev,
                              [exercise.id]: (prev[exercise.id] ?? []).map((item, i) =>
                                i === setIndex ? { ...item, weight: event.target.value } : item
                              )
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-[0.65rem] font-medium text-slate-600">Reps</span>
                        <input
                          type="number"
                          step={1}
                          value={set.reps}
                          onChange={(event) =>
                            setHistoricalSetsByExerciseId((prev) => ({
                              ...prev,
                              [exercise.id]: (prev[exercise.id] ?? []).map((item, i) =>
                                i === setIndex ? { ...item, reps: event.target.value } : item
                              )
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-[0.65rem] font-medium text-slate-600">Time (s)</span>
                        <input
                          type="number"
                          step={1}
                          value={set.timeSeconds}
                          onChange={(event) =>
                            setHistoricalSetsByExerciseId((prev) => ({
                              ...prev,
                              [exercise.id]: (prev[exercise.id] ?? []).map((item, i) =>
                                i === setIndex ? { ...item, timeSeconds: event.target.value } : item
                              )
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <FieldLabelHelp
                          htmlFor={`hist-${exercise.id}-${setIndex}-rir`}
                          label="RIR"
                          helpText={EXERCISE_CONFIG_HELP.rir}
                        />
                        <input
                          id={`hist-${exercise.id}-${setIndex}-rir`}
                          type="text"
                          value={set.rir}
                          onChange={(event) =>
                            setHistoricalSetsByExerciseId((prev) => ({
                              ...prev,
                              [exercise.id]: (prev[exercise.id] ?? []).map((item, i) =>
                                i === setIndex ? { ...item, rir: event.target.value } : item
                              )
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <FieldLabelHelp
                          htmlFor={`hist-${exercise.id}-${setIndex}-tir`}
                          label="TIR"
                          helpText={EXERCISE_CONFIG_HELP.tir}
                        />
                        <input
                          id={`hist-${exercise.id}-${setIndex}-tir`}
                          type="text"
                          value={set.tir}
                          onChange={(event) =>
                            setHistoricalSetsByExerciseId((prev) => ({
                              ...prev,
                              [exercise.id]: (prev[exercise.id] ?? []).map((item, i) =>
                                i === setIndex ? { ...item, tir: event.target.value } : item
                              )
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <FieldLabelHelp
                          htmlFor={`hist-${exercise.id}-${setIndex}-rpe`}
                          label="RPE"
                          helpText={EXERCISE_CONFIG_HELP.rpe}
                        />
                        <input
                          id={`hist-${exercise.id}-${setIndex}-rpe`}
                          type="text"
                          value={set.rpe}
                          onChange={(event) =>
                            setHistoricalSetsByExerciseId((prev) => ({
                              ...prev,
                              [exercise.id]: (prev[exercise.id] ?? []).map((item, i) =>
                                i === setIndex ? { ...item, rpe: event.target.value } : item
                              )
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {addWorkoutMode === "planned" && selectedPreset ? (
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Optional planned prefill targets
            </p>
            {selectedPreset.exercises.map((exercise) => {
              const prefill = draftPrefillByExerciseId[exercise.id] ?? {
                weight: "",
                reps: "",
                timeSeconds: "",
                rir: "",
                tir: "",
                rpe: ""
              };
              return (
                <div key={exercise.id} className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-6">
                  <p className="sm:col-span-6 text-sm font-medium text-slate-900">{exercise.name}</p>
                  <div className="space-y-1">
                    <span className="text-[0.65rem] font-medium text-slate-600">Weight</span>
                    <input
                      type="number"
                      step={0.5}
                      value={prefill.weight}
                      onChange={(event) =>
                        setDraftPrefillByExerciseId((prev) => ({
                          ...prev,
                          [exercise.id]: { ...prefill, weight: event.target.value }
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[0.65rem] font-medium text-slate-600">Reps</span>
                    <input
                      type="number"
                      step={1}
                      value={prefill.reps}
                      onChange={(event) =>
                        setDraftPrefillByExerciseId((prev) => ({
                          ...prev,
                          [exercise.id]: { ...prefill, reps: event.target.value }
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[0.65rem] font-medium text-slate-600">Time (s)</span>
                    <input
                      type="number"
                      step={1}
                      value={prefill.timeSeconds}
                      onChange={(event) =>
                        setDraftPrefillByExerciseId((prev) => ({
                          ...prev,
                          [exercise.id]: { ...prefill, timeSeconds: event.target.value }
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldLabelHelp
                      htmlFor={`plan-${exercise.id}-rir`}
                      label="RIR"
                      helpText={EXERCISE_CONFIG_HELP.rir}
                    />
                    <input
                      id={`plan-${exercise.id}-rir`}
                      type="text"
                      value={prefill.rir}
                      onChange={(event) =>
                        setDraftPrefillByExerciseId((prev) => ({
                          ...prev,
                          [exercise.id]: { ...prefill, rir: event.target.value }
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldLabelHelp
                      htmlFor={`plan-${exercise.id}-tir`}
                      label="TIR"
                      helpText={EXERCISE_CONFIG_HELP.tir}
                    />
                    <input
                      id={`plan-${exercise.id}-tir`}
                      type="text"
                      value={prefill.tir}
                      onChange={(event) =>
                        setDraftPrefillByExerciseId((prev) => ({
                          ...prev,
                          [exercise.id]: { ...prefill, tir: event.target.value }
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldLabelHelp
                      htmlFor={`plan-${exercise.id}-rpe`}
                      label="RPE"
                      helpText={EXERCISE_CONFIG_HELP.rpe}
                    />
                    <input
                      id={`plan-${exercise.id}-rpe`}
                      type="text"
                      value={prefill.rpe}
                      onChange={(event) =>
                        setDraftPrefillByExerciseId((prev) => ({
                          ...prev,
                          [exercise.id]: { ...prefill, rpe: event.target.value }
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={
              (isAssigning || isSavingWorkout) ||
              !adminAccessToken ||
              !selectedPresetId ||
              !assignDate ||
              assignablePresets.length === 0 ||
              (addWorkoutMode === "historical" && !historicalAssignInputsValid)
            }
            onClick={async () => {
              if (!adminAccessToken || !selectedPresetId || !assignDate) return;
              setAssignMessage(null);
              setAssignError(null);
              if (addWorkoutMode === "planned") {
                if (!selectedPreset) {
                  setAssignError("Select a preset.");
                  return;
                }
                const confirmed = window.confirm(
                  "Assign this preset to the selected date for this user? Existing workouts on that date will be kept."
                );
                if (!confirmed) return;
                setIsAssigning(true);
                const assignRes = await assignAdminPresetToUserDateAction(
                  userId,
                  selectedPresetId,
                  assignDate,
                  adminAccessToken,
                  selectedPreset.exercises.map((exercise) => ({
                    presetExerciseId: exercise.id,
                    prefill: draftPrefillByExerciseId[exercise.id]
                  }))
                );
                if (!assignRes.ok) {
                  setAssignError(assignRes.message);
                  setIsAssigning(false);
                  return;
                }
                setAssignMessage(`Assigned ${assignRes.data.assignedCount} planned workout(s) to this user.`);
                await loadUserAdminData(adminAccessToken);
                setIsAssigning(false);
                return;
              }

              if (!selectedPreset || selectedPreset.exercises.length === 0) {
                setAssignError("Select a preset with exercises.");
                return;
              }
              setIsSavingWorkout(true);
              const historicalRes = await addAdminHistoricalPresetToUserDateAction(
                userId,
                {
                  presetId: selectedPresetId,
                  date: assignDate,
                  exercises: selectedPreset.exercises.map((exercise) => ({
                    presetExerciseId: exercise.id,
                    sets: (historicalSetsByExerciseId[exercise.id] ?? []).map((set) => ({
                      weight: set.weight,
                      reps: set.reps,
                      timeSeconds: set.timeSeconds,
                      rir: set.rir,
                      tir: set.tir,
                      rpe: set.rpe
                    }))
                  }))
                },
                adminAccessToken
              );
              if (!historicalRes.ok) {
                setAssignError(historicalRes.message);
                setIsSavingWorkout(false);
                return;
              }
              setAssignMessage(`Added ${historicalRes.data.addedCount} historical workout(s) to this user.`);
              await loadUserAdminData(adminAccessToken);
              setIsSavingWorkout(false);
            }}
            className={actionButtonClass("primary", "disabled:cursor-not-allowed")}
          >
            {isAssigning || isSavingWorkout
              ? "Saving..."
              : addWorkoutMode === "planned"
                ? "Assign planned workout"
                : "Add historical workout"}
          </button>
        </div>
        {assignMessage ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {assignMessage}
          </p>
        ) : null}
        {assignError ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            {assignError}
          </p>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No workout rows for this user in Supabase.
        </p>
      ) : null}

      <details className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          Full workout list (secondary view)
        </summary>
        <div className="mt-3 space-y-8">
        {Array.from(byDate.entries()).map(([dateKey, dayRows]) => (
          <div key={dateKey} className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
              <h3 className="text-sm font-semibold text-slate-800">{dateKey}</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {dayRows.map((row) => (
                <div key={row.id} className="space-y-3 px-4 py-4">
                  {row.parsed ? (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-base font-semibold text-slate-900">{row.parsed.exerciseName}</p>
                          <p className="text-xs text-slate-500">
                            Submitted: {row.parsed.submittedAt}
                            {row.parsed.updatedAt ? ` · Updated: ${row.parsed.updatedAt}` : ""}
                            {row.createdAt ? ` · Row created_at: ${row.createdAt}` : ""}
                          </p>
                          {row.parsed.isDraft ? (
                            <p className="mt-1 text-xs font-medium text-amber-800">Draft</p>
                          ) : null}
                        </div>
                        <div className="text-right text-sm text-slate-700">
                          <p>
                            CPS: <span className="font-semibold">{formatCps(row.parsed.sessionCps)}</span>
                          </p>
                          <p>Volume: {row.parsed.sessionVolume}</p>
                          <p className="text-xs text-slate-500">{row.parsed.progressionStage}</p>
                        </div>
                      </div>
                      <p className="text-sm text-slate-800">
                        <span className="font-medium text-slate-600">Recommendation:</span>{" "}
                        {row.parsed.recommendation}
                      </p>
                      <div className="overflow-x-auto rounded-md border border-slate-200">
                        <table className="min-w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-600">
                            <tr>
                              <th className="px-2 py-1.5">Set</th>
                              <th className="px-2 py-1.5">Weight</th>
                              <th className="px-2 py-1.5">Reps</th>
                              <th className="px-2 py-1.5">Time (s)</th>
                              <th className="px-2 py-1.5">RIR</th>
                              <th className="px-2 py-1.5">RPE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.parsed.sets.map((set, i) => (
                              <tr key={i} className="border-t border-slate-100">
                                <td className="px-2 py-1.5 tabular-nums">{i + 1}</td>
                                <td className="px-2 py-1.5">{set.weight}</td>
                                <td className="px-2 py-1.5">{set.reps}</td>
                                <td className="px-2 py-1.5 tabular-nums">{set.timeSeconds}</td>
                                <td className="px-2 py-1.5">{set.rir || "—"}</td>
                                <td className="px-2 py-1.5">{set.rpe || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-rose-800">Unparseable workout row</p>
                      <p className="mt-1 font-mono text-xs text-slate-600">id: {row.id}</p>
                      {row.rawPreview ? (
                        <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-800">
                          {row.rawPreview}
                        </pre>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        </div>
      </details>
    </section>
  );
}
