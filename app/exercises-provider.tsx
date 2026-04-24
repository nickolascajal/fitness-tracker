"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";
import {
  loadClientExercises,
  loadClientWorkoutPresets,
  saveClientExercises,
  saveClientWorkoutPresets
} from "@/lib/storage";

export type ExerciseType = "weight" | "bodyweight" | "time";

export type Exercise = {
  id: string;
  name: string;
  type: ExerciseType;
  /** Hidden CPS baseline for bodyweight-capable movements; not displayed in UI. */
  foundation: number;
  targetReps: number;
  setCount: number;
  increment: number;
  unit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
  /** True when user manually authored this exercise (not from master library selection). */
  isUserCreated?: boolean;
};

export type WorkoutPresetExercise = {
  name: string;
  targetReps: number;
  setCount: number;
  increment: number;
  unit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
};

export type WorkoutPreset = {
  id: string;
  name: string;
  exercises: WorkoutPresetExercise[];
  createdAt: string;
};

type ExercisesContextValue = {
  exercises: Exercise[];
  presets: WorkoutPreset[];
  addExercise: (
    data: Omit<Exercise, "id" | "type" | "foundation"> & {
      type?: ExerciseType;
      foundation?: number;
    }
  ) => Exercise;
  addPreset: (data: Omit<WorkoutPreset, "id" | "createdAt">) => WorkoutPreset;
  updatePreset: (presetId: string, updater: (preset: WorkoutPreset) => WorkoutPreset) => void;
  removePresets: (presetIds: string[]) => void;
  clearExercises: () => void;
};

const ExercisesContext = createContext<ExercisesContextValue | null>(null);

function safeExerciseList(data: unknown): Exercise[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (item): item is Exercise =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as Exercise).id === "string" &&
      typeof (item as Exercise).name === "string" &&
      typeof (item as Exercise).targetReps === "number" &&
      typeof (item as Exercise).setCount === "number" &&
      typeof (item as Exercise).increment === "number"
  ).map((item) => ({
    ...item,
    type:
      item.type === "bodyweight" || item.type === "time"
        ? item.type
        : "weight",
    foundation: Number.isFinite(item.foundation) ? Number(item.foundation) : 0,
    unit: item.unit === "kg" ? "kg" : "lbs",
    trackRir: item.trackRir === true,
    trackRpe: item.trackRpe === true,
    isUserCreated: item.isUserCreated === true
  }));
}

function safePresetList(data: unknown): WorkoutPreset[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (item): item is WorkoutPreset =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as WorkoutPreset).id === "string" &&
        typeof (item as WorkoutPreset).name === "string" &&
        typeof (item as WorkoutPreset).createdAt === "string" &&
        Array.isArray((item as WorkoutPreset).exercises)
    )
    .map((item) => ({
      ...item,
      exercises: item.exercises
        .filter(
          (exercise): exercise is WorkoutPresetExercise =>
            exercise !== null &&
            typeof exercise === "object" &&
            typeof exercise.name === "string" &&
            typeof exercise.targetReps === "number" &&
            typeof exercise.setCount === "number" &&
            typeof exercise.increment === "number"
        )
        .map((exercise) => ({
          ...exercise,
          unit: exercise.unit === "kg" ? "kg" : "lbs",
          trackRir: exercise.trackRir === true,
          trackRpe: exercise.trackRpe === true
        }))
    }));
}

export function ExercisesProvider({ children }: { children: ReactNode }) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [presets, setPresets] = useState<WorkoutPreset[]>([]);
  /** After localStorage has been read and applied — avoids saving initial [] before hydrate. */
  const [storageHydrated, setStorageHydrated] = useState(false);

  useEffect(() => {
    setExercises(safeExerciseList(loadClientExercises()));
    setPresets(safePresetList(loadClientWorkoutPresets()));
    setStorageHydrated(true);
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    saveClientExercises(exercises);
  }, [exercises, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated) return;
    saveClientWorkoutPresets(presets);
  }, [presets, storageHydrated]);

  const addExercise = useCallback(
    (
      data: Omit<Exercise, "id" | "type" | "foundation"> & {
        type?: ExerciseType;
        foundation?: number;
      }
    ): Exercise => {
    const exercise: Exercise = {
      id: crypto.randomUUID(),
      type: data.type ?? "weight",
      foundation: Number.isFinite(data.foundation) ? Number(data.foundation) : 0,
      ...data
    };
    setExercises((previous) => [exercise, ...previous]);
    return exercise;
  }, []);

  const addPreset = useCallback((data: Omit<WorkoutPreset, "id" | "createdAt">): WorkoutPreset => {
    const preset: WorkoutPreset = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...data
    };
    setPresets((previous) => [preset, ...previous]);
    return preset;
  }, []);

  const updatePreset = useCallback(
    (presetId: string, updater: (preset: WorkoutPreset) => WorkoutPreset) => {
      setPresets((previous) => {
        let changed = false;
        const next = previous.map((preset) => {
          if (preset.id !== presetId) return preset;
          changed = true;
          return updater(preset);
        });
        return changed ? next : previous;
      });
    },
    []
  );

  const removePresets = useCallback((presetIds: string[]) => {
    if (presetIds.length === 0) return;
    const ids = new Set(presetIds);
    setPresets((previous) => previous.filter((preset) => !ids.has(preset.id)));
  }, []);

  const clearExercises = useCallback(() => {
    setExercises([]);
  }, []);

  return (
    <ExercisesContext.Provider
      value={{
        exercises,
        presets,
        addExercise,
        addPreset,
        updatePreset,
        removePresets,
        clearExercises
      }}
    >
      {children}
    </ExercisesContext.Provider>
  );
}

export function useExercises() {
  const context = useContext(ExercisesContext);
  if (!context) {
    throw new Error("useExercises must be used within an ExercisesProvider");
  }
  return context;
}
