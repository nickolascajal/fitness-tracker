export type AdminWorkoutDisplayEntry = {
  workoutId: string;
  exerciseId: string;
  exerciseName: string;
  workoutDate: string;
  isDraft?: boolean;
  sets: Array<{
    weight: string;
    reps: string;
    timeSeconds: number;
    rir: string;
    tir: string;
    rpe: string;
  }>;
  sessionVolume: number;
  sessionCps: number | null;
  progressionStage: string;
  recommendation: string;
  submittedAt: string;
  updatedAt?: string;
};

function toLocalDateStringFromIso(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * Mirrors app workout normalization for admin read-only display (server-only).
 */
export function parseWorkoutEntryFromJson(
  raw: unknown,
  rowDate?: string | null
): AdminWorkoutDisplayEntry | null {
  const entry = raw as Partial<AdminWorkoutDisplayEntry> & {
    sets?: Array<{
      weight?: unknown;
      reps?: unknown;
      timeSeconds?: unknown;
      time?: unknown;
      rir?: unknown;
      tir?: unknown;
      rpe?: unknown;
    }>;
  };
  const fallbackDateKey =
    typeof rowDate === "string" && rowDate.trim() !== "" ? rowDate : undefined;

  if (
    !entry ||
    typeof entry.exerciseId !== "string" ||
    typeof entry.exerciseName !== "string" ||
    !Array.isArray(entry.sets) ||
    typeof entry.sessionVolume !== "number" ||
    typeof entry.progressionStage !== "string" ||
    typeof entry.recommendation !== "string" ||
    typeof entry.submittedAt !== "string"
  ) {
    return null;
  }

  const workoutDate =
    typeof entry.workoutDate === "string" && entry.workoutDate.trim() !== ""
      ? entry.workoutDate
      : fallbackDateKey ?? toLocalDateStringFromIso(entry.submittedAt);

  const workoutId =
    typeof entry.workoutId === "string" && entry.workoutId.trim() !== ""
      ? entry.workoutId
      : `${entry.exerciseId}:${entry.submittedAt}`;

  return {
    workoutId,
    exerciseId: entry.exerciseId,
    exerciseName: entry.exerciseName,
    workoutDate,
    isDraft: entry.isDraft === true,
    sets: entry.sets.map((s) => ({
      weight: typeof s?.weight === "string" ? s.weight : String(s?.weight ?? ""),
      reps: typeof s?.reps === "string" ? s.reps : String(s?.reps ?? ""),
      timeSeconds: (() => {
        const snap = s as {
          timeSeconds?: unknown;
          time?: unknown;
        };
        if (typeof snap.timeSeconds === "number" && Number.isFinite(snap.timeSeconds) && snap.timeSeconds >= 0) {
          return snap.timeSeconds;
        }
        if (typeof snap.time === "string") {
          const parsed = Number(snap.time ?? "");
          return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        }
        return 0;
      })(),
      rir: typeof s?.rir === "string" ? s.rir : "",
      tir: typeof s?.tir === "string" ? s.tir : "",
      rpe: typeof s?.rpe === "string" ? s.rpe : ""
    })),
    sessionVolume: entry.sessionVolume,
    sessionCps: (() => {
      if (entry.sessionCps === null || entry.sessionCps === undefined) return null;
      const n =
        typeof entry.sessionCps === "number" ? entry.sessionCps : Number(entry.sessionCps);
      return Number.isFinite(n) ? n : null;
    })(),
    progressionStage: entry.progressionStage,
    recommendation: entry.recommendation,
    submittedAt: entry.submittedAt,
    updatedAt:
      typeof entry.updatedAt === "string" && entry.updatedAt.trim() !== "" ? entry.updatedAt : undefined
  };
}
