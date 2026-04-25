import type { SupabaseClient } from "@supabase/supabase-js";
import { STORAGE_KEYS, loadJson, saveJson } from "@/lib/storage";

export type PendingSyncType = "workout" | "exercise" | "preset";
export type PendingSyncAction = "insert" | "update" | "delete";

export type PendingSyncItem = {
  id: string;
  type: PendingSyncType;
  action: PendingSyncAction;
  payload: unknown;
  createdAt: string;
  retryCount: number;
};

function emitPendingSyncUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("fitness-tracker:pending-sync-updated"));
}

function normalizeQueue(input: unknown): PendingSyncItem[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is PendingSyncItem => {
    if (!item || typeof item !== "object") return false;
    const row = item as Partial<PendingSyncItem>;
    return (
      typeof row.id === "string" &&
      (row.type === "workout" || row.type === "exercise" || row.type === "preset") &&
      (row.action === "insert" || row.action === "update" || row.action === "delete") &&
      typeof row.createdAt === "string" &&
      typeof row.retryCount === "number"
    );
  });
}

export function loadPendingSyncQueue(): PendingSyncItem[] {
  return normalizeQueue(loadJson<unknown>(STORAGE_KEYS.pendingSync, []));
}

export function savePendingSyncQueue(queue: PendingSyncItem[]): void {
  if (typeof window === "undefined") return;
  if (queue.length === 0) {
    try {
      window.localStorage.removeItem(STORAGE_KEYS.pendingSync);
    } catch {
      // ignore
    }
  } else {
    saveJson(STORAGE_KEYS.pendingSync, queue);
  }
  emitPendingSyncUpdated();
}

export function addPendingSyncItem(
  item: Omit<PendingSyncItem, "id" | "createdAt" | "retryCount">
): PendingSyncItem {
  const next: PendingSyncItem = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    retryCount: 0,
    ...item
  };
  const queue = loadPendingSyncQueue();
  savePendingSyncQueue([...queue, next]);
  console.log("Pending sync item queued", {
    id: next.id,
    type: next.type,
    action: next.action,
    retryCount: next.retryCount
  });
  return next;
}

function getEntityIdFromPayload(item: PendingSyncItem): string {
  const payload = item.payload as {
    workoutId?: string;
    exerciseId?: string;
    presetId?: string;
    entry?: { workoutId?: string };
    exercise?: { id?: string };
    preset?: { id?: string };
  };
  if (item.type === "workout") {
    return payload.workoutId ?? payload.entry?.workoutId ?? "";
  }
  if (item.type === "exercise") {
    return payload.exerciseId ?? payload.exercise?.id ?? "";
  }
  return payload.presetId ?? payload.preset?.id ?? "";
}

export function removePendingInsertForEntity(type: PendingSyncType, entityId: string): boolean {
  if (!entityId) return false;
  const queue = loadPendingSyncQueue();
  let removed = false;
  const next = queue.filter((item) => {
    if (item.type !== type || item.action !== "insert") return true;
    const candidate = getEntityIdFromPayload(item);
    if (candidate === entityId) {
      removed = true;
      return false;
    }
    return true;
  });
  if (removed) {
    savePendingSyncQueue(next);
  }
  return removed;
}

async function findRowIdByEntityId(
  supabase: SupabaseClient,
  table: "workouts" | "exercises" | "presets",
  userId: string,
  entityId: string
): Promise<string | null> {
  const { data, error } = await supabase.from(table).select("id,data").eq("user_id", userId);
  if (error) {
    throw new Error(`${table} lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ id?: string | number; data?: unknown }>;
  const matched = rows.find((row) => {
    let payload: unknown = row.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    if (!payload || typeof payload !== "object") return false;
    if (table === "workouts") {
      const workoutId = (payload as { workoutId?: unknown }).workoutId;
      const id = (payload as { id?: unknown }).id;
      return workoutId === entityId || id === entityId;
    }
    const id = (payload as { id?: unknown }).id;
    const presetId = (payload as { presetId?: unknown }).presetId;
    return id === entityId || presetId === entityId;
  });
  return matched?.id != null ? String(matched.id) : null;
}

async function processItem(supabase: SupabaseClient, userId: string, item: PendingSyncItem): Promise<"success" | "retry" | "stale"> {
  const payload = item.payload as {
    workoutId?: string;
    exerciseId?: string;
    presetId?: string;
    date?: string;
    entry?: Record<string, unknown>;
    exercise?: Record<string, unknown>;
    preset?: Record<string, unknown>;
    all?: boolean;
  };

  if (item.type === "workout") {
    const workoutId = payload.workoutId ?? (payload.entry?.workoutId as string | undefined) ?? "";
    if (!workoutId) return "stale";
    if (item.action === "insert") {
      const existingId = await findRowIdByEntityId(supabase, "workouts", userId, workoutId);
      if (existingId) {
        if (!payload.entry) return "stale";
        console.log("Workout sync existing row found — updating", { workoutId, rowId: existingId, id: item.id });
        const { error } = await supabase
          .from("workouts")
          .update({ data: payload.entry, date: payload.date })
          .eq("id", existingId)
          .eq("user_id", userId);
        if (error) return "retry";
        console.log("Workout sync duplicate prevention complete", { workoutId, action: "update", id: item.id });
        return "success";
      }
      if (!payload.entry) return "stale";
      console.log("Workout sync no row found — inserting", { workoutId, id: item.id });
      const rowDate = typeof payload.date === "string" ? payload.date : (payload.entry.workoutDate as string | undefined);
      const { error } = await supabase.from("workouts").insert({ user_id: userId, date: rowDate, data: payload.entry });
      if (error) return "retry";
      console.log("Workout sync duplicate prevention complete", { workoutId, action: "insert", id: item.id });
      return "success";
    }
    const rowId = await findRowIdByEntityId(supabase, "workouts", userId, workoutId);
    if (!rowId) {
      if (item.action === "update") {
        if (!payload.entry) return "stale";
        console.log("Workout sync no row found — inserting", { workoutId, id: item.id });
        const rowDate = typeof payload.date === "string" ? payload.date : (payload.entry.workoutDate as string | undefined);
        const { error } = await supabase.from("workouts").insert({ user_id: userId, date: rowDate, data: payload.entry });
        if (error) return "retry";
        console.log("Workout sync duplicate prevention complete", { workoutId, action: "insert", id: item.id });
        return "success";
      }
      if (item.action === "delete") {
        console.log("Workout delete resolved: remote row missing", { workoutId, id: item.id });
      }
      return "stale";
    }
    if (item.action === "update") {
      if (!payload.entry) return "stale";
      console.log("Workout sync existing row found — updating", { workoutId, rowId, id: item.id });
      const { error } = await supabase
        .from("workouts")
        .update({ data: payload.entry, date: payload.date })
        .eq("id", rowId)
        .eq("user_id", userId);
      if (error) return "retry";
      console.log("Workout sync duplicate prevention complete", { workoutId, action: "update", id: item.id });
      return "success";
    }
    if (item.action === "delete" && payload.all === true) {
      const { error } = await supabase.from("workouts").delete().eq("user_id", userId);
      return error ? "retry" : "success";
    }
    console.log("Workout delete remote row found", { workoutId, rowId, id: item.id });
    const { error } = await supabase.from("workouts").delete().eq("id", rowId).eq("user_id", userId);
    if (error) return "retry";
    console.log("Workout delete Supabase delete success", { workoutId, id: item.id });
    return "success";
  }

  if (item.type === "exercise") {
    const exerciseId = payload.exerciseId ?? (payload.exercise?.id as string | undefined) ?? "";
    if (item.action === "insert") {
      if (!exerciseId || !payload.exercise) return "stale";
      const existingId = await findRowIdByEntityId(supabase, "exercises", userId, exerciseId);
      if (existingId) return "success";
      const { error } = await supabase.from("exercises").insert({ user_id: userId, data: payload.exercise });
      return error ? "retry" : "success";
    }
    if (item.action === "update") {
      if (!exerciseId || !payload.exercise) return "stale";
      const rowId = await findRowIdByEntityId(supabase, "exercises", userId, exerciseId);
      if (!rowId) return "stale";
      const { error } = await supabase
        .from("exercises")
        .update({ data: payload.exercise })
        .eq("id", rowId)
        .eq("user_id", userId);
      return error ? "retry" : "success";
    }
    if (payload.all === true) {
      const { error } = await supabase.from("exercises").delete().eq("user_id", userId);
      return error ? "retry" : "success";
    }
    if (!exerciseId) return "stale";
    const rowId = await findRowIdByEntityId(supabase, "exercises", userId, exerciseId);
    if (!rowId) return "stale";
    const { error } = await supabase.from("exercises").delete().eq("id", rowId).eq("user_id", userId);
    return error ? "retry" : "success";
  }

  const presetId = payload.presetId ?? (payload.preset?.id as string | undefined) ?? "";
  if (item.action === "insert") {
    if (!presetId || !payload.preset) return "stale";
    const existingId = await findRowIdByEntityId(supabase, "presets", userId, presetId);
    if (existingId) return "success";
    const { error } = await supabase.from("presets").insert({ user_id: userId, data: payload.preset });
    return error ? "retry" : "success";
  }
  if (item.action === "update") {
    if (!presetId || !payload.preset) return "stale";
    const rowId = await findRowIdByEntityId(supabase, "presets", userId, presetId);
    if (!rowId) return "stale";
    const { error } = await supabase
      .from("presets")
      .update({ data: payload.preset })
      .eq("id", rowId)
      .eq("user_id", userId);
    return error ? "retry" : "success";
  }
  if (item.action === "delete" && payload.all === true) {
    const { error } = await supabase.from("presets").delete().eq("user_id", userId);
    return error ? "retry" : "success";
  }
  if (!presetId) return "stale";
  const rowId = await findRowIdByEntityId(supabase, "presets", userId, presetId);
  if (!rowId) return "stale";
  const { error } = await supabase.from("presets").delete().eq("id", rowId).eq("user_id", userId);
  return error ? "retry" : "success";
}

export async function flushPendingSyncQueue(supabase: SupabaseClient, userId: string): Promise<{ remaining: number }> {
  const queue = loadPendingSyncQueue().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  console.log("Pending sync flush started", { total: queue.length });
  const next: PendingSyncItem[] = [];

  for (const item of queue) {
    if (item.retryCount >= 10) {
      console.warn("Pending sync item removed from queue (max retries reached)", {
        id: item.id,
        type: item.type,
        action: item.action,
        retryCount: item.retryCount
      });
      continue;
    }
    try {
      const result = await processItem(supabase, userId, item);
      if (result === "success") {
        continue;
      }
      if (result === "stale") {
        console.log("Pending sync item removed from queue (stale payload)", {
          id: item.id,
          type: item.type,
          action: item.action,
          retryCount: item.retryCount
        });
        continue;
      }
      next.push({ ...item, retryCount: item.retryCount + 1 });
      console.error("Pending sync item failed", {
        id: item.id,
        type: item.type,
        action: item.action,
        retryCount: item.retryCount
      });
    } catch (error) {
      next.push({ ...item, retryCount: item.retryCount + 1 });
      console.error("Pending sync item failed", {
        id: item.id,
        type: item.type,
        action: item.action,
        retryCount: item.retryCount,
        reason: error
      });
    }
  }

  savePendingSyncQueue(next);
  console.log("Pending sync flush finished", { remaining: next.length });
  return { remaining: next.length };
}
