"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  loadClientWorkoutHistory,
  saveClientWorkoutHistory
} from "@/lib/storage";
import {
  addPendingSyncItem,
  flushPendingSyncQueue,
  removePendingInsertForEntity
} from "@/lib/pendingSync";
import { getUserForPendingSync } from "@/lib/pendingSyncAuth";
import { supabase } from "@/lib/supabaseClient";

export type WorkoutSetSnapshot = {
  weight: string;
  reps: string;
  timeSeconds?: number;
  rir?: string;
  tir?: string;
  rpe?: string;
};

export type WorkoutHistoryEntry = {
  workoutId: string;
  exerciseId: string;
  exerciseName: string;
  workoutDate?: string;
  /** True when added as a preset draft and not yet logged with at least one valid set. */
  isDraft?: boolean;
  sets: WorkoutSetSnapshot[];
  sessionVolume: number;
  /** Custom Performance Score for this session, or null if it could not be computed. */
  sessionCps: number | null;
  progressionStage: string;
  recommendation: string;
  /** Original submission timestamp; treat as createdAt (immutable). */
  submittedAt: string;
  /** Last edit timestamp; optional for untouched entries. */
  updatedAt?: string;
};

type WorkoutHistoryContextValue = {
  historyByExerciseId: Record<string, WorkoutHistoryEntry[]>;
  getWorkoutsByDate: (date: string) => WorkoutHistoryEntry[];
  isDateMarkedRest: (date: string) => boolean;
  setDateRestFlag: (date: string, isRest: boolean) => void;
  listRestDates: () => string[];
  isDateFinished: (date: string) => boolean;
  setDateFinishedFlag: (date: string, isFinished: boolean) => void;
  listFinishedDates: () => string[];
  addWorkout: (entry: WorkoutHistoryEntry) => void;
  removeWorkoutsFromDate: (dateKey: string, workoutIds: string[]) => void;
  updateWorkoutEntry: (
    workoutId: string,
    updater: (entry: WorkoutHistoryEntry) => WorkoutHistoryEntry
  ) => void;
  updateLatestWorkout: (
    exerciseId: string,
    submittedAt: string,
    updater: (entry: WorkoutHistoryEntry) => WorkoutHistoryEntry
  ) => void;
  clearWorkoutHistory: () => void;
};

const WorkoutHistoryContext = createContext<WorkoutHistoryContextValue | null>(null);

type WorkoutHistoryByDate = Record<string, WorkoutHistoryEntry[]>;
type RestFlagsByDate = Record<string, true>;
type FinishedFlagsByDate = Record<string, true>;
type WorkoutHistoryStore = {
  byDate: WorkoutHistoryByDate;
  restByDate?: RestFlagsByDate;
  finishedByDate?: FinishedFlagsByDate;
};

type SupabaseWorkoutRow = {
  id?: string | number;
  user_id?: string;
  date?: string | null;
  data: unknown;
};

function toLocalDateStringFromIso(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function entryDateKey(entry: WorkoutHistoryEntry): string {
  return entry.workoutDate && entry.workoutDate.trim() !== ""
    ? entry.workoutDate
    : toLocalDateStringFromIso(entry.submittedAt);
}

function normalizeWorkoutEntry(
  entry: Partial<WorkoutHistoryEntry>,
  fallbackDateKey?: string
): WorkoutHistoryEntry | null {
  if (
    !entry ||
    typeof entry.exerciseId !== "string" ||
    typeof entry.exerciseName !== "string" ||
    !Array.isArray(entry.sets) ||
    typeof entry.sessionVolume !== "number" ||
    typeof entry.progressionStage !== "string" ||
    typeof entry.recommendation !== "string" ||
    typeof entry.submittedAt !== "string"
  ) {
    return null;
  }
  const workoutDate =
    typeof entry.workoutDate === "string" && entry.workoutDate.trim() !== ""
      ? entry.workoutDate
      : fallbackDateKey ?? toLocalDateStringFromIso(entry.submittedAt);
  const workoutId =
    typeof entry.workoutId === "string" && entry.workoutId.trim() !== ""
      ? entry.workoutId
      : `${entry.exerciseId}:${entry.submittedAt}`;
  return {
    workoutId,
    exerciseId: entry.exerciseId,
    exerciseName: entry.exerciseName,
    workoutDate,
    isDraft: entry.isDraft === true,
    sets: entry.sets.map((s) => ({
      weight: typeof s?.weight === "string" ? s.weight : String(s?.weight ?? ""),
      reps: typeof s?.reps === "string" ? s.reps : String(s?.reps ?? ""),
      timeSeconds: (() => {
        if (typeof s?.timeSeconds === "number" && Number.isFinite(s.timeSeconds) && s.timeSeconds >= 0) {
          return s.timeSeconds;
        }
        // Backward compatibility for legacy `time` string snapshots.
        if (typeof (s as { time?: unknown })?.time === "string") {
          const parsed = Number((s as { time?: string }).time ?? "");
          return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        }
        return 0;
      })(),
      rir: typeof s?.rir === "string" ? s.rir : "",
      tir: typeof s?.tir === "string" ? s.tir : "",
      rpe: typeof s?.rpe === "string" ? s.rpe : ""
    })),
    sessionVolume: entry.sessionVolume,
    sessionCps: (() => {
      if (entry.sessionCps === null || entry.sessionCps === undefined) return null;
      const n =
        typeof entry.sessionCps === "number"
          ? entry.sessionCps
          : Number(entry.sessionCps);
      return Number.isFinite(n) ? n : null;
    })(),
    progressionStage: entry.progressionStage,
    recommendation: entry.recommendation,
    submittedAt: entry.submittedAt,
    updatedAt:
      typeof entry.updatedAt === "string" && entry.updatedAt.trim() !== ""
        ? entry.updatedAt
        : undefined
  };
}

function safeHistoryByDate(data: unknown): WorkoutHistoryByDate {
  const byDateCandidate =
    data && typeof data === "object" && !Array.isArray(data) && "byDate" in data
      ? (data as { byDate?: unknown }).byDate
      : null;
  if (byDateCandidate && typeof byDateCandidate === "object" && !Array.isArray(byDateCandidate)) {
    const out: WorkoutHistoryByDate = {};
    for (const [dateKey, list] of Object.entries(byDateCandidate as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const entries: WorkoutHistoryEntry[] = [];
      for (const item of list) {
        const normalized = normalizeWorkoutEntry(item as Partial<WorkoutHistoryEntry>, dateKey);
        if (normalized) entries.push(normalized);
      }
      if (entries.length > 0) {
        out[dateKey] = entries.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      }
    }
    return out;
  }

  // Legacy shape fallback: { [exerciseId]: WorkoutHistoryEntry[] }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }
  const out: WorkoutHistoryByDate = {};
  for (const [, list] of Object.entries(data)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const normalized = normalizeWorkoutEntry(item as Partial<WorkoutHistoryEntry>);
      if (!normalized) continue;
      const dateKey = entryDateKey(normalized);
      if (!dateKey) continue;
      out[dateKey] = [...(out[dateKey] ?? []), normalized];
    }
  }
  const sorted: WorkoutHistoryByDate = {};
  for (const [dateKey, entries] of Object.entries(out)) {
    sorted[dateKey] = entries.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }
  return sorted;
}

function safeRestByDate(data: unknown): RestFlagsByDate {
  const candidate =
    data && typeof data === "object" && !Array.isArray(data) && "restByDate" in data
      ? (data as { restByDate?: unknown }).restByDate
      : null;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
  const out: RestFlagsByDate = {};
  for (const [dateKey, flag] of Object.entries(candidate as Record<string, unknown>)) {
    if (flag) out[dateKey] = true;
  }
  return out;
}

function safeFinishedByDate(data: unknown): FinishedFlagsByDate {
  const candidate =
    data && typeof data === "object" && !Array.isArray(data) && "finishedByDate" in data
      ? (data as { finishedByDate?: unknown }).finishedByDate
      : null;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
  const out: FinishedFlagsByDate = {};
  for (const [dateKey, flag] of Object.entries(candidate as Record<string, unknown>)) {
    if (flag) out[dateKey] = true;
  }
  return out;
}

function groupHistoryByExercise(entriesByDate: WorkoutHistoryByDate): Record<string, WorkoutHistoryEntry[]> {
  const grouped: Record<string, WorkoutHistoryEntry[]> = {};
  for (const list of Object.values(entriesByDate)) {
    for (const entry of list) {
      grouped[entry.exerciseId] = [...(grouped[entry.exerciseId] ?? []), entry];
    }
  }
  for (const [exerciseId, list] of Object.entries(grouped)) {
    grouped[exerciseId] = list.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }
  return grouped;
}

function workoutEntrySignature(entry: WorkoutHistoryEntry): string {
  return `${entry.exerciseId}:${entry.submittedAt}:${entry.workoutDate ?? ""}`;
}

function mergeWorkoutHistoryByDate(
  existing: WorkoutHistoryByDate,
  incoming: WorkoutHistoryByDate
): WorkoutHistoryByDate {
  const merged: WorkoutHistoryByDate = {};
  const allDateKeys = new Set([...Object.keys(existing), ...Object.keys(incoming)]);

  for (const dateKey of allDateKeys) {
    const current = existing[dateKey] ?? [];
    const next = incoming[dateKey] ?? [];
    const seenWorkoutIds = new Set<string>();
    const seenSignatures = new Set<string>();
    const combined: WorkoutHistoryEntry[] = [];

    for (const entry of [...current, ...next]) {
      const signature = workoutEntrySignature(entry);
      if (seenWorkoutIds.has(entry.workoutId) || seenSignatures.has(signature)) continue;
      seenWorkoutIds.add(entry.workoutId);
      seenSignatures.add(signature);
      combined.push(entry);
    }

    if (combined.length > 0) {
      merged[dateKey] = combined.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    }
  }

  return merged;
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

export function WorkoutHistoryProvider({ children }: { children: ReactNode }) {
  const [entriesByDate, setEntriesByDate] = useState<WorkoutHistoryByDate>({});
  const [restByDate, setRestByDate] = useState<RestFlagsByDate>({});
  const [finishedByDate, setFinishedByDate] = useState<FinishedFlagsByDate>({});
  /** After localStorage has been read and applied — avoids saving {} before hydrate. */
  const [storageHydrated, setStorageHydrated] = useState(false);
  const historyByExerciseId = useMemo(
    () => groupHistoryByExercise(entriesByDate),
    [entriesByDate]
  );

  useEffect(() => {
    const loaded = loadClientWorkoutHistory();
    setEntriesByDate(safeHistoryByDate(loaded));
    setRestByDate(safeRestByDate(loaded));
    setFinishedByDate(safeFinishedByDate(loaded));
    setStorageHydrated(true);
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    const payload: WorkoutHistoryStore = { byDate: entriesByDate, restByDate, finishedByDate };
    saveClientWorkoutHistory(payload);
  }, [entriesByDate, restByDate, finishedByDate, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated) return;

    const hydrateSupabaseWorkouts = async () => {
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser();

        if (!user) return;

        const { data, error } = await supabase
          .from("workouts")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });

        if (error) {
          console.error("Supabase workout fetch error:", error);
          return;
        }

        console.log("Supabase workouts fetched:", data?.length ?? 0);
        if (!data || data.length === 0) return;

        const remoteByDate: WorkoutHistoryByDate = {};

        for (const row of data as SupabaseWorkoutRow[]) {
          const raw = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          const normalized = normalizeWorkoutEntry(
            raw as Partial<WorkoutHistoryEntry>,
            typeof row.date === "string" ? row.date : undefined
          );
          if (!normalized) continue;
          const dateKey =
            typeof row.date === "string" && row.date.trim() !== ""
              ? row.date
              : entryDateKey(normalized);
          if (!dateKey) continue;
          remoteByDate[dateKey] = [...(remoteByDate[dateKey] ?? []), normalized];
        }

        setEntriesByDate((previous) => {
          const merged = mergeWorkoutHistoryByDate(previous, remoteByDate);
          console.log("Hydrated workout date keys:", Object.keys(merged));
          return merged;
        });
      } catch (error) {
        console.error("Supabase workout hydration failed:", error);
      }
    };

    void hydrateSupabaseWorkouts();
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        void hydrateSupabaseWorkouts();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [storageHydrated]);

  /** Resolves the Supabase row primary key for a local workout, matching `data.workoutId`. */
  const findSupabaseWorkoutRowId = useCallback(async (userId: string, workoutId: string) => {
    const { data: rows, error } = await supabase
      .from("workouts")
      .select("id,data")
      .eq("user_id", userId);

    if (error) {
      console.error("Supabase workout lookup failed:", {
        message: (error as { message?: string }).message,
        code: (error as { code?: string }).code
      });
      return null;
    }

    const matched = (rows as SupabaseWorkoutRow[] | null | undefined)?.find((row) => {
      let payload: unknown = row.data;
      if (typeof row.data === "string") {
        try {
          payload = JSON.parse(row.data);
        } catch {
          payload = null;
        }
      }
      const candidate =
        payload &&
        typeof payload === "object" &&
        "workoutId" in payload &&
        typeof (payload as { workoutId?: unknown }).workoutId === "string"
          ? (payload as { workoutId: string }).workoutId
          : "";
      return candidate === workoutId;
    });

    return matched?.id != null ? String(matched.id) : null;
  }, []);

  const syncUpdatedWorkoutToSupabase = useCallback(
    async (entry: WorkoutHistoryEntry) => {
      const pendingItem = {
        type: "workout" as const,
        action: "update" as const,
        payload: { workoutId: entry.workoutId, entry }
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        addPendingSyncItem(pendingItem);
        return;
      }
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (!user) return;

        const rowId = await findSupabaseWorkoutRowId(user.id, entry.workoutId);
        if (!rowId) {
          console.warn("No Supabase row found for workoutId", entry.workoutId);
          addPendingSyncItem(pendingItem);
          return;
        }

        const { error } = await supabase
          .from("workouts")
          .update({ data: entry })
          .eq("id", rowId)
          .eq("user_id", user.id);

        if (error) {
          console.error("Supabase workout update failed", error);
          addPendingSyncItem(pendingItem);
        }
      } catch (error) {
        console.error("Supabase workout update failed", error);
        addPendingSyncItem(pendingItem);
      }
    },
    [findSupabaseWorkoutRowId]
  );

  const syncDeletedWorkoutToSupabase = useCallback(
    async (workoutId: string) => {
      if (removePendingInsertForEntity("workout", workoutId)) {
        console.log("Pending insert removed because item was deleted before sync", {
          type: "workout",
          workoutId
        });
        return;
      }

      const pendingItem = {
        type: "workout" as const,
        action: "delete" as const,
        payload: { workoutId }
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        console.log("Pending delete queued", { type: "workout", workoutId });
        addPendingSyncItem(pendingItem);
        return;
      }
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (!user) return;

        const rowId = await findSupabaseWorkoutRowId(user.id, workoutId);
        if (!rowId) {
          console.warn("No Supabase row found for workoutId", workoutId);
          return;
        }

        const { error } = await supabase
          .from("workouts")
          .delete()
          .eq("id", rowId)
          .eq("user_id", user.id);

        if (error) {
          console.error("Supabase workout delete failed", error);
          console.log("Pending delete queued", { type: "workout", workoutId });
          addPendingSyncItem(pendingItem);
        }
      } catch (error) {
        console.error("Supabase workout delete failed", error);
        console.log("Pending delete queued", { type: "workout", workoutId });
        addPendingSyncItem(pendingItem);
      }
    },
    [findSupabaseWorkoutRowId]
  );

  const flushPendingWorkoutSync = useCallback(async () => {
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
      console.error("Pending sync flush failed:", { reason: error });
    }
  }, []);

  const flushPendingWorkoutSyncRef = useRef(flushPendingWorkoutSync);
  flushPendingWorkoutSyncRef.current = flushPendingWorkoutSync;

  useEffect(() => {
    console.log("WorkoutHistoryProvider pending flush effect mounted");
    const run = () => {
      void flushPendingWorkoutSyncRef.current();
    };
    run();
    queueMicrotask(run);
    setTimeout(run, 0);
    const onOnline = () => {
      console.log("Pending sync online event received");
      run();
    };
    window.addEventListener("online", onOnline);
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("Pending sync auth event received", {
        event,
        hasSession: Boolean(session)
      });
      run();
    });
    return () => {
      window.removeEventListener("online", onOnline);
      subscription.unsubscribe();
    };
  }, []);

  const addWorkout = useCallback((entry: WorkoutHistoryEntry) => {
    console.log("addWorkout mutation called");
    const normalized: WorkoutHistoryEntry = {
      ...entry,
      workoutId: entry.workoutId || `${entry.exerciseId}:${entry.submittedAt}`
    };
    setEntriesByDate((previous) => {
      const dateKey = entryDateKey(normalized);
      if (!dateKey) return previous;
      // Rest day and logged workouts are mutually exclusive; workout creation clears rest flag.
      setRestByDate((prevRest) => {
        if (!prevRest[dateKey]) return prevRest;
        const next = { ...prevRest };
        delete next[dateKey];
        return next;
      });
      return {
        ...previous,
        [dateKey]: [normalized, ...(previous[dateKey] ?? [])]
      };
    });
    void (async () => {
      const pendingItem = {
        type: "workout" as const,
        action: "insert" as const,
        payload: {
          workoutId: normalized.workoutId,
          date: normalized.workoutDate,
          entry: normalized
        }
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        console.log("Pending insert queued immediately because offline", {
          type: "workout",
          workoutId: normalized.workoutId
        });
        addPendingSyncItem(pendingItem);
        return;
      }
      try {
        const {
          data: { user },
          error: userError
        } = await supabase.auth.getUser();
        if (userError && isOfflineAuthFailure(userError)) {
          console.log("Pending insert queued immediately because offline", {
            type: "workout",
            workoutId: normalized.workoutId
          });
          addPendingSyncItem(pendingItem);
          return;
        }
        if (!user) return;
        const rowId = await findSupabaseWorkoutRowId(user.id, normalized.workoutId);
        if (rowId) {
          const { error } = await supabase
            .from("workouts")
            .update({ data: normalized, date: normalized.workoutDate })
            .eq("id", rowId)
            .eq("user_id", user.id);
          if (error) {
            addPendingSyncItem({
              ...pendingItem,
              action: "update"
            });
          }
          return;
        }
        const { error } = await supabase.from("workouts").insert({
          user_id: user.id,
          date: normalized.workoutDate,
          data: normalized
        });
        if (error) {
          addPendingSyncItem(pendingItem);
        }
      } catch {
        addPendingSyncItem(pendingItem);
      }
    })();
  }, [findSupabaseWorkoutRowId]);

  const isDateMarkedRest = useCallback(
    (date: string) => Boolean(restByDate[date]),
    [restByDate]
  );

  const setDateRestFlag = useCallback((date: string, isRest: boolean) => {
    if (isRest && (entriesByDate[date]?.length ?? 0) > 0) {
      // Guardrail: workout days cannot be marked as rest, and existing entries must be preserved.
      return;
    }
    if (isRest) {
      setFinishedByDate((previous) => {
        if (!previous[date]) return previous;
        const next = { ...previous };
        delete next[date];
        return next;
      });
    }
    setRestByDate((previous) => {
      if (isRest) {
        if (previous[date]) return previous;
        return { ...previous, [date]: true };
      }
      if (!previous[date]) return previous;
      const next = { ...previous };
      delete next[date];
      return next;
    });
  }, [entriesByDate]);

  const listRestDates = useCallback(
    () => Object.keys(restByDate).sort(),
    [restByDate]
  );

  const isDateFinished = useCallback(
    (date: string) => Boolean(finishedByDate[date]),
    [finishedByDate]
  );

  const setDateFinishedFlag = useCallback((date: string, isFinished: boolean) => {
    setFinishedByDate((previous) => {
      if (isFinished) {
        if (previous[date]) return previous;
        return { ...previous, [date]: true };
      }
      if (!previous[date]) return previous;
      const next = { ...previous };
      delete next[date];
      return next;
    });
  }, []);

  const listFinishedDates = useCallback(
    () => Object.keys(finishedByDate).sort(),
    [finishedByDate]
  );

  /** Removes specific logged sessions for a calendar day only; does not remove exercises or other dates. */
  const removeWorkoutsFromDate = useCallback((dateKey: string, workoutIds: string[]) => {
    console.log("removeWorkoutsFromDate mutation called");
    if (workoutIds.length === 0) return;
    const toRemove = new Set(workoutIds);
    const currentList = entriesByDate[dateKey] ?? [];
    const removedIds = currentList
      .filter((entry) => toRemove.has(entry.workoutId))
      .map((entry) => entry.workoutId);
    if (removedIds.length === 0) return;

    setEntriesByDate((previous) => {
      const list = previous[dateKey];
      if (!list) return previous;
      const nextList = list.filter((entry) => !toRemove.has(entry.workoutId));
      if (nextList.length === list.length) return previous;
      if (nextList.length === 0) {
        setFinishedByDate((prevFinished) => {
          if (!prevFinished[dateKey]) return prevFinished;
          const nextFinished = { ...prevFinished };
          delete nextFinished[dateKey];
          return nextFinished;
        });
      }
      if (nextList.length === 0) {
        const rest = { ...previous };
        delete rest[dateKey];
        return rest;
      }
      return { ...previous, [dateKey]: nextList };
    });

    for (const workoutId of removedIds) {
      void syncDeletedWorkoutToSupabase(workoutId);
    }
  }, [entriesByDate, syncDeletedWorkoutToSupabase]);

  const getWorkoutsByDate = useCallback(
    (date: string) => entriesByDate[date] ?? [],
    [entriesByDate]
  );

  const updateWorkoutEntry = useCallback(
    (workoutId: string, updater: (entry: WorkoutHistoryEntry) => WorkoutHistoryEntry) => {
      console.log("updateWorkoutEntry mutation called");
      let updatedEntry: WorkoutHistoryEntry | null = null;
      setEntriesByDate((previous) => {
        let changed = false;
        const next: WorkoutHistoryByDate = {};
        for (const [dateKey, entries] of Object.entries(previous)) {
          next[dateKey] = entries.map((entry) => {
            if (entry.workoutId !== workoutId) return entry;
            changed = true;
            const updated = updater(entry);
            updatedEntry = {
              ...updated,
              workoutId: updated.workoutId || `${updated.exerciseId}:${updated.submittedAt}`
            };
            return updatedEntry;
          });
        }
        return changed ? next : previous;
      });
      if (updatedEntry) {
        void syncUpdatedWorkoutToSupabase(updatedEntry);
      }
    },
    [syncUpdatedWorkoutToSupabase]
  );

  const updateLatestWorkout = useCallback(
    (exerciseId: string, submittedAt: string, updater: (entry: WorkoutHistoryEntry) => WorkoutHistoryEntry) => {
      const target = historyByExerciseId[exerciseId]?.find((entry) => entry.submittedAt === submittedAt);
      if (!target) return;
      updateWorkoutEntry(target.workoutId, updater);
    },
    [historyByExerciseId, updateWorkoutEntry]
  );

  const clearWorkoutHistory = useCallback(() => {
    setEntriesByDate({});
    setRestByDate({});
    setFinishedByDate({});
  }, []);

  return (
    <WorkoutHistoryContext.Provider
      value={{
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
        updateLatestWorkout,
        clearWorkoutHistory
      }}
    >
      {children}
    </WorkoutHistoryContext.Provider>
  );
}

export function useWorkoutHistory() {
  const context = useContext(WorkoutHistoryContext);
  if (!context) {
    throw new Error("useWorkoutHistory must be used within a WorkoutHistoryProvider");
  }
  return context;
}
