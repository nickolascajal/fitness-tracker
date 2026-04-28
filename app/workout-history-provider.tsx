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
  loadPendingSyncQueue,
  removePendingInsertForEntity
} from "@/lib/pendingSync";
import { getUserForPendingSync } from "@/lib/pendingSyncAuth";
import { supabase } from "@/lib/supabaseClient";

export type WorkoutSetSnapshot = {
  weight: string;
  reps: string;
  /** Numeric duration; may be `""` on drafts while the user has not entered a value yet. */
  timeSeconds?: number | string;
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

type RestDayMarkerPayload = {
  calendarMarker: "rest_day";
  date: string;
};

function parseRestDayMarkerPayload(payload: unknown): RestDayMarkerPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (row.calendarMarker !== "rest_day") return null;
  if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
  return { calendarMarker: "rest_day", date: row.date };
}

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
        const raw = s?.timeSeconds;
        if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
          return raw;
        }
        if (typeof raw === "string") {
          const t = raw.trim();
          if (t === "") return "";
          const n = Number(t);
          return Number.isFinite(n) && n >= 0 ? n : 0;
        }
        // Backward compatibility for legacy `time` string snapshots.
        if (typeof (s as { time?: unknown })?.time === "string") {
          const parsed = Number((s as { time?: string }).time ?? "");
          return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        }
        return "";
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

function buildPendingWorkoutOverlay(
  previous: WorkoutHistoryByDate
): { overlay: WorkoutHistoryByDate; deletedIds: Set<string> } {
  const pending = loadPendingSyncQueue().filter((item) => item.type === "workout");
  const keepIds = new Set<string>();
  const deleteIds = new Set<string>();
  const payloadEntries = new Map<string, WorkoutHistoryEntry>();

  for (const item of pending) {
    const payload = item.payload as {
      workoutId?: string;
      entry?: WorkoutHistoryEntry;
      data?: WorkoutHistoryEntry;
    };
    const workoutId =
      typeof payload?.workoutId === "string"
        ? payload.workoutId
        : typeof payload?.entry?.workoutId === "string"
          ? payload.entry.workoutId
          : typeof payload?.data?.workoutId === "string"
            ? payload.data.workoutId
            : "";
    if (!workoutId) continue;
    if (item.action === "delete") {
      deleteIds.add(workoutId);
      keepIds.delete(workoutId);
      payloadEntries.delete(workoutId);
      continue;
    }
    if (item.action === "insert" || item.action === "update") {
      keepIds.add(workoutId);
      const entry = payload.entry ?? payload.data;
      if (entry) {
        payloadEntries.set(workoutId, entry);
      }
    }
  }

  const overlay: WorkoutHistoryByDate = {};
  for (const workoutId of keepIds) {
    const entryFromPayload = payloadEntries.get(workoutId);
    if (entryFromPayload) {
      const key = entryDateKey(entryFromPayload);
      if (!key) continue;
      overlay[key] = [...(overlay[key] ?? []), entryFromPayload];
      continue;
    }
    for (const [dateKey, entries] of Object.entries(previous)) {
      const matched = entries.find((entry) => entry.workoutId === workoutId);
      if (!matched) continue;
      overlay[dateKey] = [...(overlay[dateKey] ?? []), matched];
      break;
    }
  }

  return { overlay, deletedIds: deleteIds };
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

        const remoteByDate: WorkoutHistoryByDate = {};
        const remoteRestByDate: RestFlagsByDate = {};
        for (const row of (data as SupabaseWorkoutRow[] | null | undefined) ?? []) {
          try {
            const raw = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
            const restMarker = parseRestDayMarkerPayload(raw);
            if (restMarker) {
              const markerDate =
                restMarker.date ||
                (typeof row.date === "string" && row.date.trim() !== "" ? row.date : "");
              if (markerDate) {
                remoteRestByDate[markerDate] = true;
              }
              continue;
            }
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
          } catch {
            // ignore malformed remote row payloads
          }
        }
        setRestByDate(remoteRestByDate);

        setEntriesByDate((previous) => {
          const { overlay, deletedIds } = buildPendingWorkoutOverlay(previous);
          const remoteFiltered: WorkoutHistoryByDate = {};
          for (const [dateKey, entries] of Object.entries(remoteByDate)) {
            const kept = entries.filter((entry) => !deletedIds.has(entry.workoutId));
            if (kept.length > 0) {
              remoteFiltered[dateKey] = kept;
            }
          }
          const replaced = mergeWorkoutHistoryByDate(remoteFiltered, overlay);
          return replaced;
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

  /** Resolves the Supabase row primary key for a local workout, matching `data.workoutId` or fallback `data.id`. */
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
      const candidateWorkoutId =
        payload &&
        typeof payload === "object" &&
        "workoutId" in payload &&
        typeof (payload as { workoutId?: unknown }).workoutId === "string"
          ? (payload as { workoutId: string }).workoutId
          : "";
      const candidateId =
        payload &&
        typeof payload === "object" &&
        "id" in payload &&
        typeof (payload as { id?: unknown }).id === "string"
          ? (payload as { id: string }).id
          : "";
      return candidateWorkoutId === workoutId || candidateId === workoutId;
    });

    return matched?.id != null ? String(matched.id) : null;
  }, []);

  const syncWorkoutUpsertToSupabase = useCallback(
    async (userId: string, entry: WorkoutHistoryEntry): Promise<boolean> => {
      const rowId = await findSupabaseWorkoutRowId(userId, entry.workoutId);
      if (rowId) {
        const { error } = await supabase
          .from("workouts")
          .update({ data: entry, date: entry.workoutDate })
          .eq("id", rowId)
          .eq("user_id", userId);
        if (error) return false;
        return true;
      }

      const { error } = await supabase.from("workouts").insert({
        user_id: userId,
        date: entry.workoutDate,
        data: entry
      });
      if (error) return false;
      return true;
    },
    [findSupabaseWorkoutRowId]
  );

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

        const ok = await syncWorkoutUpsertToSupabase(user.id, entry);
        if (!ok) {
          console.error("Supabase workout update/upsert failed");
          addPendingSyncItem(pendingItem);
        }
      } catch (error) {
        console.error("Supabase workout update failed", error);
        addPendingSyncItem(pendingItem);
      }
    },
    [syncWorkoutUpsertToSupabase]
  );

  const syncDeletedWorkoutToSupabase = useCallback(
    async (workoutId: string) => {
      const removedPendingInsert = removePendingInsertForEntity("workout", workoutId);

      const pendingItem = {
        type: "workout" as const,
        action: "delete" as const,
        payload: { workoutId }
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        if (!removedPendingInsert) {
          addPendingSyncItem(pendingItem);
        }
        return;
      }
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (!user) return;

        const rowId = await findSupabaseWorkoutRowId(user.id, workoutId);
        if (!rowId) {
          return;
        }

        const { error } = await supabase
          .from("workouts")
          .delete()
          .eq("id", rowId)
          .eq("user_id", user.id);

        if (error) {
          console.error("Supabase workout delete failed", error);
          if (!removedPendingInsert) {
            addPendingSyncItem(pendingItem);
          }
          return;
        }
      } catch (error) {
        console.error("Supabase workout delete failed", error);
        if (!removedPendingInsert) {
          addPendingSyncItem(pendingItem);
        }
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
    const run = () => {
      void flushPendingWorkoutSyncRef.current();
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

  const addWorkout = useCallback((entry: WorkoutHistoryEntry) => {
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
        addPendingSyncItem(pendingItem);
        return;
      }
      try {
        const {
          data: { user },
          error: userError
        } = await supabase.auth.getUser();
        if (userError && isOfflineAuthFailure(userError)) {
          addPendingSyncItem(pendingItem);
          return;
        }
        if (!user) return;
        const ok = await syncWorkoutUpsertToSupabase(user.id, normalized);
        if (!ok) {
          addPendingSyncItem(pendingItem);
        }
      } catch {
        addPendingSyncItem(pendingItem);
      }
    })();
  }, [syncWorkoutUpsertToSupabase]);

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

    void (async () => {
      const pendingItem = {
        type: "workout" as const,
        action: "delete" as const,
        payload: { all: true }
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        addPendingSyncItem(pendingItem);
        return;
      }
      try {
        const {
          data: { session }
        } = await supabase.auth.getSession();
        const {
          data: { user },
          error: userError
        } = await supabase.auth.getUser();
        if (userError && isOfflineAuthFailure(userError)) {
          addPendingSyncItem(pendingItem);
          return;
        }
        const activeUserId = session?.user?.id ?? user?.id ?? "";
        if (!activeUserId) return;
        const { error } = await supabase.from("workouts").delete().eq("user_id", activeUserId);
        if (error) {
          console.error("Clear all Supabase workouts failed", error);
          addPendingSyncItem(pendingItem);
          return;
        }
      } catch (error) {
        console.error("Clear all Supabase workouts failed", error);
        addPendingSyncItem(pendingItem);
      }
    })();
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

/**
 * Data mutation architecture rule:
 * - New workout-data features must call provider mutations (e.g. addWorkout/updateWorkoutEntry/removeWorkoutsFromDate).
 * - Do not call Supabase workout table writes directly from UI/page components.
 * - Do not write workout history/localStorage directly from UI components.
 */
export function useWorkoutHistory() {
  const context = useContext(WorkoutHistoryContext);
  if (!context) {
    throw new Error("useWorkoutHistory must be used within a WorkoutHistoryProvider");
  }
  return context;
}
