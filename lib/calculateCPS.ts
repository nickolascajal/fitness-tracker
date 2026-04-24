import type { SetInput } from "./calculateProgressionStage";

type ValidSet = {
  weight: number;
  reps: number;
};

type TimeValidSet = {
  effectiveWeight: number;
  timeSeconds: number;
};

type CpsExerciseType = "weight" | "bodyweight" | "time";

type CalculateCpsOptions = {
  exerciseType?: CpsExerciseType;
  targetTimeSeconds?: number;
  foundation?: number;
};

function parsePositiveNumber(value: number | string): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Collect sets where both weight and reps are strictly positive. */
function getValidSets(sets: SetInput[]): ValidSet[] {
  const valid: ValidSet[] = [];
  for (const set of sets) {
    const weight = parsePositiveNumber(set.weight);
    const reps = parsePositiveNumber(set.reps);
    if (weight !== null && reps !== null) {
      valid.push({ weight, reps });
    }
  }
  return valid;
}

/**
 * Divisor = average of the two heaviest valid set weights (spreadsheet-style anchor).
 * With only one valid set, that weight is the divisor.
 */
function computeDivisor(validSets: ValidSet[]): number {
  const weights = [...validSets.map((s) => s.weight)].sort((a, b) => b - a);
  const topTwo = weights.slice(0, 2);
  const sum = topTwo.reduce((acc, w) => acc + w, 0);
  return sum / topTwo.length;
}

/**
 * Custom Performance Score (CPS) for a single workout session.
 * Normalizes load by a top-weight divisor to limit inflation from very heavy sets,
 * caps reps at target for the completion factor, then applies a small set-count bonus.
 *
 * @returns Score rounded to 2 decimals, or `0` if there is nothing valid to score.
 */
export function calculateCPS(sets: SetInput[], targetReps: number): number {
  return calculateCPSWithOptions(sets, targetReps, {});
}

function getValidTimeSets(
  sets: Array<{ weight?: number | string; timeSeconds?: number | string }>,
  foundation: number
): TimeValidSet[] {
  const valid: TimeValidSet[] = [];
  for (const set of sets) {
    const timeSeconds = parsePositiveNumber(set.timeSeconds ?? "");
    if (timeSeconds === null) continue;
    const enteredWeight = parsePositiveNumber(set.weight ?? "");
    const effectiveWeight = enteredWeight ?? (foundation > 0 ? foundation : 0);
    valid.push({ effectiveWeight, timeSeconds });
  }
  return valid;
}

function computeTimeDivisor(validSets: TimeValidSet[]): number {
  const positiveWeights = validSets
    .map((set) => set.effectiveWeight)
    .filter((weight) => weight > 0)
    .sort((a, b) => b - a);
  if (positiveWeights.length === 0) return 1;
  const topTwo = positiveWeights.slice(0, 2);
  const sum = topTwo.reduce((acc, w) => acc + w, 0);
  return sum / topTwo.length;
}

export function calculateCPSWithOptions(
  sets: Array<SetInput & { timeSeconds?: number | string }>,
  targetReps: number,
  options: CalculateCpsOptions
): number {
  const exerciseType = options.exerciseType ?? "weight";
  if (exerciseType === "time") {
    const targetTimeSeconds = Number(options.targetTimeSeconds);
    if (!Number.isFinite(targetTimeSeconds) || targetTimeSeconds <= 0) {
      return 0;
    }
    const foundation =
      typeof options.foundation === "number" && Number.isFinite(options.foundation)
        ? options.foundation
        : 0;
    const validTimeSets = getValidTimeSets(sets, foundation);
    if (validTimeSets.length === 0) {
      return 0;
    }
    const divisor = computeTimeDivisor(validTimeSets);
    const contributions: number[] = [];
    for (const { effectiveWeight, timeSeconds } of validTimeSets) {
      const completionRatio = Math.min(timeSeconds, targetTimeSeconds) / targetTimeSeconds;
      const completionFactor = Math.pow(completionRatio, 0.2);
      if (effectiveWeight > 0) {
        const loadTerm = (effectiveWeight * effectiveWeight) / divisor;
        const loadBonus = 1 + Math.max(effectiveWeight / divisor - 1, 0) * 0.35;
        contributions.push(loadTerm * completionFactor * loadBonus);
      } else {
        contributions.push(completionFactor);
      }
    }
    const validSetCount = contributions.length;
    const averageContribution =
      contributions.reduce((sum, value) => sum + value, 0) / validSetCount;
    const finalScore =
      averageContribution * (1 + (validSetCount - 1) * 0.0625);
    return Math.round(finalScore * 100) / 100;
  }

  if (!Number.isFinite(targetReps) || targetReps <= 0) {
    return 0;
  }

  const validSets = getValidSets(sets);
  if (validSets.length === 0) {
    return 0;
  }

  // Step 2: divisor from average of top 2 weights (or single weight if only one set)
  const divisor = computeDivisor(validSets);

  const contributions: number[] = [];

  for (const { weight, reps } of validSets) {
    // Reps factor: capped at target (same as spreadsheet completion)
    const completionRatio = Math.min(reps, targetReps) / targetReps;
    const completionFactor = Math.pow(completionRatio, 0.2);

    // Load term: w² scaled by divisor so heavy top sets don’t explode the score
    const loadTerm = (weight * weight) / divisor;

    // Extra bump when this set’s weight exceeds the divisor (drops to 0 if not)
    const loadBonus = 1 + Math.max(weight / divisor - 1, 0) * 0.35;

    const contribution = loadTerm * completionFactor * loadBonus;
    contributions.push(contribution);
  }

  // Step 4: average across valid sets only
  const validSetCount = contributions.length;
  const averageContribution =
    contributions.reduce((sum, value) => sum + value, 0) / validSetCount;

  // Step 5: modest bonus for completing more sets
  const finalScore =
    averageContribution * (1 + (validSetCount - 1) * 0.0625);

  // Step 6: two decimal places
  return Math.round(finalScore * 100) / 100;
}
