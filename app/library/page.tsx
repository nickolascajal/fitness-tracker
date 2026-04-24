"use client";

import { FormEvent, type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useExercises, type WorkoutPreset } from "@/app/exercises-provider";
import { useWorkoutHistory } from "@/app/workout-history-provider";
import { EXERCISES_BY_LETTER } from "@/lib/exercises";
import { exerciseDuplicateKey } from "@/lib/exerciseNameKey";
import { createBackupSnapshot, restoreBackupSnapshot, validateBackupSnapshot } from "@/lib/storage";
import { supabase } from "@/lib/supabaseClient";

type LibraryTab = "used" | "created" | "presets";

type ExerciseForm = {
  name: string;
  targetReps: number;
  setCount: number;
  increment: number;
  unit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
};

type PresetBuilderStep = 1 | 2;
type PresetPanelMode = "list" | "create" | "edit";

const initialForm: ExerciseForm = {
  name: "",
  targetReps: 8,
  setCount: 3,
  increment: 5,
  unit: "lbs",
  trackRir: false,
  trackRpe: false
};

function allMasterNameSet(): Set<string> {
  const names = new Set<string>();
  for (const values of Object.values(EXERCISES_BY_LETTER)) {
    for (const exercise of values) names.add(exerciseDuplicateKey(exercise.name));
  }
  return names;
}

export default function LibraryPage() {
  const router = useRouter();
  const { exercises, presets, addExercise, addPreset, updatePreset, removePresets } = useExercises();
  const { historyByExerciseId } = useWorkoutHistory();
  const [authChecked, setAuthChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [tab, setTab] = useState<LibraryTab>("used");
  const [showCreateExercise, setShowCreateExercise] = useState(false);
  const [form, setForm] = useState<ExerciseForm>(initialForm);
  const [nameError, setNameError] = useState<string | null>(null);
  const [presetStep, setPresetStep] = useState<PresetBuilderStep>(1);
  const [presetPanelMode, setPresetPanelMode] = useState<PresetPanelMode>("list");
  const [presetName, setPresetName] = useState("");
  const [presetExerciseDraft, setPresetExerciseDraft] = useState<ExerciseForm>(initialForm);
  const [presetExercises, setPresetExercises] = useState<ExerciseForm[]>([]);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState("");
  const [editingPresetExercises, setEditingPresetExercises] = useState<ExerciseForm[]>([]);
  const [isEditingPresetAddExerciseOpen, setIsEditingPresetAddExerciseOpen] = useState(false);
  const [selectedEditExerciseIndex, setSelectedEditExerciseIndex] = useState<number | null>(null);
  const [presetSelectionMode, setPresetSelectionMode] = useState(false);
  const [presetSelectedExerciseIndexes, setPresetSelectedExerciseIndexes] = useState<Set<number>>(
    () => new Set()
  );
  const [presetListSelectionMode, setPresetListSelectionMode] = useState(false);
  const [presetListSelectedIds, setPresetListSelectedIds] = useState<Set<string>>(() => new Set());
  const [presetListDeleteConfirmOpen, setPresetListDeleteConfirmOpen] = useState(false);
  const backupImportInputRef = useRef<HTMLInputElement | null>(null);
  const [backupImportFileName, setBackupImportFileName] = useState("");
  const [backupImportCandidate, setBackupImportCandidate] = useState<unknown | null>(null);
  const [backupImportError, setBackupImportError] = useState<string | null>(null);
  const [backupImportConfirmOpen, setBackupImportConfirmOpen] = useState(false);
  const [backupImportBusy, setBackupImportBusy] = useState(false);
  const [dataBackupOpen, setDataBackupOpen] = useState(false);

  useEffect(() => {
    const guardRoute = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/auth");
        setAllowed(false);
        setAuthChecked(true);
        return;
      }

      setAllowed(true);
      setAuthChecked(true);
    };

    void guardRoute();
  }, [router]);

  const resetPresetBuilder = () => {
    setPresetPanelMode("list");
    setPresetStep(1);
    setPresetName("");
    setPresetExerciseDraft(initialForm);
    setPresetExercises([]);
    setEditingPresetId(null);
    setEditingPresetName("");
    setEditingPresetExercises([]);
    setSelectedEditExerciseIndex(null);
    setPresetSelectionMode(false);
    setPresetSelectedExerciseIndexes(new Set());
    setIsEditingPresetAddExerciseOpen(false);
    setPresetListSelectionMode(false);
    setPresetListSelectedIds(new Set());
    setPresetListDeleteConfirmOpen(false);
  };

  const toExerciseForm = (exercise: WorkoutPreset["exercises"][number]): ExerciseForm => ({
    name: exercise.name,
    targetReps: exercise.targetReps,
    setCount: exercise.setCount,
    increment: exercise.increment,
    unit: exercise.unit,
    trackRir: exercise.trackRir,
    trackRpe: exercise.trackRpe
  });

  const openPresetEditor = (preset: WorkoutPreset) => {
    setPresetPanelMode("edit");
    setEditingPresetId(preset.id);
    setEditingPresetName(preset.name);
    setEditingPresetExercises(preset.exercises.map(toExerciseForm));
    setSelectedEditExerciseIndex(preset.exercises.length > 0 ? 0 : null);
    setPresetSelectionMode(false);
    setPresetSelectedExerciseIndexes(new Set());
    setIsEditingPresetAddExerciseOpen(false);
  };

  const masterNamesLower = useMemo(() => allMasterNameSet(), []);

  const usedExercises = useMemo(() => {
    const rows: {
      id: string;
      name: string;
      setCount: number | null;
      targetReps: number | null;
      count: number;
      lastAt: string;
    }[] = [];
    for (const [exerciseId, entries] of Object.entries(historyByExerciseId)) {
      if (entries.length === 0) continue;
      const configured = exercises.find((e) => e.id === exerciseId);
      rows.push({
        id: exerciseId,
        name: configured?.name ?? entries[0]!.exerciseName,
        setCount: configured?.setCount ?? null,
        targetReps: configured?.targetReps ?? null,
        count: entries.length,
        lastAt: entries[0]!.submittedAt
      });
    }
    return rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [historyByExerciseId, exercises]);

  const createdExercises = useMemo(
    () => exercises.filter((e) => e.isUserCreated === true),
    [exercises]
  );

  const handleCreateExercise = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    if (masterNamesLower.has(exerciseDuplicateKey(name))) {
      setNameError("This exercise already exists.");
      return;
    }
    setNameError(null);
    addExercise({
      name,
      type: "weight",
      foundation: 0,
      targetReps: form.targetReps,
      setCount: form.setCount,
      increment: form.increment,
      unit: form.unit,
      trackRir: form.trackRir,
      trackRpe: form.trackRpe,
      isUserCreated: true
    });
    setForm(initialForm);
    setShowCreateExercise(false);
  };

  const handleAddPresetExercise = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const exerciseName = presetExerciseDraft.name.trim();
    if (!exerciseName) return;
    setPresetExercises((previous) => [
      ...previous,
      {
        ...presetExerciseDraft,
        name: exerciseName
      }
    ]);
    setPresetExerciseDraft((previous) => ({ ...initialForm, unit: previous.unit }));
  };

  const handleSavePreset = () => {
    const nextName = presetName.trim();
    if (!nextName || presetExercises.length === 0) return;
    addPreset({
      name: nextName,
      exercises: presetExercises.map((exercise) => ({
        name: exercise.name.trim(),
        targetReps: exercise.targetReps,
        setCount: exercise.setCount,
        increment: exercise.increment,
        unit: exercise.unit,
        trackRir: exercise.trackRir,
        trackRpe: exercise.trackRpe
      }))
    });
    resetPresetBuilder();
  };

  const handleSaveEditedPreset = () => {
    if (!editingPresetId) return;
    const nextName = editingPresetName.trim();
    if (!nextName || editingPresetExercises.length === 0) return;
    // Preset updates are local to the preset draft and only committed here.
    updatePreset(editingPresetId, (preset) => ({
      ...preset,
      name: nextName,
      exercises: editingPresetExercises.map((exercise) => ({
        name: exercise.name.trim(),
        targetReps: exercise.targetReps,
        setCount: exercise.setCount,
        increment: exercise.increment,
        unit: exercise.unit,
        trackRir: exercise.trackRir,
        trackRpe: exercise.trackRpe
      }))
    }));
    resetPresetBuilder();
  };

  const updateEditingExercise = (index: number, updater: (exercise: ExerciseForm) => ExerciseForm) => {
    setEditingPresetExercises((previous) =>
      previous.map((exercise, i) => (i === index ? updater(exercise) : exercise))
    );
  };

  const removeSelectedPresetExercises = () => {
    if (presetSelectedExerciseIndexes.size === 0) return;
    setEditingPresetExercises((previous) =>
      previous.filter((_, index) => !presetSelectedExerciseIndexes.has(index))
    );
    setSelectedEditExerciseIndex((previous) => {
      if (previous === null) return null;
      if (presetSelectedExerciseIndexes.has(previous)) return null;
      return previous;
    });
    setPresetSelectedExerciseIndexes(new Set());
    setPresetSelectionMode(false);
  };

  const handleAddExerciseToEditingPreset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const exerciseName = presetExerciseDraft.name.trim();
    if (!exerciseName) return;
    setEditingPresetExercises((previous) => [
      ...previous,
      {
        ...presetExerciseDraft,
        name: exerciseName
      }
    ]);
    setPresetExerciseDraft((previous) => ({ ...initialForm, unit: previous.unit }));
    setIsEditingPresetAddExerciseOpen(false);
  };

  const exitPresetListSelectionMode = () => {
    setPresetListSelectionMode(false);
    setPresetListSelectedIds(new Set());
    setPresetListDeleteConfirmOpen(false);
  };

  const handleTogglePresetListSelection = (presetId: string, checked: boolean) => {
    setPresetListSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(presetId);
      else next.delete(presetId);
      return next;
    });
  };

  const handleConfirmDeleteSelectedPresets = () => {
    const ids = Array.from(presetListSelectedIds);
    if (ids.length === 0) return;
    removePresets(ids);
    setPresetListSelectedIds((previous) => {
      const remaining = new Set(Array.from(previous).filter((id) => !ids.includes(id)));
      if (remaining.size === 0) {
        setPresetListSelectionMode(false);
      }
      return remaining;
    });
    setPresetListDeleteConfirmOpen(false);
  };

  const handleExportBackup = () => {
    const snapshot = createBackupSnapshot();
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const dateLabel = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = href;
    a.download = `fitness-tracker-backup-${dateLabel}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(href);
  };

  const handleImportFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setBackupImportError(null);
    setBackupImportConfirmOpen(false);
    setBackupImportCandidate(null);
    setBackupImportFileName(file?.name ?? "");
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as unknown;
      const validation = validateBackupSnapshot(parsed);
      if (!validation.valid) {
        setBackupImportError(validation.reason ?? "Invalid backup file.");
        return;
      }
      setBackupImportCandidate(parsed);
      setBackupImportConfirmOpen(true);
    } catch {
      setBackupImportError("Unable to read this file. Please choose a valid JSON backup.");
    } finally {
      if (event.target) event.target.value = "";
    }
  };

  const handleConfirmImportBackup = () => {
    if (!backupImportCandidate) return;
    setBackupImportBusy(true);
    const restored = restoreBackupSnapshot(backupImportCandidate);
    if (!restored.ok) {
      setBackupImportBusy(false);
      setBackupImportError(restored.reason ?? "Backup import failed.");
      setBackupImportConfirmOpen(false);
      return;
    }
    window.location.reload();
  };

  if (!authChecked || !allowed) {
    return null;
  }

  return (
    <section className="space-y-5 pt-1 md:pt-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Your Library</h1>

      <div className="flex w-full gap-2">
        <button
          type="button"
          onClick={() => setTab("used")}
          className={`flex-1 min-w-0 truncate rounded-md px-2 py-1.5 text-center text-sm transition-transform active:scale-95 md:px-4 md:py-2 md:text-base ${
            tab === "used"
              ? "bg-slate-900 font-semibold text-white"
              : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Used Exercises
        </button>
        <button
          type="button"
          onClick={() => setTab("created")}
          className={`flex-1 min-w-0 truncate rounded-md px-2 py-1.5 text-center text-sm transition-transform active:scale-95 md:px-4 md:py-2 md:text-base ${
            tab === "created"
              ? "bg-slate-900 font-semibold text-white"
              : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Created Exercises
        </button>
        <button
          type="button"
          onClick={() => setTab("presets")}
          className={`flex-1 min-w-0 truncate rounded-md px-2 py-1.5 text-center text-sm transition-transform active:scale-95 md:px-4 md:py-2 md:text-base ${
            tab === "presets"
              ? "bg-slate-900 font-semibold text-white"
              : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <span className="md:hidden">Saved Workouts</span>
          <span className="hidden md:inline">Saved Workout Presets</span>
        </button>
      </div>

      {tab === "used" ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Used Exercises</h2>
          {usedExercises.length === 0 ? (
            <p className="text-sm text-slate-600">No exercises used yet. Log a workout to populate this list.</p>
          ) : (
            <ul className="space-y-2">
              {usedExercises.map((exercise) => (
                <li key={exercise.id} className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm">
                  <p className="font-medium text-slate-900">{exercise.name}</p>
                  <p className="text-slate-600">
                    {exercise.setCount && exercise.targetReps
                      ? `${exercise.setCount} sets x ${exercise.targetReps} reps`
                      : "Config unavailable"}{" "}
                    · {exercise.count} logged session{exercise.count === 1 ? "" : "s"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "created" ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Created Exercises</h2>
            <button
              type="button"
              onClick={() => {
                setNameError(null);
                setShowCreateExercise((v) => !v);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Create New Exercise
            </button>
          </div>
          {createdExercises.length === 0 ? (
            <p className="text-sm text-slate-600">No manually created exercises yet.</p>
          ) : (
            <ul className="space-y-2">
              {createdExercises.map((exercise) => (
                <li key={exercise.id} className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm">
                  <p className="font-medium text-slate-900">{exercise.name}</p>
                  <p className="text-slate-600">
                    {exercise.setCount} sets x {exercise.targetReps} reps · +{exercise.increment}{" "}
                    {exercise.unit}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {showCreateExercise ? (
            <form onSubmit={handleCreateExercise} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Exercise name</span>
                <input
                  value={form.name}
                  onChange={(e) => {
                    setNameError(null);
                    setForm((prev) => ({ ...prev, name: e.target.value }));
                  }}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                  placeholder="e.g. Cable Lateral Raise"
                />
              </label>
              {nameError ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {nameError}
                </p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-4">
                <input
                  type="number"
                  min={1}
                  value={form.setCount}
                  onChange={(e) => setForm((prev) => ({ ...prev, setCount: Number(e.target.value) }))}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                  aria-label="Set count"
                />
                <input
                  type="number"
                  min={1}
                  value={form.targetReps}
                  onChange={(e) => setForm((prev) => ({ ...prev, targetReps: Number(e.target.value) }))}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                  aria-label="Target reps"
                />
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={form.increment}
                  onChange={(e) => setForm((prev) => ({ ...prev, increment: Number(e.target.value) }))}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                  aria-label="Increment"
                />
                <select
                  value={form.unit}
                  onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value as "lbs" | "kg" }))}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                  aria-label="Unit"
                >
                  <option value="lbs">lbs</option>
                  <option value="kg">kg</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Save Exercise
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateExercise(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {tab === "presets" ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          {presetPanelMode === "list" ? (
            <>
              <div className="flex flex-col gap-2 min-[400px]:flex-row min-[400px]:items-center min-[400px]:justify-between">
                <h2 className="shrink-0 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Saved Workout Presets
                </h2>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPresetPanelMode("create");
                      setPresetStep(1);
                    }}
                    className="w-full shrink-0 self-start rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 min-[400px]:w-auto hover:bg-slate-50"
                  >
                    Create New Preset
                  </button>
                  {presets.length > 0 && !presetListSelectionMode ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPresetListSelectionMode(true);
                        setPresetListSelectedIds(new Set());
                        setPresetListDeleteConfirmOpen(false);
                      }}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                    >
                      Select
                    </button>
                  ) : null}
                  {presets.length > 0 && presetListSelectionMode ? (
                    <>
                      <button
                        type="button"
                        disabled={presetListSelectedIds.size === 0}
                        onClick={() => {
                          if (presetListSelectedIds.size > 0) {
                            setPresetListDeleteConfirmOpen(true);
                          }
                        }}
                        className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-900 enabled:hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Delete permanently
                      </button>
                      <button
                        type="button"
                        onClick={exitPresetListSelectionMode}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              {presetListDeleteConfirmOpen && presetListSelectionMode ? (
                <div className="rounded-md border border-rose-200 bg-rose-50/90 px-3 py-3 text-sm text-rose-950">
                  <p>Delete the selected preset(s)? This cannot be undone.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleConfirmDeleteSelectedPresets}
                      className="rounded-md bg-rose-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-900"
                    >
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setPresetListDeleteConfirmOpen(false)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      No, keep
                    </button>
                  </div>
                </div>
              ) : null}
              {presets.length === 0 ? (
                <p className="text-sm text-slate-600">No presets yet. Create one to reuse multi-exercise workouts.</p>
              ) : (
                <ul className="space-y-2">
                  {presets.map((preset) => (
                    <li key={preset.id}>
                      <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2">
                        {presetListSelectionMode ? (
                          <label className="mt-0.5 flex items-center">
                            <span className="sr-only">Select {preset.name}</span>
                            <input
                              type="checkbox"
                              checked={presetListSelectedIds.has(preset.id)}
                              onChange={(event) =>
                                handleTogglePresetListSelection(preset.id, event.target.checked)
                              }
                              aria-label={`Select ${preset.name}`}
                              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                            />
                          </label>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            if (presetListSelectionMode) {
                              handleTogglePresetListSelection(
                                preset.id,
                                !presetListSelectedIds.has(preset.id)
                              );
                              return;
                            }
                            openPresetEditor(preset);
                          }}
                          className="w-full text-left text-sm"
                        >
                          <p className="font-medium text-slate-900">{preset.name}</p>
                          <p className="text-slate-600">
                            {preset.exercises.length} exercise{preset.exercises.length === 1 ? "" : "s"}
                          </p>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : presetPanelMode === "create" ? (
            <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Create Preset {presetStep === 1 ? "Step 1 of 2" : "Step 2 of 2"}
                </h3>
                <button
                  type="button"
                  onClick={resetPresetBuilder}
                  className="text-xs font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                >
                  Back to Library
                </button>
              </div>

              {presetStep === 1 ? (
                <div className="space-y-3">
                  <label className="block space-y-1">
                    <span className="text-sm font-medium text-slate-700">Preset name</span>
                    <input
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                      placeholder="e.g. Push Day A"
                    />
                  </label>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={presetName.trim() === ""}
                      onClick={() => setPresetStep(2)}
                      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <form onSubmit={handleAddPresetExercise} className="space-y-3">
                    <label className="block space-y-1">
                      <span className="text-sm font-medium text-slate-700">Exercise name</span>
                      <input
                        value={presetExerciseDraft.name}
                        onChange={(e) =>
                          setPresetExerciseDraft((prev) => ({ ...prev, name: e.target.value }))
                        }
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        placeholder="e.g. Incline Bench Press"
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-4">
                      <input
                        type="number"
                        min={1}
                        value={presetExerciseDraft.setCount}
                        onChange={(e) =>
                          setPresetExerciseDraft((prev) => ({ ...prev, setCount: Number(e.target.value) }))
                        }
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        aria-label="Set count"
                      />
                      <input
                        type="number"
                        min={1}
                        value={presetExerciseDraft.targetReps}
                        onChange={(e) =>
                          setPresetExerciseDraft((prev) => ({ ...prev, targetReps: Number(e.target.value) }))
                        }
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        aria-label="Target reps"
                      />
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={presetExerciseDraft.increment}
                        onChange={(e) =>
                          setPresetExerciseDraft((prev) => ({ ...prev, increment: Number(e.target.value) }))
                        }
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        aria-label="Increment"
                      />
                      <select
                        value={presetExerciseDraft.unit}
                        onChange={(e) =>
                          setPresetExerciseDraft((prev) => ({ ...prev, unit: e.target.value as "lbs" | "kg" }))
                        }
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        aria-label="Unit"
                      >
                        <option value="lbs">lbs</option>
                        <option value="kg">kg</option>
                      </select>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                        <input
                          type="checkbox"
                          checked={presetExerciseDraft.trackRir}
                          onChange={(e) =>
                            setPresetExerciseDraft((prev) => ({ ...prev, trackRir: e.target.checked }))
                          }
                          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                        />
                        <span className="text-sm text-slate-700">Track RIR</span>
                      </label>
                      <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                        <input
                          type="checkbox"
                          checked={presetExerciseDraft.trackRpe}
                          onChange={(e) =>
                            setPresetExerciseDraft((prev) => ({ ...prev, trackRpe: e.target.checked }))
                          }
                          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                        />
                        <span className="text-sm text-slate-700">Track RPE</span>
                      </label>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Add Exercise
                      </button>
                    </div>
                  </form>

                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preset exercises</p>
                    {presetExercises.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-600">No exercises added yet.</p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {presetExercises.map((exercise, index) => (
                          <li key={`${exercise.name}-${index}`} className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm">
                            <p className="font-medium text-slate-900">{exercise.name}</p>
                            <p className="text-slate-600">
                              {exercise.setCount} sets x {exercise.targetReps} reps · +{exercise.increment} {exercise.unit} · RIR: {exercise.trackRir ? "Y" : "N"} · RPE: {exercise.trackRpe ? "Y" : "N"}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex flex-wrap justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setPresetStep(1)}
                      className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={presetName.trim() === "" || presetExercises.length === 0}
                      onClick={handleSavePreset}
                      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Save Preset
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Edit Preset</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={resetPresetBuilder}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={editingPresetName.trim() === "" || editingPresetExercises.length === 0}
                    onClick={handleSaveEditedPreset}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </div>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Preset name</span>
                <input
                  value={editingPresetName}
                  onChange={(e) => setEditingPresetName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                />
              </label>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preset exercises</p>
                  {!presetSelectionMode ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPresetExerciseDraft(initialForm);
                          setIsEditingPresetAddExerciseOpen((previous) => !previous);
                        }}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Add Exercise
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPresetSelectionMode(true);
                          setPresetSelectedExerciseIndexes(new Set());
                        }}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Select
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={presetSelectedExerciseIndexes.size === 0}
                        onClick={removeSelectedPresetExercises}
                        className="rounded-md border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-900 enabled:hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Delete selected
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPresetSelectionMode(false);
                          setPresetSelectedExerciseIndexes(new Set());
                        }}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                {isEditingPresetAddExerciseOpen ? (
                  <form onSubmit={handleAddExerciseToEditingPreset} className="mt-3 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <label className="block space-y-1">
                      <span className="text-sm font-medium text-slate-700">Exercise name</span>
                      <input
                        value={presetExerciseDraft.name}
                        onChange={(e) =>
                          setPresetExerciseDraft((prev) => ({ ...prev, name: e.target.value }))
                        }
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        placeholder="e.g. Incline Bench Press"
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-4">
                      <input
                        type="number"
                        min={1}
                        value={presetExerciseDraft.setCount}
                        onChange={(e) =>
                          setPresetExerciseDraft((prev) => ({ ...prev, setCount: Number(e.target.value) }))
                        }
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        aria-label="Set count"
                      />
                      <input
                        type="number"
                        min={1}
                        value={presetExerciseDraft.targetReps}
                        onChange={(e) =>
                          setPresetExerciseDraft((prev) => ({ ...prev, targetReps: Number(e.target.value) }))
                        }
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        aria-label="Target reps"
                      />
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={presetExerciseDraft.increment}
                        onChange={(e) =>
                          setPresetExerciseDraft((prev) => ({ ...prev, increment: Number(e.target.value) }))
                        }
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        aria-label="Increment"
                      />
                      <select
                        value={presetExerciseDraft.unit}
                        onChange={(e) =>
                          setPresetExerciseDraft((prev) => ({ ...prev, unit: e.target.value as "lbs" | "kg" }))
                        }
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        aria-label="Unit"
                      >
                        <option value="lbs">lbs</option>
                        <option value="kg">kg</option>
                      </select>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                        <input
                          type="checkbox"
                          checked={presetExerciseDraft.trackRir}
                          onChange={(e) =>
                            setPresetExerciseDraft((prev) => ({ ...prev, trackRir: e.target.checked }))
                          }
                          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                        />
                        <span className="text-sm text-slate-700">Track RIR</span>
                      </label>
                      <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                        <input
                          type="checkbox"
                          checked={presetExerciseDraft.trackRpe}
                          onChange={(e) =>
                            setPresetExerciseDraft((prev) => ({ ...prev, trackRpe: e.target.checked }))
                          }
                          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                        />
                        <span className="text-sm text-slate-700">Track RPE</span>
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingPresetAddExerciseOpen(false)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}
                {editingPresetExercises.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">No exercises in this preset.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {editingPresetExercises.map((exercise, index) => (
                      <li key={`${exercise.name}-${index}`}>
                        <button
                          type="button"
                          onClick={() => {
                            if (presetSelectionMode) {
                              setPresetSelectedExerciseIndexes((previous) => {
                                const next = new Set(previous);
                                if (next.has(index)) next.delete(index);
                                else next.add(index);
                                return next;
                              });
                              return;
                            }
                            setSelectedEditExerciseIndex(index);
                          }}
                          className={`w-full rounded-md border px-2.5 py-2 text-left text-sm ${
                            selectedEditExerciseIndex === index
                              ? "border-slate-400 bg-slate-100"
                              : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                          }`}
                        >
                          <p className="font-medium text-slate-900">{exercise.name}</p>
                          <p className="text-slate-600">
                            {exercise.setCount} sets x {exercise.targetReps} reps · +{exercise.increment} {exercise.unit} · RIR: {exercise.trackRir ? "Y" : "N"} · RPE: {exercise.trackRpe ? "Y" : "N"}
                          </p>
                          {presetSelectionMode ? (
                            <p className="mt-1 text-xs text-slate-500">
                              {presetSelectedExerciseIndexes.has(index) ? "Selected" : "Tap to select"}
                            </p>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {selectedEditExerciseIndex !== null &&
              editingPresetExercises[selectedEditExerciseIndex] ? (
                <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Edit selected exercise config
                  </p>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <input
                      type="number"
                      min={1}
                      value={editingPresetExercises[selectedEditExerciseIndex].setCount}
                      onChange={(e) =>
                        updateEditingExercise(selectedEditExerciseIndex, (prev) => ({
                          ...prev,
                          setCount: Number(e.target.value)
                        }))
                      }
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                      aria-label="Edit set count"
                    />
                    <input
                      type="number"
                      min={1}
                      value={editingPresetExercises[selectedEditExerciseIndex].targetReps}
                      onChange={(e) =>
                        updateEditingExercise(selectedEditExerciseIndex, (prev) => ({
                          ...prev,
                          targetReps: Number(e.target.value)
                        }))
                      }
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                      aria-label="Edit target reps"
                    />
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={editingPresetExercises[selectedEditExerciseIndex].increment}
                      onChange={(e) =>
                        updateEditingExercise(selectedEditExerciseIndex, (prev) => ({
                          ...prev,
                          increment: Number(e.target.value)
                        }))
                      }
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                      aria-label="Edit increment"
                    />
                    <select
                      value={editingPresetExercises[selectedEditExerciseIndex].unit}
                      onChange={(e) =>
                        updateEditingExercise(selectedEditExerciseIndex, (prev) => ({
                          ...prev,
                          unit: e.target.value as "lbs" | "kg"
                        }))
                      }
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                      aria-label="Edit unit"
                    >
                      <option value="lbs">lbs</option>
                      <option value="kg">kg</option>
                    </select>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                      <input
                        type="checkbox"
                        checked={editingPresetExercises[selectedEditExerciseIndex].trackRir}
                        onChange={(e) =>
                          updateEditingExercise(selectedEditExerciseIndex, (prev) => ({
                            ...prev,
                            trackRir: e.target.checked
                          }))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                      />
                      <span className="text-sm text-slate-700">Track RIR</span>
                    </label>
                    <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                      <input
                        type="checkbox"
                        checked={editingPresetExercises[selectedEditExerciseIndex].trackRpe}
                        onChange={(e) =>
                          updateEditingExercise(selectedEditExerciseIndex, (prev) => ({
                            ...prev,
                            trackRpe: e.target.checked
                          }))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                      />
                      <span className="text-sm text-slate-700">Track RPE</span>
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setDataBackupOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-slate-500 transition-colors hover:bg-slate-50/80"
          aria-expanded={dataBackupOpen}
        >
          <span>Data Backup</span>
          <span className="shrink-0 text-slate-400 tabular-nums" aria-hidden>
            {dataBackupOpen ? "−" : "+"}
          </span>
        </button>
        {dataBackupOpen ? (
        <div className="space-y-3 border-t border-slate-200 p-4 pt-3">
          <p className="text-sm text-slate-600">
            Export a local JSON backup before migrating devices/cloud, or import a backup to restore
            all local fitness data.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExportBackup}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Export Data
            </button>
            <button
              type="button"
              onClick={() => backupImportInputRef.current?.click()}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Import Data
            </button>
            <input
              ref={backupImportInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFileChosen}
              className="hidden"
            />
          </div>
          {backupImportFileName ? (
            <p className="text-xs text-slate-500">Selected file: {backupImportFileName}</p>
          ) : null}
          {backupImportError ? (
            <p className="rounded-md border border-rose-200 bg-rose-50/90 px-3 py-2 text-sm text-rose-900">
              {backupImportError}
            </p>
          ) : null}
          {backupImportConfirmOpen ? (
            <div className="rounded-md border border-rose-200 bg-rose-50/90 px-3 py-3 text-sm text-rose-950">
              <p>Import this backup and overwrite existing local data? This cannot be undone.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={backupImportBusy}
                  onClick={handleConfirmImportBackup}
                  className="rounded-md bg-rose-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Yes, import
                </button>
                <button
                  type="button"
                  disabled={backupImportBusy}
                  onClick={() => setBackupImportConfirmOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  No, keep current data
                </button>
              </div>
            </div>
          ) : null}
        </div>
        ) : null}
      </div>
    </section>
  );
}

