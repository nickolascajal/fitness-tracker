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
import { supabase } from "@/lib/supabaseClient";
import { exerciseNameKey } from "@/lib/exerciseNameKey";

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

function exerciseConfigSignature(exercise: Exercise): string {
  return JSON.stringify({
    n: exerciseNameKey(exercise.name),
    setCount: exercise.setCount,
    targetReps: exercise.targetReps,
    increment: exercise.increment,
    unit: exercise.unit,
    type: exercise.type,
    foundation: exercise.foundation,
    trackRir: exercise.trackRir,
    trackRpe: exercise.trackRpe
  });
}

/**
 * Merges remote exercises into local list: no duplicate ids; no duplicate name+config.
 */
function mergeExercisesFromRemote(local: Exercise[], remote: Exercise[]): Exercise[] {
  const seenIds = new Set<string>();
  const seenSigs = new Set<string>();
  for (const e of local) {
    seenIds.add(e.id);
    seenSigs.add(exerciseConfigSignature(e));
  }
  const out = [...local];
  for (const r of remote) {
    if (seenIds.has(r.id)) continue;
    if (seenSigs.has(exerciseConfigSignature(r))) continue;
    seenIds.add(r.id);
    seenSigs.add(exerciseConfigSignature(r));
    out.push(r);
  }
  return out;
}

type PostgrestLikeError = {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

type SupabaseJsonRow = {
  id?: string | number;
  data?: unknown;
};

function logPostgrestError(context: string, error: PostgrestLikeError | null | undefined): void {
  if (!error) return;
  console.error(context, {
    message: error.message,
    code: error.code,
    details: error.details ?? undefined,
    hint: error.hint ?? undefined
  });
}

function isExercisesTableNotAvailable(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const blob = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    /does not exist|not find the table|schema cache|undefined table|relation .+ does not exist/i.test(blob) ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202"
  );
}

function isPresetsTableNotAvailable(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const blob = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    /does not exist|not find the table|schema cache|undefined table|relation .+ does not exist/i.test(blob) ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202"
  );
}

function exerciseInsertPayloadForLog(exercise: Exercise) {
  return {
    data: {
      id: exercise.id,
      name: exercise.name,
      setCount: exercise.setCount,
      targetReps: exercise.targetReps,
      increment: exercise.increment,
      unit: exercise.unit,
      type: exercise.type,
      foundation: exercise.foundation,
      trackRir: exercise.trackRir,
      trackRpe: exercise.trackRpe,
      isUserCreated: exercise.isUserCreated === true
    }
  };
}

function presetLegacyId(preset: WorkoutPreset): string {
  const maybe = (preset as WorkoutPreset & { presetId?: unknown }).presetId;
  return typeof maybe === "string" ? maybe : "";
}

/**
 * Hydration merge rule: when a remote preset matches a local preset id pair,
 * Supabase wins and replaces the stale local preset.
 */
function mergePresetsFromRemote(local: WorkoutPreset[], remote: WorkoutPreset[]): WorkoutPreset[] {
  const out = [...local];
  const usedLocalIndexes = new Set<number>();

  const findMatchingLocalIndex = (remotePreset: WorkoutPreset): number => {
    const remoteId = remotePreset.id;
    const remotePresetId = presetLegacyId(remotePreset);
    return out.findIndex((localPreset, index) => {
      if (usedLocalIndexes.has(index)) return false;
      const localId = localPreset.id;
      const localPresetId = presetLegacyId(localPreset);
      return (
        localId === remoteId ||
        (localPresetId !== "" && localPresetId === remoteId) ||
        (remotePresetId !== "" && localId === remotePresetId)
      );
    });
  };

  for (const remotePreset of remote) {
    const matchIndex = findMatchingLocalIndex(remotePreset);
    if (matchIndex >= 0) {
      out[matchIndex] = remotePreset;
      usedLocalIndexes.add(matchIndex);
      continue;
    }
    out.push(remotePreset);
  }

  return out;
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

  useEffect(() => {
    if (!storageHydrated) return;

    const fetchAndMergeExercises = async () => {
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: rows, error } = await supabase
          .from("exercises")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });

        if (error) {
          if (isExercisesTableNotAvailable(error)) {
            console.warn(
              "Supabase exercises table not available yet. App will continue using localStorage for exercises until the table is created."
            );
            return;
          }
          logPostgrestError("Supabase exercises fetch error:", error);
          return;
        }
        if (!rows?.length) return;

        const remote: Exercise[] = [];
        for (const row of rows) {
          const raw = (row as { data?: unknown }).data;
          const list = safeExerciseList(Array.isArray(raw) ? raw : raw != null ? [raw] : []);
          for (const e of list) {
            remote.push(e);
          }
        }

        if (remote.length === 0) return;
        setExercises((prev) => mergeExercisesFromRemote(prev, remote));
      } catch (e) {
        const err = e as Error & PostgrestLikeError;
        console.error("Supabase exercises hydration failed:", {
          message: err?.message,
          name: err?.name,
          code: err?.code,
          details: err?.details,
          hint: err?.hint
        });
      }
    };

    const fetchAndMergePresets = async () => {
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: rows, error } = await supabase
          .from("presets")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });

        if (error) {
          if (isPresetsTableNotAvailable(error)) {
            console.warn(
              "Supabase presets table not available yet. App will continue using localStorage for presets until the table is created."
            );
            return;
          }
          logPostgrestError("Supabase presets fetch error:", error);
          return;
        }

        if (!rows?.length) return;
        const remote: WorkoutPreset[] = [];
        for (const row of rows as SupabaseJsonRow[]) {
          const raw = row.data;
          const list = safePresetList(Array.isArray(raw) ? raw : raw != null ? [raw] : []);
          for (const preset of list) remote.push(preset);
        }
        if (remote.length === 0) return;
        setPresets((prev) => mergePresetsFromRemote(prev, remote));
      } catch (e) {
        const err = e as Error & PostgrestLikeError;
        console.error("Supabase presets hydration failed:", {
          message: err?.message,
          name: err?.name,
          code: err?.code,
          details: err?.details,
          hint: err?.hint
        });
      }
    };

    void fetchAndMergeExercises();
    void fetchAndMergePresets();
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        void fetchAndMergeExercises();
        void fetchAndMergePresets();
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [storageHydrated]);

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

    void (async () => {
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (!user) {
          console.warn("Supabase exercise insert skipped: no authenticated user");
          return;
        }

        const { error } = await supabase
          .from("exercises")
          .insert({
            user_id: user.id,
            data: exercise
          })
          .select();

        if (error) {
          if (isExercisesTableNotAvailable(error)) {
            console.warn(
              "Supabase exercises table not available yet. Exercise is saved locally only; create the `exercises` table and RLS policies (see supabase/migrations) to sync across devices."
            );
            console.error("Supabase exercise insert (table missing) details:");
            console.error(JSON.stringify(error, null, 2));
            return;
          }
          if (
            error.code === "42501" ||
            (error.message ?? "").toLowerCase().includes("row-level security")
          ) {
            console.error(
              "Supabase exercise insert may be blocked by RLS. Ensure an INSERT policy exists: WITH CHECK (auth.uid() = user_id), and that user_id matches the signed-in user."
            );
          }
          console.error("Supabase exercise insert error:");
          console.error(JSON.stringify(error, null, 2));

          console.error("Supabase exercise insert request shape:");
          console.error(
            JSON.stringify(
              {
                hasUserId: !!user?.id,
                userIdLength: user?.id?.length,
                payload: exerciseInsertPayloadForLog(exercise)
              },
              null,
              2
            )
          );
          return;
        }

      } catch (e) {
        const err = e as Error;
        console.error("Supabase exercise insert failed (exception):", {
          message: err?.message,
          name: err?.name,
          cause: (err as { cause?: unknown }).cause
        });
      }
    })();

    return exercise;
  }, []);

  const addPreset = useCallback((data: Omit<WorkoutPreset, "id" | "createdAt">): WorkoutPreset => {
    const preset: WorkoutPreset = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...data
    };
    setPresets((previous) => [preset, ...previous]);

    void (async () => {
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (!user) return;
        const { error } = await supabase.from("presets").insert({
          user_id: user.id,
          data: preset
        });
        if (error) {
          if (!isPresetsTableNotAvailable(error)) {
            console.error("Supabase preset insert failed", error);
          }
        }
      } catch (error) {
        console.error("Supabase preset insert failed", error);
      }
    })();

    return preset;
  }, []);

  const updatePreset = useCallback(
    (presetId: string, updater: (preset: WorkoutPreset) => WorkoutPreset) => {
      console.log("updatePreset called");
      let updatedPreset: WorkoutPreset | null = null;
      setPresets((previous) => {
        let changed = false;
        const next = previous.map((preset) => {
          if (preset.id !== presetId) return preset;
          changed = true;
          updatedPreset = updater(preset);
          return updatedPreset;
        });
        return changed ? next : previous;
      });

      if (!updatedPreset) return;
      const presetToSync: WorkoutPreset = updatedPreset;
      void (async () => {
        try {
          console.log("Supabase preset update start");
          console.log("updatedPreset id:", presetToSync.id);
          console.log("updatedPreset first exercise setCount/targetReps:", {
            setCount: presetToSync.exercises[0]?.setCount ?? null,
            targetReps: presetToSync.exercises[0]?.targetReps ?? null
          });

          const {
            data: { user }
          } = await supabase.auth.getUser();
          if (!user) return;

          const { data: rows, error: lookupError } = await supabase
            .from("presets")
            .select("id,data")
            .eq("user_id", user.id);
          if (lookupError) {
            console.error("Supabase preset update failed", lookupError);
            return;
          }
          const matched = ((rows as SupabaseJsonRow[] | null) ?? []).find((row) => {
            let payload: unknown = row.data;
            if (typeof payload === "string") {
              try {
                payload = JSON.parse(payload);
              } catch {
                payload = null;
              }
            }
            if (!payload || typeof payload !== "object") return false;
            const payloadId =
              typeof (payload as { id?: unknown }).id === "string"
                ? (payload as { id: string }).id
                : "";
            const payloadPresetId =
              typeof (payload as { presetId?: unknown }).presetId === "string"
                ? (payload as { presetId: string }).presetId
                : "";
            const updatedPresetId = presetToSync.id;
            const updatedPresetLegacyId =
              typeof (presetToSync as WorkoutPreset & { presetId?: unknown }).presetId === "string"
                ? ((presetToSync as WorkoutPreset & { presetId: string }).presetId ?? "")
                : "";

            return (
              payloadId === updatedPresetId ||
              payloadPresetId === updatedPresetId ||
              (updatedPresetLegacyId !== "" && payloadId === updatedPresetLegacyId)
            );
          });
          if (!matched?.id) {
            console.warn("No Supabase preset row found for preset id", presetToSync.id);
            return;
          }
          console.log("Matched Supabase preset row id:", matched.id);
          console.log("Supabase preset update payload first exercise setCount/targetReps:", {
            setCount: presetToSync.exercises[0]?.setCount ?? null,
            targetReps: presetToSync.exercises[0]?.targetReps ?? null
          });

          const { data: updateData, error } = await supabase
            .from("presets")
            .update({ data: presetToSync })
            .eq("id", matched.id)
            .eq("user_id", user.id)
            .select();
          console.log("Supabase preset update data:", updateData ?? null);
          console.log("Supabase preset update error:", error ?? null);
          if (error) {
            console.error("Supabase preset update failed", error);
          }
        } catch (error) {
          console.error("Supabase preset update failed", error);
        }
      })();
    },
    []
  );

  const removePresets = useCallback((presetIds: string[]) => {
    if (presetIds.length === 0) return;
    const ids = new Set(presetIds);
    setPresets((previous) => previous.filter((preset) => !ids.has(preset.id)));

    for (const presetId of presetIds) {
      void (async () => {
        try {
          const {
            data: { user }
          } = await supabase.auth.getUser();
          if (!user) return;

          const { data: rows, error: lookupError } = await supabase
            .from("presets")
            .select("id,data")
            .eq("user_id", user.id);
          if (lookupError) {
            console.error("Supabase preset delete failed", lookupError);
            return;
          }
          const matched = ((rows as SupabaseJsonRow[] | null) ?? []).find((row) => {
            const payload = row.data;
            if (!payload || typeof payload !== "object") return false;
            const payloadId =
              typeof (payload as { id?: unknown }).id === "string"
                ? (payload as { id: string }).id
                : typeof (payload as { presetId?: unknown }).presetId === "string"
                  ? (payload as { presetId: string }).presetId
                  : "";
            return payloadId === presetId;
          });
          if (!matched?.id) {
            console.warn("No Supabase row found for presetId", presetId);
            return;
          }

          const { error } = await supabase
            .from("presets")
            .delete()
            .eq("id", matched.id)
            .eq("user_id", user.id);
          if (error) {
            console.error("Supabase preset delete failed", error);
          }
        } catch (error) {
          console.error("Supabase preset delete failed", error);
        }
      })();
    }
  }, []);

  const clearExercises = useCallback(() => {
    setExercises([]);

    void (async () => {
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (!user) return;
        const { error } = await supabase.from("exercises").delete().eq("user_id", user.id);
        if (error) {
          console.error("Supabase exercise delete failed", error);
        }
      } catch (error) {
        console.error("Supabase exercise delete failed", error);
      }
    })();
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
