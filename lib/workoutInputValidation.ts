/**
 * Shared rules for workout numeric inputs: allow empty strings while typing;
 * submit requires set 1 complete per exercise rules and all later visible core fields numeric (including 0).
 */

export type WorkoutInputRow = {
  weight: string;
  reps: string;
  timeSeconds?: string;
};

/** True if trimmed input parses to a finite number (including 0). */
export function hasNumericEntry(raw: string | undefined): boolean {
  const t = String(raw ?? "").trim();
  if (t === "") return false;
  const n = Number(t);
  return Number.isFinite(n);
}

/** Safe parse for persisted snapshots; empty → 0, invalid → 0. */
export function parseTrimmedNumberString(raw: string | undefined): number {
  const t = String(raw ?? "").trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Set 1 must satisfy the same “valid set” rules previously used by `hasAtLeastOneValidSet`
 * (one complete working set for progression/CPS entry).
 */
export function isFirstSetCompleteForExercise(
  set: WorkoutInputRow,
  exerciseType: "weight" | "bodyweight" | "time",
  foundation: number
): boolean {
  const requiresWeightAndTime = false;
  if (exerciseType === "time") {
    return requiresWeightAndTime
      ? Number(set.timeSeconds ?? "") > 0 && Number(set.weight) > 0
      : Number(String(set.timeSeconds ?? "").trim()) > 0;
  }
  const reps = Number(set.reps);
  const weight = Number(set.weight);
  if (!(reps > 0)) return false;
  if (weight > 0) return true;
  if (exerciseType === "bodyweight" && foundation > 0 && weight === 0) return true;
  return false;
}

/** Sets after index 0: core load fields must be present as numbers (0 allowed), no blanks. */
export function laterSetHasRequiredNumericFields(
  set: WorkoutInputRow,
  exerciseType: "weight" | "bodyweight" | "time"
): boolean {
  if (exerciseType === "time") {
    if (!hasNumericEntry(set.timeSeconds)) return false;
    const w = String(set.weight ?? "").trim();
    if (w !== "" && !hasNumericEntry(set.weight)) return false;
    return true;
  }
  return hasNumericEntry(set.weight) && hasNumericEntry(set.reps);
}

export function canSubmitWorkoutInputs(
  sets: WorkoutInputRow[],
  exerciseType: "weight" | "bodyweight" | "time",
  foundation: number
): boolean {
  if (sets.length === 0) return false;
  if (!isFirstSetCompleteForExercise(sets[0], exerciseType, foundation)) return false;
  for (let i = 1; i < sets.length; i++) {
    if (!laterSetHasRequiredNumericFields(sets[i], exerciseType)) return false;
  }
  return true;
}

/** Normalize snapshot rows (string | number from storage) into input strings for validation. */
export function snapshotSetsToInputRows(
  sets: ReadonlyArray<{
    weight?: unknown;
    reps?: unknown;
    timeSeconds?: unknown;
  }>
): WorkoutInputRow[] {
  return sets.map((s) => ({
    weight: s.weight === undefined || s.weight === null ? "" : String(s.weight),
    reps: s.reps === undefined || s.reps === null ? "" : String(s.reps),
    timeSeconds:
      s.timeSeconds === undefined || s.timeSeconds === null ? "" : String(s.timeSeconds)
  }));
}

export function hasSubmittableSnapshotSets(
  sets: ReadonlyArray<{
    weight?: unknown;
    reps?: unknown;
    timeSeconds?: unknown;
  }>,
  exerciseType: "weight" | "bodyweight" | "time",
  foundation: number
): boolean {
  return canSubmitWorkoutInputs(snapshotSetsToInputRows(sets), exerciseType, foundation);
}
