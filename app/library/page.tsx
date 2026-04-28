"use client";

import { FormEvent, type ChangeEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useExercises, type WorkoutPreset } from "@/app/exercises-provider";
import { useWorkoutHistory } from "@/app/workout-history-provider";
import { EXERCISES_BY_LETTER } from "@/lib/exercises";
import { exerciseDuplicateKey } from "@/lib/exerciseNameKey";
import { createBackupSnapshot, restoreBackupSnapshot, validateBackupSnapshot } from "@/lib/storage";
import { supabase } from "@/lib/supabaseClient";
import { ActionButton, actionButtonClass, actionButtonClasses } from "@/components/action-button";
import {
  EXERCISE_CONFIG_HELP,
  FieldLabelHelp,
  TrackCheckboxRow
} from "@/components/help-tooltip";

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

const USED_GUIDE_KEY = "hasSeenUsedExercisesGuide";
const CREATED_GUIDE_KEY = "hasCompletedCreatedExercisesGuide";
const PRESETS_GUIDE_KEY = "hasCompletedPresetsGuide";

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

function LibraryGuideCallout({
  copy,
  onSkip,
  onGotIt
}: {
  copy: string;
  onSkip: () => void;
  onGotIt?: () => void;
}) {
  return (
    <div className="relative rounded-lg border border-sky-300 bg-sky-50/95 p-3 text-left shadow-[0_10px_24px_-14px_rgba(2,132,199,0.65)]">
      <span
        aria-hidden
        className="absolute -top-1.5 left-8 h-3 w-3 rotate-45 border-l border-t border-sky-300 bg-sky-50/95"
      />
      <p className="text-xs font-medium text-slate-800">{copy}</p>
      <div className="mt-2 flex items-center gap-2">
        {onGotIt ? (
          <ActionButton type="button" variant="primarySm" onClick={onGotIt}>
            Got it
          </ActionButton>
        ) : null}
        <button
          type="button"
          onClick={onSkip}
          className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:text-slate-800"
        >
          Skip guide
        </button>
      </div>
    </div>
  );
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
  const [presetExerciseSearchQuery, setPresetExerciseSearchQuery] = useState("");
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
  const [isLibraryGuideReady, setIsLibraryGuideReady] = useState(false);
  const [hasSeenUsedExercisesGuide, setHasSeenUsedExercisesGuide] = useState(false);
  const [hasCompletedCreatedExercisesGuide, setHasCompletedCreatedExercisesGuide] = useState(false);
  const [hasCompletedPresetsGuide, setHasCompletedPresetsGuide] = useState(false);

  const createdExerciseCfgId = useId();
  const presetCreateCfgId = useId();
  const presetEditAddCfgId = useId();
  const presetEditSelectedCfgId = useId();

  useEffect(() => {
    const guardRoute = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/");
        setAllowed(false);
        setAuthChecked(true);
        return;
      }

      setAllowed(true);
      setAuthChecked(true);
    };

    void guardRoute();
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setHasSeenUsedExercisesGuide(window.localStorage.getItem(USED_GUIDE_KEY) === "true");
    setHasCompletedCreatedExercisesGuide(window.localStorage.getItem(CREATED_GUIDE_KEY) === "true");
    setHasCompletedPresetsGuide(window.localStorage.getItem(PRESETS_GUIDE_KEY) === "true");
    setIsLibraryGuideReady(true);
  }, []);

  const resetPresetBuilder = () => {
    setPresetPanelMode("list");
    setPresetStep(1);
    setPresetName("");
    setPresetExerciseDraft(initialForm);
    setPresetExerciseSearchQuery("");
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
  const masterExerciseNames = useMemo(
    () =>
      Object.values(EXERCISES_BY_LETTER)
        .flatMap((entries) => entries.map((entry) => entry.name))
        .sort((a, b) => a.localeCompare(b)),
    []
  );
  const filteredPresetMasterNames = useMemo(() => {
    const query = presetExerciseSearchQuery.trim().toLowerCase();
    if (!query) return masterExerciseNames.slice(0, 12);
    return masterExerciseNames.filter((name) => name.toLowerCase().includes(query)).slice(0, 12);
  }, [masterExerciseNames, presetExerciseSearchQuery]);

  const presetCreateQueryTrim = presetExerciseSearchQuery.trim();
  const presetCreateDraftNameTrim = presetExerciseDraft.name.trim();

  /** Offer “Use as new exercise name” only while the search still diverges from a locked-in custom choice (or nothing chosen yet). */
  const showPresetCreateUseCustomNameButton = useMemo(() => {
    if (!presetCreateQueryTrim) return false;
    if (masterNamesLower.has(exerciseDuplicateKey(presetCreateQueryTrim))) return false;
    return (
      presetCreateDraftNameTrim !== presetCreateQueryTrim || presetCreateDraftNameTrim === ""
    );
  }, [masterNamesLower, presetCreateQueryTrim, presetCreateDraftNameTrim]);

  /** Custom name matches search and is not on the master list — hide the action button and show confirmation UI. */
  const isPresetCreateCustomNameConfirmed = useMemo(() => {
    if (!presetCreateDraftNameTrim) return false;
    if (masterNamesLower.has(exerciseDuplicateKey(presetCreateDraftNameTrim))) return false;
    return presetCreateDraftNameTrim === presetCreateQueryTrim;
  }, [masterNamesLower, presetCreateDraftNameTrim, presetCreateQueryTrim]);

  const completeUsedExercisesGuide = () => {
    setHasSeenUsedExercisesGuide(true);
    try {
      window.localStorage.setItem(USED_GUIDE_KEY, "true");
    } catch {
      // ignore storage restrictions
    }
  };

  const completeCreatedExercisesGuide = () => {
    setHasCompletedCreatedExercisesGuide(true);
    try {
      window.localStorage.setItem(CREATED_GUIDE_KEY, "true");
    } catch {
      // ignore storage restrictions
    }
  };

  const completePresetsGuide = () => {
    setHasCompletedPresetsGuide(true);
    try {
      window.localStorage.setItem(PRESETS_GUIDE_KEY, "true");
    } catch {
      // ignore storage restrictions
    }
  };

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
    completeCreatedExercisesGuide();
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
    setPresetExerciseSearchQuery("");
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
    completePresetsGuide();
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
          {isLibraryGuideReady && !hasSeenUsedExercisesGuide ? (
            <LibraryGuideCallout
              copy="Used Exercises shows exercises you’ve already logged. Open one to review its history and progress."
              onGotIt={completeUsedExercisesGuide}
              onSkip={completeUsedExercisesGuide}
            />
          ) : null}
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
              className={actionButtonClasses.primary}
            >
              Create New Exercise
            </button>
          </div>
          {isLibraryGuideReady && !hasCompletedCreatedExercisesGuide ? (
            <LibraryGuideCallout
              copy="Created Exercises is where you can save custom exercise setups with your own sets, reps, increments, and tracking options."
              onSkip={completeCreatedExercisesGuide}
            />
          ) : null}
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
                <div className="space-y-1">
                  <FieldLabelHelp
                    htmlFor={`${createdExerciseCfgId}-sets`}
                    label="Sets"
                    helpText={EXERCISE_CONFIG_HELP.sets}
                  />
                  <input
                    id={`${createdExerciseCfgId}-sets`}
                    type="number"
                    min={1}
                    value={form.setCount}
                    onChange={(e) => setForm((prev) => ({ ...prev, setCount: Number(e.target.value) }))}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabelHelp
                    htmlFor={`${createdExerciseCfgId}-target`}
                    label="Target reps"
                    helpText={EXERCISE_CONFIG_HELP.targetReps}
                  />
                  <input
                    id={`${createdExerciseCfgId}-target`}
                    type="number"
                    min={1}
                    value={form.targetReps}
                    onChange={(e) => setForm((prev) => ({ ...prev, targetReps: Number(e.target.value) }))}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabelHelp
                    htmlFor={`${createdExerciseCfgId}-increment`}
                    label="Increment"
                    helpText={EXERCISE_CONFIG_HELP.increment}
                  />
                  <input
                    id={`${createdExerciseCfgId}-increment`}
                    type="number"
                    min={0}
                    step={0.5}
                    value={form.increment}
                    onChange={(e) => setForm((prev) => ({ ...prev, increment: Number(e.target.value) }))}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabelHelp
                    htmlFor={`${createdExerciseCfgId}-unit`}
                    label="Unit"
                    helpText={EXERCISE_CONFIG_HELP.unit}
                  />
                  <select
                    id={`${createdExerciseCfgId}-unit`}
                    value={form.unit}
                    onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value as "lbs" | "kg" }))}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                  >
                    <option value="lbs">lbs</option>
                    <option value="kg">kg</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className={actionButtonClasses.primary}>
                  Save Exercise
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateExercise(false)}
                  className={actionButtonClasses.secondary}
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
          {isLibraryGuideReady && !hasCompletedPresetsGuide ? (
            <LibraryGuideCallout
              copy="Saved Workout Presets lets you build reusable workout templates so you can add multiple exercises to a day faster."
              onSkip={completePresetsGuide}
            />
          ) : null}
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
                    className={actionButtonClass(
                      "primary",
                      "w-full shrink-0 self-start min-[400px]:w-auto"
                    )}
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
                      className={actionButtonClasses.secondary}
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
                        className={actionButtonClasses.destructive}
                      >
                        Delete permanently
                      </button>
                      <button
                        type="button"
                        onClick={exitPresetListSelectionMode}
                        className={actionButtonClasses.secondary}
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
                      className={actionButtonClasses.destructiveSolid}
                    >
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setPresetListDeleteConfirmOpen(false)}
                      className={actionButtonClasses.secondary}
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
                <button type="button" onClick={resetPresetBuilder} className={actionButtonClasses.secondarySm}>
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
                      className={actionButtonClass("primary", "disabled:cursor-not-allowed")}
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <form onSubmit={handleAddPresetExercise} className="space-y-3">
                    <label className="block space-y-1">
                      <span className="text-sm font-medium text-slate-700">Find exercise</span>
                      <input
                        value={presetExerciseSearchQuery}
                        onChange={(e) => setPresetExerciseSearchQuery(e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        placeholder="Search master exercises..."
                      />
                    </label>
                    <div className="rounded-md border border-slate-200 bg-white p-2">
                      {filteredPresetMasterNames.length > 0 ? (
                        <ul className="max-h-36 space-y-1 overflow-y-auto">
                          {filteredPresetMasterNames.map((name) => (
                            <li key={`preset-master-${name}`}>
                              <button
                                type="button"
                                onClick={() => {
                                  setPresetExerciseDraft((prev) => ({ ...prev, name }));
                                  setPresetExerciseSearchQuery(name);
                                }}
                                className={`w-full rounded px-2 py-1.5 text-left text-sm ${
                                  presetExerciseDraft.name === name
                                    ? "bg-slate-100 font-medium text-slate-900"
                                    : "text-slate-700 hover:bg-slate-50"
                                }`}
                              >
                                {name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-600">No matching master exercise.</p>
                      )}
                      {showPresetCreateUseCustomNameButton ? (
                        <button
                          type="button"
                          onClick={() =>
                            setPresetExerciseDraft((prev) => ({
                              ...prev,
                              name: presetExerciseSearchQuery.trim()
                            }))
                          }
                          className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Use &quot;{presetExerciseSearchQuery.trim()}&quot; as a new exercise name
                        </button>
                      ) : null}
                      {isPresetCreateCustomNameConfirmed ? (
                        <p
                          className="mt-2 flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50/95 px-2.5 py-2 text-xs font-medium text-emerald-950"
                          role="status"
                        >
                          <span className="text-emerald-600" aria-hidden>
                            ✓
                          </span>
                          <span>
                            Selected custom exercise:{" "}
                            <span className="font-semibold">{presetCreateDraftNameTrim}</span>
                          </span>
                        </p>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-600">
                      Selected exercise:{" "}
                      <span className="font-medium text-slate-800">
                        {presetExerciseDraft.name.trim() || "None selected yet"}
                      </span>
                      {isPresetCreateCustomNameConfirmed ? (
                        <span className="ml-2 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-900">
                          Custom
                        </span>
                      ) : null}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-4">
                      <div className="space-y-1">
                        <FieldLabelHelp
                          htmlFor={`${presetCreateCfgId}-sets`}
                          label="Sets"
                          helpText={EXERCISE_CONFIG_HELP.sets}
                        />
                        <input
                          id={`${presetCreateCfgId}-sets`}
                          type="number"
                          min={1}
                          value={presetExerciseDraft.setCount}
                          onChange={(e) =>
                            setPresetExerciseDraft((prev) => ({ ...prev, setCount: Number(e.target.value) }))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        />
                      </div>
                      <div className="space-y-1">
                        <FieldLabelHelp
                          htmlFor={`${presetCreateCfgId}-target`}
                          label="Target reps"
                          helpText={EXERCISE_CONFIG_HELP.targetReps}
                        />
                        <input
                          id={`${presetCreateCfgId}-target`}
                          type="number"
                          min={1}
                          value={presetExerciseDraft.targetReps}
                          onChange={(e) =>
                            setPresetExerciseDraft((prev) => ({ ...prev, targetReps: Number(e.target.value) }))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        />
                      </div>
                      <div className="space-y-1">
                        <FieldLabelHelp
                          htmlFor={`${presetCreateCfgId}-increment`}
                          label="Increment"
                          helpText={EXERCISE_CONFIG_HELP.increment}
                        />
                        <input
                          id={`${presetCreateCfgId}-increment`}
                          type="number"
                          min={0}
                          step={0.5}
                          value={presetExerciseDraft.increment}
                          onChange={(e) =>
                            setPresetExerciseDraft((prev) => ({ ...prev, increment: Number(e.target.value) }))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        />
                      </div>
                      <div className="space-y-1">
                        <FieldLabelHelp
                          htmlFor={`${presetCreateCfgId}-unit`}
                          label="Unit"
                          helpText={EXERCISE_CONFIG_HELP.unit}
                        />
                        <select
                          id={`${presetCreateCfgId}-unit`}
                          value={presetExerciseDraft.unit}
                          onChange={(e) =>
                            setPresetExerciseDraft((prev) => ({ ...prev, unit: e.target.value as "lbs" | "kg" }))
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
                        labelText="Track RIR"
                        helpText={EXERCISE_CONFIG_HELP.rir}
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
                    <div className="flex justify-end">
                      <button type="submit" className={actionButtonClasses.secondary}>
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
                    <button type="button" onClick={() => setPresetStep(1)} className={actionButtonClasses.secondary}>
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={presetName.trim() === "" || presetExercises.length === 0}
                      onClick={handleSavePreset}
                      className={actionButtonClass("primary", "disabled:cursor-not-allowed")}
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
                  <button type="button" onClick={resetPresetBuilder} className={actionButtonClasses.secondary}>
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={editingPresetName.trim() === "" || editingPresetExercises.length === 0}
                    onClick={handleSaveEditedPreset}
                    className={actionButtonClass("primary", "disabled:cursor-not-allowed")}
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
                        className={actionButtonClasses.secondarySm}
                      >
                        Add Exercise
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPresetSelectionMode(true);
                          setPresetSelectedExerciseIndexes(new Set());
                        }}
                        className={actionButtonClasses.secondarySm}
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
                        className={actionButtonClasses.destructiveSm}
                      >
                        Delete selected
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPresetSelectionMode(false);
                          setPresetSelectedExerciseIndexes(new Set());
                        }}
                        className={actionButtonClasses.secondarySm}
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
                      <div className="space-y-1">
                        <FieldLabelHelp
                          htmlFor={`${presetEditAddCfgId}-sets`}
                          label="Sets"
                          helpText={EXERCISE_CONFIG_HELP.sets}
                        />
                        <input
                          id={`${presetEditAddCfgId}-sets`}
                          type="number"
                          min={1}
                          value={presetExerciseDraft.setCount}
                          onChange={(e) =>
                            setPresetExerciseDraft((prev) => ({ ...prev, setCount: Number(e.target.value) }))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        />
                      </div>
                      <div className="space-y-1">
                        <FieldLabelHelp
                          htmlFor={`${presetEditAddCfgId}-target`}
                          label="Target reps"
                          helpText={EXERCISE_CONFIG_HELP.targetReps}
                        />
                        <input
                          id={`${presetEditAddCfgId}-target`}
                          type="number"
                          min={1}
                          value={presetExerciseDraft.targetReps}
                          onChange={(e) =>
                            setPresetExerciseDraft((prev) => ({ ...prev, targetReps: Number(e.target.value) }))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        />
                      </div>
                      <div className="space-y-1">
                        <FieldLabelHelp
                          htmlFor={`${presetEditAddCfgId}-increment`}
                          label="Increment"
                          helpText={EXERCISE_CONFIG_HELP.increment}
                        />
                        <input
                          id={`${presetEditAddCfgId}-increment`}
                          type="number"
                          min={0}
                          step={0.5}
                          value={presetExerciseDraft.increment}
                          onChange={(e) =>
                            setPresetExerciseDraft((prev) => ({ ...prev, increment: Number(e.target.value) }))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                        />
                      </div>
                      <div className="space-y-1">
                        <FieldLabelHelp
                          htmlFor={`${presetEditAddCfgId}-unit`}
                          label="Unit"
                          helpText={EXERCISE_CONFIG_HELP.unit}
                        />
                        <select
                          id={`${presetEditAddCfgId}-unit`}
                          value={presetExerciseDraft.unit}
                          onChange={(e) =>
                            setPresetExerciseDraft((prev) => ({ ...prev, unit: e.target.value as "lbs" | "kg" }))
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
                        labelText="Track RIR"
                        helpText={EXERCISE_CONFIG_HELP.rir}
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
                    <div className="flex gap-2">
                      <button type="submit" className={actionButtonClasses.secondarySm}>
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingPresetAddExerciseOpen(false)}
                        className={actionButtonClasses.secondarySm}
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
                    <div className="space-y-1">
                      <FieldLabelHelp
                        htmlFor={`${presetEditSelectedCfgId}-sets`}
                        label="Sets"
                        helpText={EXERCISE_CONFIG_HELP.sets}
                      />
                      <input
                        id={`${presetEditSelectedCfgId}-sets`}
                        type="number"
                        min={1}
                        value={editingPresetExercises[selectedEditExerciseIndex].setCount}
                        onChange={(e) =>
                          updateEditingExercise(selectedEditExerciseIndex, (prev) => ({
                            ...prev,
                            setCount: Number(e.target.value)
                          }))
                        }
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                      />
                    </div>
                    <div className="space-y-1">
                      <FieldLabelHelp
                        htmlFor={`${presetEditSelectedCfgId}-target`}
                        label="Target reps"
                        helpText={EXERCISE_CONFIG_HELP.targetReps}
                      />
                      <input
                        id={`${presetEditSelectedCfgId}-target`}
                        type="number"
                        min={1}
                        value={editingPresetExercises[selectedEditExerciseIndex].targetReps}
                        onChange={(e) =>
                          updateEditingExercise(selectedEditExerciseIndex, (prev) => ({
                            ...prev,
                            targetReps: Number(e.target.value)
                          }))
                        }
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                      />
                    </div>
                    <div className="space-y-1">
                      <FieldLabelHelp
                        htmlFor={`${presetEditSelectedCfgId}-increment`}
                        label="Increment"
                        helpText={EXERCISE_CONFIG_HELP.increment}
                      />
                      <input
                        id={`${presetEditSelectedCfgId}-increment`}
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
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                      />
                    </div>
                    <div className="space-y-1">
                      <FieldLabelHelp
                        htmlFor={`${presetEditSelectedCfgId}-unit`}
                        label="Unit"
                        helpText={EXERCISE_CONFIG_HELP.unit}
                      />
                      <select
                        id={`${presetEditSelectedCfgId}-unit`}
                        value={editingPresetExercises[selectedEditExerciseIndex].unit}
                        onChange={(e) =>
                          updateEditingExercise(selectedEditExerciseIndex, (prev) => ({
                            ...prev,
                            unit: e.target.value as "lbs" | "kg"
                          }))
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
                      checked={editingPresetExercises[selectedEditExerciseIndex].trackRir}
                      onChange={(checked) =>
                        updateEditingExercise(selectedEditExerciseIndex, (prev) => ({
                          ...prev,
                          trackRir: checked
                        }))
                      }
                      labelText="Track RIR"
                      helpText={EXERCISE_CONFIG_HELP.rir}
                    />
                    <TrackCheckboxRow
                      checked={editingPresetExercises[selectedEditExerciseIndex].trackRpe}
                      onChange={(checked) =>
                        updateEditingExercise(selectedEditExerciseIndex, (prev) => ({
                          ...prev,
                          trackRpe: checked
                        }))
                      }
                      labelText="Track RPE"
                      helpText={EXERCISE_CONFIG_HELP.rpe}
                    />
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
            <button type="button" onClick={handleExportBackup} className={actionButtonClasses.secondary}>
              Export Data
            </button>
            <button
              type="button"
              onClick={() => backupImportInputRef.current?.click()}
              className={actionButtonClasses.secondary}
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
                  className={actionButtonClass("destructiveSolid", "disabled:cursor-not-allowed")}
                >
                  Yes, import
                </button>
                <button
                  type="button"
                  disabled={backupImportBusy}
                  onClick={() => setBackupImportConfirmOpen(false)}
                  className={actionButtonClass("secondary", "disabled:cursor-not-allowed")}
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

