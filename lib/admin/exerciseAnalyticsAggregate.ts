import { exerciseNameKey } from "@/lib/exerciseNameKey";
import {
  parseWorkoutEntryFromJson,
  type AdminWorkoutDisplayEntry
} from "@/lib/admin/parseWorkoutEntry";
import {
  filterSessionsByMedianHighCap,
  sessionFailsAbsoluteAnalyticsRules
} from "@/lib/admin/exerciseAnalyticsOutliers";

export type AdminExerciseAnalyticsTotals = {
  /** Parsed, non-draft, finite CPS, not rest-day marker (before outlier rules) */
  eligibleSessions: number;
  /** Sessions contributing to CPS aggregates */
  includedSessions: number;
  /** Eligible minus included (absolute + median caps; analytics only) */
  excludedOutlierSessions: number;
};

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
  /** Unique users who own this config and/or logged included sessions attributed to it */
  userCount: number;
  /** Sessions included in CPS stats for this config */
  sessionCount: number;
  /** Sessions attributed to this config but excluded by analytics-only outlier rules */
  excludedOutlierSessions: number;
  cpsHigh: number | null;
  cpsLow: number | null;
  cpsAverage: number | null;
};

export type AdminExerciseAnalyticsNameStat = {
  nameKey: string;
  displayName: string;
  primaryType: "weight" | "bodyweight" | "time" | "mixed";
  userCount: number;
  /** Sessions included in name-level CPS aggregates */
  sessionCount: number;
  /** Eligible sessions excluded from name-level CPS aggregates only */
  sessionsExcludedOutliers: number;
  cpsHigh: number | null;
  cpsLow: number | null;
  distinctConfigCount: number;
  configs: AdminExerciseAnalyticsConfigStat[];
};

export type AdminExerciseAnalyticsSnapshot = {
  generatedAt: string;
  totals: AdminExerciseAnalyticsTotals;
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

  const nameUsers = new Map<string, Set<string>>();
  const nameDisplayCounts = new Map<string, Map<string, number>>();
  const nameFingerprints = new Map<string, Set<string>>();

  type AnalyticsSession = {
    dedupeKey: string;
    userId: string;
    nk: string;
    fp: string | null;
    cps: number;
    sets: AdminWorkoutDisplayEntry["sets"];
    exerciseType: "weight" | "bodyweight" | "time";
  };

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

  const eligibleSessions: AnalyticsSession[] = [];

  for (const row of workoutRows) {
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    if (!userId) continue;
    const payload = parseJsonField(row.data);
    if (isRestDayMarkerPayload(payload)) continue;
    const parsed = parseWorkoutEntryFromJson(payload, null);
    if (!parsed) continue;
    if (parsed.isDraft === true) continue;
    if (parsed.sessionCps === null || !Number.isFinite(parsed.sessionCps)) continue;

    const nk = exerciseNameKey(parsed.exerciseName);
    addDisplayName(nk, parsed.exerciseName);

    if (!nameUsers.has(nk)) nameUsers.set(nk, new Set());
    nameUsers.get(nk)!.add(userId);

    const fp = resolveFingerprintForWorkout(userId, parsed.exerciseId, nk);
    const exerciseType: AnalyticsSession["exerciseType"] = fp
      ? fingerprintMeta.get(fp)?.type ?? "weight"
      : "weight";

    if (fp) {
      if (!configUsers.has(fp)) configUsers.set(fp, new Set());
      configUsers.get(fp)!.add(userId);
    }

    eligibleSessions.push({
      dedupeKey: `${userId}|${parsed.workoutId}|${parsed.submittedAt}`,
      userId,
      nk,
      fp,
      cps: parsed.sessionCps,
      sets: parsed.sets,
      exerciseType
    });
  }

  const absIncluded: AnalyticsSession[] = [];
  for (const s of eligibleSessions) {
    if (sessionFailsAbsoluteAnalyticsRules(s.cps, s.sets, s.exerciseType)) continue;
    absIncluded.push(s);
  }

  const byFp = new Map<string, AnalyticsSession[]>();
  const byOrphanNk = new Map<string, AnalyticsSession[]>();
  for (const s of absIncluded) {
    if (s.fp) {
      const list = byFp.get(s.fp) ?? [];
      list.push(s);
      byFp.set(s.fp, list);
    } else {
      const list = byOrphanNk.get(s.nk) ?? [];
      list.push(s);
      byOrphanNk.set(s.nk, list);
    }
  }

  const finalIncluded: AnalyticsSession[] = [];
  for (const list of byFp.values()) {
    const { kept } = filterSessionsByMedianHighCap(list);
    finalIncluded.push(...kept);
  }
  for (const list of byOrphanNk.values()) {
    const { kept } = filterSessionsByMedianHighCap(list);
    finalIncluded.push(...kept);
  }

  const eligibleCountByNk = new Map<string, number>();
  const eligibleCountByFp = new Map<string, number>();
  for (const s of eligibleSessions) {
    eligibleCountByNk.set(s.nk, (eligibleCountByNk.get(s.nk) ?? 0) + 1);
    if (s.fp) eligibleCountByFp.set(s.fp, (eligibleCountByFp.get(s.fp) ?? 0) + 1);
  }

  const includedCountByNk = new Map<string, number>();
  const includedCountByFp = new Map<string, number>();
  const nameCpsValues = new Map<string, number[]>();
  const configCpsValues = new Map<string, number[]>();

  for (const s of finalIncluded) {
    includedCountByNk.set(s.nk, (includedCountByNk.get(s.nk) ?? 0) + 1);
    if (!nameCpsValues.has(s.nk)) nameCpsValues.set(s.nk, []);
    nameCpsValues.get(s.nk)!.push(s.cps);
    if (s.fp) {
      includedCountByFp.set(s.fp, (includedCountByFp.get(s.fp) ?? 0) + 1);
      if (!configCpsValues.has(s.fp)) configCpsValues.set(s.fp, []);
      configCpsValues.get(s.fp)!.push(s.cps);
    }
  }

  const nameKeys = new Set<string>([
    ...nameUsers.keys(),
    ...nameFingerprints.keys(),
    ...eligibleCountByNk.keys()
  ]);

  const rows: AdminExerciseAnalyticsNameStat[] = [];

  for (const nk of nameKeys) {
    const fpSet = nameFingerprints.get(nk) ?? new Set<string>();
    const eligibleNk = eligibleCountByNk.get(nk) ?? 0;
    const includedNk = includedCountByNk.get(nk) ?? 0;
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
      const eligibleFp = eligibleCountByFp.get(fp) ?? 0;
      const includedFp = includedCountByFp.get(fp) ?? 0;
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
        sessionCount: includedFp,
        excludedOutlierSessions: Math.max(0, eligibleFp - includedFp),
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
      sessionCount: includedNk,
      sessionsExcludedOutliers: Math.max(0, eligibleNk - includedNk),
      cpsHigh,
      cpsLow,
      distinctConfigCount: fpSet.size,
      configs
    });
  }

  rows.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const totals: AdminExerciseAnalyticsTotals = {
    eligibleSessions: eligibleSessions.length,
    includedSessions: finalIncluded.length,
    excludedOutlierSessions: Math.max(0, eligibleSessions.length - finalIncluded.length)
  };

  return {
    generatedAt: new Date().toISOString(),
    totals,
    rows
  };
}
