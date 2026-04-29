import type { ProgressionStage, SetInput } from "./calculateProgressionStage";

const LOG_FIRST_MESSAGE = "Log your workout to receive a recommendation.";
const MISSING_DATA_MESSAGE =
  "Add weights and reps for each set so we can give you a clearer tip.";

function formatLoadNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

function parseSetWeight(value: number | string): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function getSet1WeightPounds(sets: SetInput[]): number | null {
  const first = sets[0];
  if (!first) return null;
  return parseSetWeight(first.weight);
}

function getHighestCompletedWorkingWeight(sets: SetInput[]): number | null {
  let highest: number | null = null;
  for (const set of sets) {
    const weight = parseSetWeight(set.weight);
    if (weight === null) continue;
    if (highest === null || weight > highest) highest = weight;
  }
  return highest;
}

/**
 * Friendly coaching text for LOAD progression (after a workout is logged).
 *
 * @param sets - Logged sets in order (Set 1 is used for target weight on later sets).
 */
export function generateRecommendation(
  sets: SetInput[],
  progressionStage: ProgressionStage | null,
  targetReps: number,
  increment: number
): string {
  if (progressionStage === null) {
    return LOG_FIRST_MESSAGE;
  }

  if (!Number.isFinite(targetReps) || targetReps < 1) {
    return MISSING_DATA_MESSAGE;
  }

  const set1Weight = getSet1WeightPounds(sets);
  const set1WeightLabel =
    set1Weight === null ? null : `${formatLoadNumber(set1Weight)} lbs`;
  const highestWorkingWeight = getHighestCompletedWorkingWeight(sets);

  switch (progressionStage) {
    case "S1_REPS":
      return `Bring Set 1 to ${targetReps} reps.`;

    case "S2_WEIGHT":
    case "S3_WEIGHT":
    case "S4_WEIGHT":
      if (!set1WeightLabel) return MISSING_DATA_MESSAGE;
      if (progressionStage === "S2_WEIGHT") {
        return "Match Set 1 weight on Set 2.";
      }
      if (progressionStage === "S3_WEIGHT") {
        return "Match Set 1 weight on Set 3.";
      }
      return "Match Set 1 weight on Set 4.";

    case "S2_REPS":
    case "S3_REPS":
    case "S4_REPS":
      if (progressionStage === "S2_REPS") {
        return `Bring Set 2 to ${targetReps} reps.`;
      }
      if (progressionStage === "S3_REPS") {
        return `Bring Set 3 to ${targetReps} reps.`;
      }
      return `Bring Set 4 to ${targetReps} reps.`;

    case "INCREASE_WEIGHT": {
      if (!Number.isFinite(increment) || increment <= 0) {
        return MISSING_DATA_MESSAGE;
      }
      if (highestWorkingWeight !== null) {
        return `Increase to ${formatLoadNumber(highestWorkingWeight + increment)} lbs next session.`;
      }
      return `Increase weight by ${formatLoadNumber(increment)} next session.`;
    }

    default:
      return MISSING_DATA_MESSAGE;
  }
}
