/**
 * Analytics-only outlier rules for admin Exercise Analytics.
 * Does not modify user data or CPS calculations elsewhere.
 *
 * Extension points: manual review flags, percentiles, bodyweight-adjusted caps.
 */

import type { AdminWorkoutDisplayEntry } from "@/lib/admin/parseWorkoutEntry";

/** Per-set entered weight (lbs or kg as stored) — absolute sanity cap for aggregates only */
export const ANALYTICS_MAX_WEIGHT_MAGNITUDE = 2000;

/** Per-set rep count cap (analytics only) */
export const ANALYTICS_MAX_REPS_PER_SET = 200;

/** Per-set time hold cap in seconds (analytics only) */
export const ANALYTICS_MAX_TIME_SECONDS_PER_SET = 6 * 3600;

/** Minimum sessions with same exercise+config before median-based high CPS cap applies */
export const ANALYTICS_MIN_SESSIONS_FOR_MEDIAN_RULE = 8;

/** Exclude CPS above median × this factor when sample size is sufficient (conservative) */
export const ANALYTICS_MEDIAN_HIGH_MULTIPLIER = 6;

/**
 * Returns true if this session should be excluded from admin CPS aggregates only.
 * Conservative absolute checks; does not include median (caller applies per group).
 */
export function sessionFailsAbsoluteAnalyticsRules(
  cps: number,
  sets: AdminWorkoutDisplayEntry["sets"],
  exerciseType: "weight" | "bodyweight" | "time"
): boolean {
  void exerciseType; // reserved for bodyweight-adjusted caps / type-specific rules
  if (!Number.isFinite(cps) || cps <= 0) return true;
  for (const set of sets) {
    const w = Number(set.weight);
    if (Number.isFinite(w) && Math.abs(w) > ANALYTICS_MAX_WEIGHT_MAGNITUDE) return true;
    const r = Number(set.reps);
    if (Number.isFinite(r) && (r < 0 || r > ANALYTICS_MAX_REPS_PER_SET)) return true;
    const t = Number(set.timeSeconds);
    if (Number.isFinite(t) && t > ANALYTICS_MAX_TIME_SECONDS_PER_SET) return true;
  }
  return false;
}

/**
 * Drops only extreme high CPS values vs median when enough samples exist (same exercise+config bucket).
 */
export function filterSessionsByMedianHighCap<T extends { cps: number }>(
  sessions: T[]
): { kept: T[]; excludedCount: number } {
  if (sessions.length < ANALYTICS_MIN_SESSIONS_FOR_MEDIAN_RULE) {
    return { kept: [...sessions], excludedCount: 0 };
  }
  const sorted = [...sessions].map((s) => s.cps).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  if (!Number.isFinite(median) || median <= 0) {
    return { kept: [...sessions], excludedCount: 0 };
  }
  const cap = median * ANALYTICS_MEDIAN_HIGH_MULTIPLIER;
  const kept = sessions.filter((s) => Number.isFinite(s.cps) && s.cps <= cap);
  return { kept, excludedCount: sessions.length - kept.length };
}
