/**
 * Browser-only JSON persistence for fitness-tracker.
 * Safe defaults when localStorage is empty, missing, or invalid.
 */

export const STORAGE_KEYS = {
  clients: "fitness-tracker:clients",
  activeClientId: "fitness-tracker:activeClientId",
  exercises: "fitness-tracker:exercises",
  workoutHistory: "fitness-tracker:workoutHistory",
  pendingSync: "fitness-tracker-pending-sync"
} as const;

export const DEFAULT_LOCAL_CLIENT_ID = "local-client";
export const DEFAULT_LOCAL_CLIENT_NAME = "Local Client";

type StoredClientRecord = {
  id: string;
  name: string;
  exercises: unknown[];
  presets?: unknown[];
  workoutHistory: Record<string, unknown[]>;
};

type StoredClientsPayload = {
  clients: Record<string, StoredClientRecord>;
};

export type FitnessTrackerBackup = {
  version: 1;
  exportedAt: string;
  clients: StoredClientsPayload["clients"];
  activeClientId: string;
  /** Convenience mirrors for active client data (display/inspection only). */
  exercises: unknown[];
  workoutHistory: unknown;
  presets: unknown[];
  restByDate: Record<string, true>;
  finishedByDate: Record<string, true>;
};

export function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw === "") return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode, quota, or disabled storage — ignore
  }
}

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

function safePendingSyncQueue(data: unknown): PendingSyncItem[] {
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is PendingSyncItem => {
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
  return safePendingSyncQueue(loadJson<unknown>(STORAGE_KEYS.pendingSync, []));
}

export function savePendingSyncQueue(items: PendingSyncItem[]): void {
  if (typeof window === "undefined") return;
  if (items.length === 0) {
    try {
      window.localStorage.removeItem(STORAGE_KEYS.pendingSync);
    } catch {
      // ignore
    }
  } else {
    saveJson(STORAGE_KEYS.pendingSync, items);
  }
  emitPendingSyncUpdated();
}

export function updatePendingSyncQueue(
  updater: (items: PendingSyncItem[]) => PendingSyncItem[]
): PendingSyncItem[] {
  const next = updater(loadPendingSyncQueue());
  savePendingSyncQueue(next);
  return next;
}

export function enqueuePendingSyncItem(
  item: Omit<PendingSyncItem, "id" | "createdAt" | "retryCount">
): PendingSyncItem {
  const nextItem: PendingSyncItem = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    retryCount: 0,
    ...item
  };
  updatePendingSyncQueue((existing) => [...existing, nextItem]);
  return nextItem;
}

export function resolvePendingSyncItem(id: string): void {
  updatePendingSyncQueue((items) => items.filter((item) => item.id !== id));
}

export function incrementPendingSyncRetry(id: string): void {
  updatePendingSyncQueue((items) =>
    items.map((item) =>
      item.id === id
        ? {
            ...item,
            retryCount: item.retryCount + 1
          }
        : item
    )
  );
}

export function getPendingSyncCount(): number {
  return loadPendingSyncQueue().length;
}

function safeRecordTrueFlags(input: unknown): Record<string, true> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, true> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v) out[k] = true;
  }
  return out;
}

function emptyClientRecord(id: string, name: string): StoredClientRecord {
  return {
    id,
    name,
    exercises: [],
    presets: [],
    workoutHistory: {}
  };
}

function buildDefaultClientsPayload(): StoredClientsPayload {
  return {
    clients: {
      [DEFAULT_LOCAL_CLIENT_ID]: emptyClientRecord(DEFAULT_LOCAL_CLIENT_ID, DEFAULT_LOCAL_CLIENT_NAME)
    }
  };
}

function safeClientsPayload(input: unknown): StoredClientsPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return buildDefaultClientsPayload();
  }
  const rawClients = (input as { clients?: unknown }).clients;
  if (!rawClients || typeof rawClients !== "object" || Array.isArray(rawClients)) {
    return buildDefaultClientsPayload();
  }

  const normalizedClients: Record<string, StoredClientRecord> = {};
  for (const [key, value] of Object.entries(rawClients as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Partial<StoredClientRecord>;
    const id = typeof record.id === "string" && record.id.trim() ? record.id : key;
    const name =
      typeof record.name === "string" && record.name.trim() ? record.name : DEFAULT_LOCAL_CLIENT_NAME;
    normalizedClients[id] = {
      id,
      name,
      exercises: Array.isArray(record.exercises) ? record.exercises : [],
      presets: Array.isArray(record.presets) ? record.presets : [],
      workoutHistory:
        record.workoutHistory && typeof record.workoutHistory === "object" && !Array.isArray(record.workoutHistory)
          ? (record.workoutHistory as Record<string, unknown[]>)
          : {}
    };
  }

  if (Object.keys(normalizedClients).length === 0) {
    return buildDefaultClientsPayload();
  }

  return { clients: normalizedClients };
}

function resolveActiveClientId(payload: StoredClientsPayload): string {
  const stored = loadJson<string | null>(STORAGE_KEYS.activeClientId, null);
  if (stored && payload.clients[stored]) return stored;
  if (payload.clients[DEFAULT_LOCAL_CLIENT_ID]) return DEFAULT_LOCAL_CLIENT_ID;
  const [firstClientId] = Object.keys(payload.clients);
  return firstClientId;
}

function readClientsPayload(): { payload: StoredClientsPayload; activeClientId: string } {
  const payload = safeClientsPayload(loadJson<unknown>(STORAGE_KEYS.clients, buildDefaultClientsPayload()));
  const activeClientId = resolveActiveClientId(payload);
  if (!payload.clients[activeClientId]) {
    payload.clients[activeClientId] = emptyClientRecord(activeClientId, DEFAULT_LOCAL_CLIENT_NAME);
  }
  return { payload, activeClientId };
}

export function createBackupSnapshot(): FitnessTrackerBackup {
  migrateLegacySingleUserDataIfNeeded();
  const { payload, activeClientId } = readClientsPayload();
  const activeClient = payload.clients[activeClientId] ?? emptyClientRecord(activeClientId, DEFAULT_LOCAL_CLIENT_NAME);
  const workoutHistory =
    activeClient.workoutHistory && typeof activeClient.workoutHistory === "object"
      ? activeClient.workoutHistory
      : {};
  const restByDate = safeRecordTrueFlags((workoutHistory as { restByDate?: unknown }).restByDate);
  const finishedByDate = safeRecordTrueFlags((workoutHistory as { finishedByDate?: unknown }).finishedByDate);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    clients: payload.clients,
    activeClientId,
    exercises: Array.isArray(activeClient.exercises) ? activeClient.exercises : [],
    workoutHistory,
    presets: Array.isArray(activeClient.presets) ? activeClient.presets : [],
    restByDate,
    finishedByDate
  };
}

export function validateBackupSnapshot(input: unknown): { valid: boolean; reason?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, reason: "Backup file must be a JSON object." };
  }
  const candidate = input as Partial<FitnessTrackerBackup>;
  if (!candidate.clients || typeof candidate.clients !== "object" || Array.isArray(candidate.clients)) {
    return { valid: false, reason: "Missing or invalid `clients` payload." };
  }
  if (typeof candidate.activeClientId !== "string" || candidate.activeClientId.trim() === "") {
    return { valid: false, reason: "Missing or invalid `activeClientId`." };
  }
  const active = (candidate.clients as Record<string, unknown>)[candidate.activeClientId];
  if (!active || typeof active !== "object" || Array.isArray(active)) {
    return { valid: false, reason: "Active client record is missing from `clients`." };
  }
  return { valid: true };
}

export function restoreBackupSnapshot(input: unknown): { ok: boolean; reason?: string } {
  const validation = validateBackupSnapshot(input);
  if (!validation.valid) return { ok: false, reason: validation.reason };
  const candidate = input as FitnessTrackerBackup;
  const payload = safeClientsPayload({ clients: candidate.clients });
  const activeClientId = payload.clients[candidate.activeClientId]
    ? candidate.activeClientId
    : (Object.keys(payload.clients)[0] ?? DEFAULT_LOCAL_CLIENT_ID);

  persistClientsPayload(payload, activeClientId);
  const active = payload.clients[activeClientId] ?? emptyClientRecord(activeClientId, DEFAULT_LOCAL_CLIENT_NAME);
  // Keep legacy keys in sync for backward compatibility with older data paths.
  saveJson(STORAGE_KEYS.exercises, Array.isArray(active.exercises) ? active.exercises : []);
  saveJson(STORAGE_KEYS.workoutHistory, active.workoutHistory ?? {});
  return { ok: true };
}

function persistClientsPayload(payload: StoredClientsPayload, activeClientId: string): void {
  saveJson(STORAGE_KEYS.clients, payload);
  saveJson(STORAGE_KEYS.activeClientId, activeClientId);
}

/**
 * One-time migration path:
 * if client storage is empty, lift legacy single-user keys into default local client.
 */
function migrateLegacySingleUserDataIfNeeded(): void {
  const existingClients = loadJson<unknown>(STORAGE_KEYS.clients, null);
  if (existingClients !== null) return;

  const legacyExercises = loadJson<unknown[]>(STORAGE_KEYS.exercises, []);
  const legacyWorkoutHistory = loadJson<Record<string, unknown[]>>(STORAGE_KEYS.workoutHistory, {});
  const payload = buildDefaultClientsPayload();
  payload.clients[DEFAULT_LOCAL_CLIENT_ID] = {
    id: DEFAULT_LOCAL_CLIENT_ID,
    name: DEFAULT_LOCAL_CLIENT_NAME,
    exercises: Array.isArray(legacyExercises) ? legacyExercises : [],
    presets: [],
    workoutHistory:
      legacyWorkoutHistory && typeof legacyWorkoutHistory === "object" && !Array.isArray(legacyWorkoutHistory)
        ? legacyWorkoutHistory
        : {}
  };
  persistClientsPayload(payload, DEFAULT_LOCAL_CLIENT_ID);
}

export function loadClientExercises(): unknown[] {
  migrateLegacySingleUserDataIfNeeded();
  const { payload, activeClientId } = readClientsPayload();
  persistClientsPayload(payload, activeClientId);
  return payload.clients[activeClientId]?.exercises ?? [];
}

export function saveClientExercises(exercises: unknown[]): void {
  migrateLegacySingleUserDataIfNeeded();
  const { payload, activeClientId } = readClientsPayload();
  const current = payload.clients[activeClientId] ?? emptyClientRecord(activeClientId, DEFAULT_LOCAL_CLIENT_NAME);
  payload.clients[activeClientId] = { ...current, exercises: Array.isArray(exercises) ? exercises : [] };
  persistClientsPayload(payload, activeClientId);
}

export function loadClientWorkoutHistory(): unknown {
  migrateLegacySingleUserDataIfNeeded();
  const { payload, activeClientId } = readClientsPayload();
  persistClientsPayload(payload, activeClientId);
  return payload.clients[activeClientId]?.workoutHistory ?? {};
}

export function loadClientWorkoutPresets(): unknown[] {
  migrateLegacySingleUserDataIfNeeded();
  const { payload, activeClientId } = readClientsPayload();
  persistClientsPayload(payload, activeClientId);
  return payload.clients[activeClientId]?.presets ?? [];
}

export function saveClientWorkoutPresets(presets: unknown[]): void {
  migrateLegacySingleUserDataIfNeeded();
  const { payload, activeClientId } = readClientsPayload();
  const current = payload.clients[activeClientId] ?? emptyClientRecord(activeClientId, DEFAULT_LOCAL_CLIENT_NAME);
  payload.clients[activeClientId] = {
    ...current,
    presets: Array.isArray(presets) ? presets : []
  };
  persistClientsPayload(payload, activeClientId);
}

export function saveClientWorkoutHistory(workoutHistory: unknown): void {
  migrateLegacySingleUserDataIfNeeded();
  const { payload, activeClientId } = readClientsPayload();
  const current = payload.clients[activeClientId] ?? emptyClientRecord(activeClientId, DEFAULT_LOCAL_CLIENT_NAME);
  payload.clients[activeClientId] = {
    ...current,
    workoutHistory:
      workoutHistory && typeof workoutHistory === "object" && !Array.isArray(workoutHistory)
        ? (workoutHistory as Record<string, unknown[]>)
        : {}
  };
  persistClientsPayload(payload, activeClientId);
}

/** Removes both app keys. Usually not needed if state is cleared (effects save `[]` / `{}`). */
export function removeAllFitnessKeys(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEYS.clients);
    window.localStorage.removeItem(STORAGE_KEYS.activeClientId);
    window.localStorage.removeItem(STORAGE_KEYS.exercises);
    window.localStorage.removeItem(STORAGE_KEYS.workoutHistory);
  } catch {
    // ignore
  }
}
