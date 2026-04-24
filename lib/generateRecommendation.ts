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

  switch (progressionStage) {
    case "S1_REPS":
      return `Get your first set to ${targetReps} reps before progressing.`;

    case "S2_WEIGHT":
    case "S3_WEIGHT":
    case "S4_WEIGHT":
      if (!set1WeightLabel) return MISSING_DATA_MESSAGE;
      if (progressionStage === "S2_WEIGHT") {
        return `Get your 2nd set up to ${set1WeightLabel}.`;
      }
      if (progressionStage === "S3_WEIGHT") {
        return `Get your 3rd set up to ${set1WeightLabel}.`;
      }
      return `Get your 4th set up to ${set1WeightLabel}.`;

    case "S2_REPS":
    case "S3_REPS":
    case "S4_REPS":
      if (!set1WeightLabel) return MISSING_DATA_MESSAGE;
      if (progressionStage === "S2_REPS") {
        return `Keep your 2nd set at ${set1WeightLabel} and bring it to ${targetReps} reps.`;
      }
      if (progressionStage === "S3_REPS") {
        return `Keep your 3rd set at ${set1WeightLabel} and bring it to ${targetReps} reps.`;
      }
      return `Keep your 4th set at ${set1WeightLabel} and bring it to ${targetReps} reps.`;

    case "INCREASE_WEIGHT": {
      if (!Number.isFinite(increment) || increment <= 0) {
        return MISSING_DATA_MESSAGE;
      }
      return `All sets hit target — increase weight by ${formatLoadNumber(increment)} next session.`;
    }

    default:
      return MISSING_DATA_MESSAGE;
  }
}
