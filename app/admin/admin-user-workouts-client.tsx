"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  assignAdminPresetToUserDateAction,
  createAdminPresetForUserAction,
  fetchAdminAssignablePresetsAction,
  fetchAdminUserWorkoutsAction
} from "@/lib/admin/adminDataActions";
import { supabase } from "@/lib/supabaseClient";

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
};
type PresetExerciseDraft = {
  name: string;
  targetMode: "reps" | "time";
  targetReps: number;
  setCount: number;
  increment: number;
  unit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
};

const initialPresetExerciseDraft: PresetExerciseDraft = {
  name: "",
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
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
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

  const loadUserAdminData = useCallback(async (accessToken: string) => {
    const [workoutsRes, presetsRes] = await Promise.all([
      fetchAdminUserWorkoutsAction(userId, accessToken),
      fetchAdminAssignablePresetsAction(userId, accessToken)
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

    setRows(workoutsRes.data as WorkoutRow[]);
    setAssignablePresets(presetsRes.data as AssignablePreset[]);
    setSelectedPresetId((current) => {
      if (current && presetsRes.data.some((preset) => preset.id === current)) return current;
      return presetsRes.data[0]?.id ?? "";
    });
    setPhase("ready");
    return true;
  }, [userId]);

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
          <input
            type="text"
            value={presetExerciseDraft.name}
            onChange={(event) =>
              setPresetExerciseDraft((prev) => ({ ...prev, name: event.target.value }))
            }
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
            placeholder="Exercise name"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={presetExerciseDraft.targetMode}
              onChange={(event) =>
                setPresetExerciseDraft((prev) => ({
                  ...prev,
                  targetMode: event.target.value as "reps" | "time"
                }))
              }
              className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
            >
              <option value="reps">Target reps</option>
              <option value="time">Target time (seconds)</option>
            </select>
            <input
              type="number"
              min={1}
              value={presetExerciseDraft.targetReps}
              onChange={(event) =>
                setPresetExerciseDraft((prev) => ({ ...prev, targetReps: Number(event.target.value) }))
              }
              className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              aria-label={presetExerciseDraft.targetMode === "time" ? "Target time" : "Target reps"}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              type="number"
              min={1}
              value={presetExerciseDraft.setCount}
              onChange={(event) =>
                setPresetExerciseDraft((prev) => ({ ...prev, setCount: Number(event.target.value) }))
              }
              className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              aria-label="Set count"
            />
            <input
              type="number"
              min={0}
              step={0.5}
              value={presetExerciseDraft.increment}
              onChange={(event) =>
                setPresetExerciseDraft((prev) => ({ ...prev, increment: Number(event.target.value) }))
              }
              className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              aria-label="Increment"
            />
            <select
              value={presetExerciseDraft.unit}
              onChange={(event) =>
                setPresetExerciseDraft((prev) => ({ ...prev, unit: event.target.value as "lbs" | "kg" }))
              }
              className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              aria-label="Unit"
            >
              <option value="lbs">lbs</option>
              <option value="kg">kg</option>
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={presetExerciseDraft.trackRir}
                onChange={(event) =>
                  setPresetExerciseDraft((prev) => ({ ...prev, trackRir: event.target.checked }))
                }
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
              />
              {presetExerciseDraft.targetMode === "time" ? "Track TIR" : "Track RIR"}
            </label>
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={presetExerciseDraft.trackRpe}
                onChange={(event) =>
                  setPresetExerciseDraft((prev) => ({ ...prev, trackRpe: event.target.checked }))
                }
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
              />
              Track RPE
            </label>
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
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
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
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
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
                    name: exercise.name,
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
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Assign Workouts</h3>
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={
              isAssigning || !adminAccessToken || !selectedPresetId || !assignDate || assignablePresets.length === 0
            }
            onClick={async () => {
              if (!adminAccessToken || !selectedPresetId || !assignDate) return;
              const confirmed = window.confirm(
                "Assign this preset to the selected date for this user? Existing workouts on that date will be kept."
              );
              if (!confirmed) return;

              setIsAssigning(true);
              setAssignMessage(null);
              setAssignError(null);
              const assignRes = await assignAdminPresetToUserDateAction(
                userId,
                selectedPresetId,
                assignDate,
                adminAccessToken
              );
              if (!assignRes.ok) {
                setAssignError(assignRes.message);
                setIsAssigning(false);
                return;
              }

              setAssignMessage(
                `Assigned ${assignRes.data.assignedCount} workout(s) to this user for ${assignRes.data.date}.`
              );
              await loadUserAdminData(adminAccessToken);
              setIsAssigning(false);
            }}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAssigning ? "Assigning..." : "Assign to user"}
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

      <div className="space-y-8">
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
    </section>
  );
}
