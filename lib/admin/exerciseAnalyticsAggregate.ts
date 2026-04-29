import { exerciseNameKey } from "@/lib/exerciseNameKey";
import { parseWorkoutEntryFromJson } from "@/lib/admin/parseWorkoutEntry";

export type AdminExerciseAnalyticsConfigStat = {
  fingerprint: string;
  setCount: number;
  targetReps: number;
  increment: number;
  unit: "lbs" | "kg";
  type: "weight" | "bodyweight" | "time";
  trackRir: boolean;
  trackRpe: boolean;
  foundation: number;
  /** Unique users who own this config and/or logged sessions attributed to it */
  userCount: number;
  sessionCount: number;
  cpsHigh: number | null;
  cpsLow: number | null;
  cpsAverage: number | null;
};

export type AdminExerciseAnalyticsNameStat = {
  nameKey: string;
  displayName: string;
  primaryType: "weight" | "bodyweight" | "time" | "mixed";
  userCount: number;
  sessionCount: number;
  cpsHigh: number | null;
  cpsLow: number | null;
  distinctConfigCount: number;
  configs: AdminExerciseAnalyticsConfigStat[];
};

export type AdminExerciseAnalyticsSnapshot = {
  generatedAt: string;
  rows: AdminExerciseAnalyticsNameStat[];
};

type ParsedExerciseConfig = {
  id: string;
  name: string;
  setCount: number;
  targetReps: number;
  increment: number;
  unit: "lbs" | "kg";
  type: "weight" | "bodyweight" | "time";
  foundation: number;
  trackRir: boolean;
  trackRpe: boolean;
};

type ExerciseRow = { user_id: string; data?: unknown };
type WorkoutRow = { user_id: string; data?: unknown };

const REST_DAY_MARKER = "rest_day";

function parseJsonField(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function isRestDayMarkerPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const row = payload as Record<string, unknown>;
  return row.calendarMarker === REST_DAY_MARKER;
}

function parseExerciseConfigFromData(data: unknown): ParsedExerciseConfig | null {
  const payload = parseJsonField(data);
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.setCount !== "number" ||
    typeof row.targetReps !== "number" ||
    typeof row.increment !== "number"
  ) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    setCount: row.setCount,
    targetReps: row.targetReps,
    increment: row.increment,
    unit: row.unit === "kg" ? "kg" : "lbs",
    type: row.type === "time" || row.type === "bodyweight" ? row.type : "weight",
    foundation: Number.isFinite(row.foundation) ? Number(row.foundation) : 0,
    trackRir: row.trackRir === true,
    trackRpe: row.trackRpe === true
  };
}

export function configFingerprint(cfg: ParsedExerciseConfig): string {
  return [
    cfg.type,
    cfg.setCount,
    cfg.targetReps,
    cfg.increment,
    cfg.unit,
    cfg.trackRir ? "1" : "0",
    cfg.trackRpe ? "1" : "0",
    Number.isFinite(cfg.foundation) ? cfg.foundation : 0
  ].join("|");
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Aggregates read-only exercise usage and CPS ranges across all users.
 * Intended for admin research (standardization / community benchmarks later).
 */
export function buildExerciseAnalyticsSnapshot(
  exerciseRows: ExerciseRow[],
  workoutRows: WorkoutRow[]
): AdminExerciseAnalyticsSnapshot {
  const userExerciseByKey = new Map<string, ParsedExerciseConfig>();
  const exercisesByUserAndNameKey = new Map<string, ParsedExerciseConfig[]>();

  const fingerprintMeta = new Map<string, ParsedExerciseConfig>();
  const configUsers = new Map<string, Set<string>>();
  const configSessions = new Map<string, number>();
  const configCpsValues = new Map<string, number[]>();

  const nameUsers = new Map<string, Set<string>>();
  const nameSessions = new Map<string, number>();
  const nameCpsValues = new Map<string, number[]>();
  const nameDisplayCounts = new Map<string, Map<string, number>>();
  const nameFingerprints = new Map<string, Set<string>>();

  const addDisplayName = (nameKey: string, display: string) => {
    const trimmed = display.trim();
    if (!trimmed) return;
    const m = nameDisplayCounts.get(nameKey) ?? new Map<string, number>();
    m.set(trimmed, (m.get(trimmed) ?? 0) + 1);
    nameDisplayCounts.set(nameKey, m);
  };

  const trackFingerprint = (fp: string, cfg: ParsedExerciseConfig) => {
    if (!fingerprintMeta.has(fp)) fingerprintMeta.set(fp, cfg);
    if (!nameFingerprints.has(exerciseNameKey(cfg.name))) {
      nameFingerprints.set(exerciseNameKey(cfg.name), new Set());
    }
    nameFingerprints.get(exerciseNameKey(cfg.name))!.add(fp);
  };

  for (const row of exerciseRows) {
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    if (!userId) continue;
    const cfg = parseExerciseConfigFromData(row.data);
    if (!cfg) continue;
    const key = `${userId}|${cfg.id}`;
    userExerciseByKey.set(key, cfg);
    const nk = exerciseNameKey(cfg.name);
    if (!nameUsers.has(nk)) nameUsers.set(nk, new Set());
    nameUsers.get(nk)!.add(userId);
    addDisplayName(nk, cfg.name);

    const list = exercisesByUserAndNameKey.get(`${userId}|${nk}`) ?? [];
    list.push(cfg);
    exercisesByUserAndNameKey.set(`${userId}|${nk}`, list);

    const fp = configFingerprint(cfg);
    trackFingerprint(fp, cfg);
    if (!configUsers.has(fp)) configUsers.set(fp, new Set());
    configUsers.get(fp)!.add(userId);
  }

  const resolveFingerprintForWorkout = (
    userId: string,
    exerciseId: string,
    workoutNameKey: string
  ): string | null => {
    const direct = userExerciseByKey.get(`${userId}|${exerciseId}`);
    if (direct) return configFingerprint(direct);
    const candidates = exercisesByUserAndNameKey.get(`${userId}|${workoutNameKey}`) ?? [];
    const fps = new Set(candidates.map((c) => configFingerprint(c)));
    if (fps.size === 1) return [...fps][0]!;
    return null;
  };

  for (const row of workoutRows) {
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    if (!userId) continue;
    const payload = parseJsonField(row.data);
    if (isRestDayMarkerPayload(payload)) continue;
    const parsed = parseWorkoutEntryFromJson(payload, null);
    if (!parsed) continue;
    if (parsed.isDraft === true) continue;
    if (parsed.sessionCps === null || !Number.isFinite(parsed.sessionCps)) continue;

    const cps = parsed.sessionCps;
    const nk = exerciseNameKey(parsed.exerciseName);
    addDisplayName(nk, parsed.exerciseName);

    if (!nameUsers.has(nk)) nameUsers.set(nk, new Set());
    nameUsers.get(nk)!.add(userId);
    nameSessions.set(nk, (nameSessions.get(nk) ?? 0) + 1);
    if (!nameCpsValues.has(nk)) nameCpsValues.set(nk, []);
    nameCpsValues.get(nk)!.push(cps);

    const fp = resolveFingerprintForWorkout(userId, parsed.exerciseId, nk);
    if (fp) {
      if (!configSessions.has(fp)) configSessions.set(fp, 0);
      configSessions.set(fp, (configSessions.get(fp) ?? 0) + 1);
      if (!configCpsValues.has(fp)) configCpsValues.set(fp, []);
      configCpsValues.get(fp)!.push(cps);
      if (!configUsers.has(fp)) configUsers.set(fp, new Set());
      configUsers.get(fp)!.add(userId);
    }
  }

  const nameKeys = new Set<string>([
    ...nameUsers.keys(),
    ...nameFingerprints.keys(),
    ...nameSessions.keys()
  ]);

  const rows: AdminExerciseAnalyticsNameStat[] = [];

  for (const nk of nameKeys) {
    const fpSet = nameFingerprints.get(nk) ?? new Set<string>();
    const sessions = nameSessions.get(nk) ?? 0;
    const users = nameUsers.get(nk) ?? new Set<string>();
    const cpsList = nameCpsValues.get(nk) ?? [];
    const cpsHigh = cpsList.length ? Math.max(...cpsList) : null;
    const cpsLow = cpsList.length ? Math.min(...cpsList) : null;

    const displayMap = nameDisplayCounts.get(nk) ?? new Map<string, number>();
    let displayName = nk;
    let bestCount = -1;
    for (const [label, count] of displayMap.entries()) {
      if (count > bestCount || (count === bestCount && label.localeCompare(displayName) < 0)) {
        bestCount = count;
        displayName = label;
      }
    }
    if (bestCount < 0) {
      const meta = [...fpSet].map((fp) => fingerprintMeta.get(fp)).find(Boolean);
      if (meta) displayName = meta.name;
    }

    const configs: AdminExerciseAnalyticsConfigStat[] = [...fpSet].map((fp) => {
      const meta = fingerprintMeta.get(fp);
      const sessionCount = configSessions.get(fp) ?? 0;
      const cpsVals = configCpsValues.get(fp) ?? [];
      const usersForConfig = configUsers.get(fp) ?? new Set<string>();
      return {
        fingerprint: fp,
        setCount: meta?.setCount ?? 0,
        targetReps: meta?.targetReps ?? 0,
        increment: meta?.increment ?? 0,
        unit: meta?.unit ?? "lbs",
        type: meta?.type ?? "weight",
        trackRir: meta?.trackRir ?? false,
        trackRpe: meta?.trackRpe ?? false,
        foundation: meta?.foundation ?? 0,
        userCount: usersForConfig.size,
        sessionCount,
        cpsHigh: cpsVals.length ? Math.max(...cpsVals) : null,
        cpsLow: cpsVals.length ? Math.min(...cpsVals) : null,
        cpsAverage: mean(cpsVals)
      };
    });

    configs.sort((a, b) => b.sessionCount - a.sessionCount || a.fingerprint.localeCompare(b.fingerprint));

    const types = new Set(configs.map((c) => c.type));
    let primaryType: AdminExerciseAnalyticsNameStat["primaryType"] = "mixed";
    if (types.size === 1) {
      primaryType = [...types][0] as "weight" | "bodyweight" | "time";
    }

    rows.push({
      nameKey: nk,
      displayName,
      primaryType,
      userCount: users.size,
      sessionCount: sessions,
      cpsHigh,
      cpsLow,
      distinctConfigCount: fpSet.size,
      configs
    });
  }

  rows.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    generatedAt: new Date().toISOString(),
    rows
  };
}
