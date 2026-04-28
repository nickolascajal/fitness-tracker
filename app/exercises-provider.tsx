"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  loadClientExercises,
  loadClientWorkoutPresets,
  saveClientExercises,
  saveClientWorkoutPresets
} from "@/lib/storage";
import {
  addPendingSyncItem,
  flushPendingSyncQueue,
  loadPendingSyncQueue,
  removePendingInsertForEntity
} from "@/lib/pendingSync";
import { getUserForPendingSync } from "@/lib/pendingSyncAuth";
import { supabase } from "@/lib/supabaseClient";
import { exerciseDuplicateKey } from "@/lib/exerciseNameKey";

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
  /** Soft-hide custom exercise from active pickers without deleting historical references. */
  isArchived?: boolean;
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
  archiveExercises: (exerciseIds: string[]) => void;
  deleteExercisesPermanently: (exerciseIds: string[]) => void;
  clearPresets: () => void;
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
    isUserCreated: item.isUserCreated === true,
    isArchived: item.isArchived === true
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
        isUserCreated: exercise.isUserCreated === true,
        isArchived: exercise.isArchived === true
    }
  };
}

function applyAuthoritativeExerciseHydration(
  remote: Exercise[],
  local: Exercise[]
): Exercise[] {
  const pending = loadPendingSyncQueue().filter((item) => item.type === "exercise");
  const deletedIds = new Set<string>();
  const keptIds = new Set<string>();
  const localById = new Map(local.map((item) => [item.id, item]));

  for (const item of pending) {
    const payload = item.payload as {
      exerciseId?: string;
      exercise?: Exercise;
    };
    const id = payload.exerciseId ?? payload.exercise?.id ?? "";
    if (!id) continue;
    if (item.action === "delete") {
      deletedIds.add(id);
      keptIds.delete(id);
      continue;
    }
    if (item.action === "insert" || item.action === "update") {
      keptIds.add(id);
    }
  }

  const base = remote.filter((item) => !deletedIds.has(item.id));
  const out = [...base];
  const seen = new Set(out.map((item) => item.id));
  for (const id of keptIds) {
    const localItem = localById.get(id);
    if (!localItem) continue;
    if (seen.has(id)) {
      const idx = out.findIndex((item) => item.id === id);
      if (idx >= 0) out[idx] = localItem;
      continue;
    }
    out.push(localItem);
    seen.add(id);
  }
  return out;
}

function applyAuthoritativePresetHydration(
  remote: WorkoutPreset[],
  local: WorkoutPreset[]
): WorkoutPreset[] {
  const pending = loadPendingSyncQueue().filter((item) => item.type === "preset");
  const deletedIds = new Set<string>();
  const keptIds = new Set<string>();
  const localById = new Map(local.map((item) => [item.id, item]));

  for (const item of pending) {
    const payload = item.payload as {
      presetId?: string;
      preset?: WorkoutPreset;
    };
    const id = payload.presetId ?? payload.preset?.id ?? "";
    if (!id) continue;
    if (item.action === "delete") {
      deletedIds.add(id);
      keptIds.delete(id);
      continue;
    }
    if (item.action === "insert" || item.action === "update") {
      keptIds.add(id);
    }
  }

  const base = remote.filter((item) => !deletedIds.has(item.id));
  const out = [...base];
  const seen = new Set(out.map((item) => item.id));
  for (const id of keptIds) {
    const localItem = localById.get(id);
    if (!localItem) continue;
    if (seen.has(id)) {
      const idx = out.findIndex((item) => item.id === id);
      if (idx >= 0) out[idx] = localItem;
      continue;
    }
    out.push(localItem);
    seen.add(id);
  }
  return out;
}

function isOfflineAuthFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (error instanceof TypeError) return true;
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("internet_disconnected")
  );
}

export function ExercisesProvider({ children }: { children: ReactNode }) {
  const enqueuePendingSyncItem = addPendingSyncItem;
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [presets, setPresets] = useState<WorkoutPreset[]>([]);
  /** After localStorage has been read and applied — avoids saving initial [] before hydrate. */
  const [storageHydrated, setStorageHydrated] = useState(false);

  useEffect(() => {
    setExercises(safeExerciseList(loadClientExercises()));
    setPresets(safePresetList(loadClientWorkoutPresets()));
    setStorageHydrated(true);
  }, [enqueuePendingSyncItem]);

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
        const remote: Exercise[] = [];
        for (const row of rows ?? []) {
          const raw = (row as { data?: unknown }).data;
          const list = safeExerciseList(Array.isArray(raw) ? raw : raw != null ? [raw] : []);
          for (const e of list) {
            remote.push(e);
          }
        }
        setExercises((prev) => applyAuthoritativeExerciseHydration(remote, prev));
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

        const remote: WorkoutPreset[] = [];
        for (const row of (rows as SupabaseJsonRow[] | null | undefined) ?? []) {
          const raw = row.data;
          const list = safePresetList(Array.isArray(raw) ? raw : raw != null ? [raw] : []);
          for (const preset of list) remote.push(preset);
        }
        setPresets((prev) => applyAuthoritativePresetHydration(remote, prev));
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
      isArchived: false,
      ...data
    };
    setExercises((previous) => [exercise, ...previous]);

    void (async () => {
      const pendingItem = {
        type: "exercise" as const,
        action: "insert" as const,
        payload: { exerciseId: exercise.id, exercise }
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        enqueuePendingSyncItem(pendingItem);
        return;
      }
      try {
        const {
          data: { user },
          error: userError
        } = await supabase.auth.getUser();
        if (userError && isOfflineAuthFailure(userError)) {
          enqueuePendingSyncItem(pendingItem);
          return;
        }
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
          enqueuePendingSyncItem(pendingItem);
          return;
        }

      } catch (e) {
        const err = e as Error;
        console.error("Supabase exercise insert failed (exception):", {
          message: err?.message,
          name: err?.name,
          cause: (err as { cause?: unknown }).cause
        });
        enqueuePendingSyncItem(pendingItem);
      }
    })();

    return exercise;
  }, [enqueuePendingSyncItem]);

  const syncExerciseUpdateToSupabase = useCallback(
    async (exercise: Exercise) => {
      const pendingItem = {
        type: "exercise" as const,
        action: "update" as const,
        payload: { exerciseId: exercise.id, exercise }
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        enqueuePendingSyncItem(pendingItem);
        return;
      }
      try {
        const {
          data: { user },
          error: userError
        } = await supabase.auth.getUser();
        if (userError && isOfflineAuthFailure(userError)) {
          enqueuePendingSyncItem(pendingItem);
          return;
        }
        if (!user) return;
        const { data: rows, error: lookupError } = await supabase
          .from("exercises")
          .select("id,data")
          .eq("user_id", user.id);
        if (lookupError) {
          enqueuePendingSyncItem(pendingItem);
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
          return (payload as { id?: unknown }).id === exercise.id;
        });
        if (!matched?.id) {
          enqueuePendingSyncItem(pendingItem);
          return;
        }
        const { error } = await supabase
          .from("exercises")
          .update({ data: exercise })
          .eq("id", matched.id)
          .eq("user_id", user.id);
        if (error) enqueuePendingSyncItem(pendingItem);
      } catch {
        enqueuePendingSyncItem(pendingItem);
      }
    },
    [enqueuePendingSyncItem]
  );

  const syncExerciseDeleteToSupabase = useCallback(
    async (exerciseId: string) => {
      if (!exerciseId) return;
      const removedPendingInsert = removePendingInsertForEntity("exercise", exerciseId);
      const pendingItem = {
        type: "exercise" as const,
        action: "delete" as const,
        payload: { exerciseId }
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        if (!removedPendingInsert) enqueuePendingSyncItem(pendingItem);
        return;
      }
      try {
        const {
          data: { user },
          error: userError
        } = await supabase.auth.getUser();
        if (userError && isOfflineAuthFailure(userError)) {
          if (!removedPendingInsert) enqueuePendingSyncItem(pendingItem);
          return;
        }
        if (!user) return;
        const { data: rows, error: lookupError } = await supabase
          .from("exercises")
          .select("id,data")
          .eq("user_id", user.id);
        if (lookupError) {
          if (!removedPendingInsert) enqueuePendingSyncItem(pendingItem);
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
          return (payload as { id?: unknown }).id === exerciseId;
        });
        if (!matched?.id) return;
        const { error } = await supabase
          .from("exercises")
          .delete()
          .eq("id", matched.id)
          .eq("user_id", user.id);
        if (error && !removedPendingInsert) enqueuePendingSyncItem(pendingItem);
      } catch {
        if (!removedPendingInsert) enqueuePendingSyncItem(pendingItem);
      }
    },
    [enqueuePendingSyncItem]
  );

  const addPreset = useCallback((data: Omit<WorkoutPreset, "id" | "createdAt">): WorkoutPreset => {
    const preset: WorkoutPreset = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...data
    };
    setPresets((previous) => [preset, ...previous]);

    void (async () => {
      const pendingItem = {
        type: "preset" as const,
        action: "insert" as const,
        payload: { presetId: preset.id, preset }
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        enqueuePendingSyncItem(pendingItem);
        return;
      }
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
            enqueuePendingSyncItem(pendingItem);
          }
        }
      } catch (error) {
        console.error("Supabase preset insert failed", error);
        enqueuePendingSyncItem(pendingItem);
      }
    })();

    return preset;
  }, [enqueuePendingSyncItem]);

  const updatePreset = useCallback(
    (presetId: string, updater: (preset: WorkoutPreset) => WorkoutPreset) => {
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
        const pendingItem = {
          type: "preset" as const,
          action: "update" as const,
          payload: { presetId: presetToSync.id, preset: presetToSync }
        };
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          enqueuePendingSyncItem(pendingItem);
          return;
        }
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
            console.error("Supabase preset update failed", lookupError);
            enqueuePendingSyncItem(pendingItem);
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
            enqueuePendingSyncItem(pendingItem);
            return;
          }
          const { error } = await supabase
            .from("presets")
            .update({ data: presetToSync })
            .eq("id", matched.id)
            .eq("user_id", user.id)
            .select();
          if (error) {
            console.error("Supabase preset update failed", error);
            enqueuePendingSyncItem(pendingItem);
          }
        } catch (error) {
          console.error("Supabase preset update failed", error);
          enqueuePendingSyncItem(pendingItem);
        }
      })();
    },
    [enqueuePendingSyncItem]
  );

  const removePresets = useCallback((presetIds: string[]) => {
    if (presetIds.length === 0) return;
    const ids = new Set(presetIds);
    setPresets((previous) => previous.filter((preset) => !ids.has(preset.id)));

    for (const presetId of presetIds) {
      void (async () => {
        if (removePendingInsertForEntity("preset", presetId)) {
          return;
        }

        const pendingItem = {
          type: "preset" as const,
          action: "delete" as const,
          payload: { presetId }
        };
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          enqueuePendingSyncItem(pendingItem);
          return;
        }
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
            enqueuePendingSyncItem(pendingItem);
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
            enqueuePendingSyncItem(pendingItem);
          }
        } catch (error) {
          console.error("Supabase preset delete failed", error);
          enqueuePendingSyncItem(pendingItem);
        }
      })();
    }
  }, [enqueuePendingSyncItem]);

  const archiveExercises = useCallback(
    (exerciseIds: string[]) => {
      if (exerciseIds.length === 0) return;
      const ids = new Set(exerciseIds);
      const toSync: Exercise[] = [];
      setExercises((previous) =>
        previous.map((exercise) => {
          if (!ids.has(exercise.id) || exercise.isUserCreated !== true || exercise.isArchived === true) {
            return exercise;
          }
          const next: Exercise = { ...exercise, isArchived: true };
          toSync.push(next);
          return next;
        })
      );
      for (const exercise of toSync) {
        void syncExerciseUpdateToSupabase(exercise);
      }
    },
    [syncExerciseUpdateToSupabase]
  );

  const deleteExercisesPermanently = useCallback(
    (exerciseIds: string[]) => {
      if (exerciseIds.length === 0) return;
      const ids = new Set(exerciseIds);
      const deletedExercises: Exercise[] = [];
      setExercises((previous) =>
        previous.filter((exercise) => {
          const shouldDelete = ids.has(exercise.id) && exercise.isUserCreated === true;
          if (shouldDelete) deletedExercises.push(exercise);
          return !shouldDelete;
        })
      );
      if (deletedExercises.length === 0) return;
      const deletedKeys = new Set(
        deletedExercises.map((exercise) =>
          `${exerciseDuplicateKey(exercise.name)}::${exercise.targetReps}::${exercise.setCount}::${exercise.increment}::${exercise.unit}::${exercise.trackRir ? 1 : 0}::${exercise.trackRpe ? 1 : 0}`
        )
      );
      const changedPresets: WorkoutPreset[] = [];
      setPresets((previous) =>
        previous.map((preset) => {
          const nextExercises = preset.exercises.filter((exercise) => {
            const key = `${exerciseDuplicateKey(exercise.name)}::${exercise.targetReps}::${exercise.setCount}::${exercise.increment}::${exercise.unit}::${exercise.trackRir ? 1 : 0}::${exercise.trackRpe ? 1 : 0}`;
            return !deletedKeys.has(key);
          });
          if (nextExercises.length === preset.exercises.length) return preset;
          const nextPreset = { ...preset, exercises: nextExercises };
          changedPresets.push(nextPreset);
          return nextPreset;
        })
      );
      for (const preset of changedPresets) {
        enqueuePendingSyncItem({
          type: "preset",
          action: "update",
          payload: { presetId: preset.id, preset }
        });
      }
      for (const exercise of deletedExercises) {
        void syncExerciseDeleteToSupabase(exercise.id);
      }
    },
    [enqueuePendingSyncItem, syncExerciseDeleteToSupabase]
  );

  const clearExercises = useCallback(() => {
    setExercises([]);

    void (async () => {
      const pendingItem = {
        type: "exercise" as const,
        action: "delete" as const,
        payload: { all: true }
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        enqueuePendingSyncItem(pendingItem);
        return;
      }
      try {
        const {
          data: { user },
          error: userError
        } = await supabase.auth.getUser();
        if (userError && isOfflineAuthFailure(userError)) {
          enqueuePendingSyncItem(pendingItem);
          return;
        }
        if (!user) return;
        const { error } = await supabase.from("exercises").delete().eq("user_id", user.id);
        if (error) {
          console.error("Supabase exercise delete failed", error);
          enqueuePendingSyncItem(pendingItem);
          return;
        }
      } catch (error) {
        console.error("Supabase exercise delete failed", error);
        enqueuePendingSyncItem(pendingItem);
      }
    })();
  }, [enqueuePendingSyncItem]);

  const clearPresets = useCallback(() => {
    setPresets([]);

    void (async () => {
      const pendingItem = {
        type: "preset" as const,
        action: "delete" as const,
        payload: { all: true }
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        enqueuePendingSyncItem(pendingItem);
        return;
      }
      try {
        const {
          data: { user },
          error: userError
        } = await supabase.auth.getUser();
        if (userError && isOfflineAuthFailure(userError)) {
          enqueuePendingSyncItem(pendingItem);
          return;
        }
        if (!user) return;
        const { error } = await supabase.from("presets").delete().eq("user_id", user.id);
        if (error) {
          console.error("Supabase preset delete failed", error);
          enqueuePendingSyncItem(pendingItem);
          return;
        }
      } catch (error) {
        console.error("Supabase preset delete failed", error);
        enqueuePendingSyncItem(pendingItem);
      }
    })();
  }, [enqueuePendingSyncItem]);

  const flushPendingExercisePresetSync = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return;
    }
    try {
      const { user } = await getUserForPendingSync();
      if (!user) {
        return;
      }
      await flushPendingSyncQueue(supabase, user.id);
    } catch (error) {
      if (isOfflineAuthFailure(error)) return;
      console.error("Pending sync flush failed:", error);
    }
  }, []);

  const flushPendingExercisePresetSyncRef = useRef(flushPendingExercisePresetSync);
  flushPendingExercisePresetSyncRef.current = flushPendingExercisePresetSync;

  useEffect(() => {
    const run = () => {
      void flushPendingExercisePresetSyncRef.current();
    };
    run();
    queueMicrotask(run);
    setTimeout(run, 0);
    const onOnline = () => {
      run();
    };
    window.addEventListener("online", onOnline);
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(() => {
      run();
    });
    return () => {
      window.removeEventListener("online", onOnline);
      subscription.unsubscribe();
    };
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
        archiveExercises,
        deleteExercisesPermanently,
        clearPresets,
        clearExercises
      }}
    >
      {children}
    </ExercisesContext.Provider>
  );
}

/**
 * Data mutation architecture rule:
 * - New exercise/preset features must call provider mutations (addExercise/addPreset/updatePreset/removePresets/clear*).
 * - Do not call Supabase exercises/presets table writes directly from UI/page components.
 * - Do not write exercises/presets localStorage directly from UI components.
 */
export function useExercises() {
  const context = useContext(ExercisesContext);
  if (!context) {
    throw new Error("useExercises must be used within an ExercisesProvider");
  }
  return context;
}
