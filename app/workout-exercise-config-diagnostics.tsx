"use client";

import { useEffect, useMemo, useRef } from "react";
import { useExercises } from "@/app/exercises-provider";
import { useWorkoutHistory } from "@/app/workout-history-provider";

/**
 * Logs when workout history is grouped by an exerciseId that has no matching
 * entry in the exercises list (e.g. config not yet synced from Supabase).
 */
export function WorkoutExerciseConfigDiagnostics() {
  const { exercises } = useExercises();
  const { historyByExerciseId } = useWorkoutHistory();
  const exerciseIdSet = useMemo(() => new Set(exercises.map((e) => e.id)), [exercises]);
  const logged = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const [exerciseId, entries] of Object.entries(historyByExerciseId)) {
      if (entries.length === 0) continue;
      if (exerciseIdSet.has(exerciseId)) continue;
      if (logged.current.has(exerciseId)) continue;
      logged.current.add(exerciseId);
      console.warn(
        "Workout history references a missing exercise config. exerciseId=" +
          exerciseId +
          " — add/sync this exercise in Supabase or library so edits and config-based actions work.",
        { entryCount: entries.length }
      );
    }
  }, [historyByExerciseId, exerciseIdSet]);

  return null;
}
