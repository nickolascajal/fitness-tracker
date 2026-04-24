"use client";

import type { ReactNode } from "react";
import { ExercisesProvider } from "@/app/exercises-provider";
import { WorkoutHistoryProvider } from "@/app/workout-history-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ExercisesProvider>
      <WorkoutHistoryProvider>{children}</WorkoutHistoryProvider>
    </ExercisesProvider>
  );
}
