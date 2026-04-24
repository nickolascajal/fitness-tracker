/**
 * Load-progression stages for a finished workout.
 * Rules are checked in order; the first match wins.
 */

export type ProgressionStage =
  | "S1_REPS"
  | "S2_WEIGHT"
  | "S2_REPS"
  | "S3_WEIGHT"
  | "S3_REPS"
  | "S4_WEIGHT"
  | "S4_REPS"
  | "INCREASE_WEIGHT";

export type SetInput = {
  weight: number | string;
  reps: number | string;
};

/** Treat weights equal when they round the same at 0.001 (gym plates). */
function sameWeight(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-3;
}

function parseNumber(value: number | string): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param sets - Logged sets (weights and reps). Order is set 1, set 2, …
 * @param targetReps - Target reps you’re building toward.
 * @param setCount - How many sets this exercise uses (only the first this many are evaluated).
 */
export function calculateProgressionStage(
  sets: SetInput[],
  targetReps: number,
  setCount: number
): ProgressionStage | null {
  const count = Math.max(1, Math.floor(setCount));
  const trimmed = sets.slice(0, count).map((set) => ({
    weight: parseNumber(set.weight),
    reps: parseNumber(set.reps)
  }));

  if (trimmed.length === 0) return null;

  const s1 = trimmed[0];
  const s2 = trimmed[1];
  const s3 = trimmed[2];
  const s4 = trimmed[3];

  // Rule 1: first set still short of target reps
  if (s1.reps === null || s1.reps < targetReps) {
    return "S1_REPS";
  }

  const w1 = s1.weight;

  // --- Set 2 (only if this workout has at least two sets) ---

  // Rule 2: set 1 hit target, but set 2 uses less weight than set 1
  if (s2 !== undefined && w1 !== null && s2.weight !== null && s2.weight < w1) {
    return "S2_WEIGHT";
  }

  // Rule 3: same weight as set 1, but set 2 reps still below target
  if (
    s2 !== undefined &&
    w1 !== null &&
    s2.weight !== null &&
    sameWeight(s2.weight, w1) &&
    (s2.reps === null || s2.reps < targetReps)
  ) {
    return "S2_REPS";
  }

  // --- Set 3 (only if there are three+ sets) ---

  // Rule 4: set 2 hit target, but set 3 uses less weight than set 1
  if (
    s2 !== undefined &&
    s2.reps !== null &&
    s2.reps >= targetReps &&
    s3 !== undefined &&
    w1 !== null &&
    s3.weight !== null &&
    s3.weight < w1
  ) {
    return "S3_WEIGHT";
  }

  // Rule 5: same weight as set 1, but set 3 reps still below target
  if (
    s3 !== undefined &&
    w1 !== null &&
    s3.weight !== null &&
    sameWeight(s3.weight, w1) &&
    (s3.reps === null || s3.reps < targetReps)
  ) {
    return "S3_REPS";
  }

  // --- Set 4 (only if there are four+ sets) ---

  // Set 3 hit target, but set 4 uses less weight than set 1
  if (
    s3 !== undefined &&
    s3.reps !== null &&
    s3.reps >= targetReps &&
    s4 !== undefined &&
    w1 !== null &&
    s4.weight !== null &&
    s4.weight < w1
  ) {
    return "S4_WEIGHT";
  }

  // Same weight as set 1, but set 4 reps still below target
  if (
    s4 !== undefined &&
    w1 !== null &&
    s4.weight !== null &&
    sameWeight(s4.weight, w1) &&
    (s4.reps === null || s4.reps < targetReps)
  ) {
    return "S4_REPS";
  }

  // Final rule: every set at or above target, and all uses the same weight
  const allHitTarget = trimmed.every(
    (set) => set.reps !== null && set.reps >= targetReps && set.weight !== null
  );
  if (allHitTarget) {
    const firstW = trimmed[0].weight;
    if (
      firstW !== null &&
      trimmed.every(
        (set) => set.weight !== null && sameWeight(set.weight, firstW)
      )
    ) {
      return "INCREASE_WEIGHT";
    }
  }

  return null;
}
