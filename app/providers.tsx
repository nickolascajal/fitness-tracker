"use client";

import type { ReactNode } from "react";
import { BodyweightProvider } from "@/app/bodyweight-provider";
import { ExercisesProvider } from "@/app/exercises-provider";
import { PendingSyncStatus } from "@/app/pending-sync-status";
import { WorkoutExerciseConfigDiagnostics } from "@/app/workout-exercise-config-diagnostics";
import { WorkoutHistoryProvider } from "@/app/workout-history-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ExercisesProvider>
      <WorkoutHistoryProvider>
        <BodyweightProvider>
          <WorkoutExerciseConfigDiagnostics />
          <PendingSyncStatus />
          {children}
        </BodyweightProvider>
      </WorkoutHistoryProvider>
    </ExercisesProvider>
  );
}
