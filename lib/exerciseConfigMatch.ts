import { exerciseNameKey } from "@/lib/exerciseNameKey";

type ConfigFields = {
  setCount: number;
  targetReps: number;
  increment: number;
  unit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
};

/**
 * Returns the first saved exercise with the same normalized name and full config, if any.
 */
export function findExerciseWithSameNameAndConfig<
  T extends { name: string } & ConfigFields
>(exercises: T[], name: string, config: ConfigFields): T | undefined {
  const nameKey = exerciseNameKey(name);
  return exercises.find(
    (e) =>
      exerciseNameKey(e.name) === nameKey &&
      e.setCount === config.setCount &&
      e.targetReps === config.targetReps &&
      e.increment === config.increment &&
      e.unit === config.unit &&
      e.trackRir === config.trackRir &&
      e.trackRpe === config.trackRpe
  );
}
