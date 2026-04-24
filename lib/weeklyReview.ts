import type { WorkoutHistoryEntry } from "@/app/workout-history-provider";
import { getWeekDaysSunToSat, parseYmd, type MonthCell } from "@/app/workout/workoutDateNavUtils";

function entryYmd(e: WorkoutHistoryEntry): string {
  if (e.workoutDate && e.workoutDate.trim() !== "") return e.workoutDate;
  const d = new Date(e.submittedAt);
  if (!Number.isFinite(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function getPreviousComparableWorkoutEntry(
  entry: WorkoutHistoryEntry,
  byExercise: Record<string, WorkoutHistoryEntry[]>
): WorkoutHistoryEntry | null {
  const list = byExercise[entry.exerciseId];
  if (!list) return null;
  const idx = list.findIndex((e) => e.workoutId === entry.workoutId);
  if (idx < 0) return null;
  return list[idx + 1] ?? null;
}

/**
 * All logged sessions whose local calendar day falls in [sunYmd, satYmd] (inclusive, string compare).
 */
function entriesInWeek(
  allEntries: WorkoutHistoryEntry[],
  sunYmd: string
): WorkoutHistoryEntry[] {
  const week = getWeekDaysSunToSat(sunYmd);
  if (week.length < 2) return [];
  const [first, last] = [week[0]!, week[6]!];
  return allEntries.filter((e) => {
    const y = entryYmd(e);
    return y.length >= 10 && y >= first && y <= last;
  });
}

export type WeekReviewLine = { exerciseName: string; valueLabel: string };

export type WeekReviewSnapshot = {
  /**
   * Single best positive CPS delta vs prior session (same `exerciseId`); used for both
   * “Top performer” and “Biggest CPS improvement” in the UI.
   */
  cpsChangeLeader: WeekReviewLine | null;
  largestVolumeImprovement: WeekReviewLine | null;
};

const EPS = 1e-6;

function bestPositiveCpsDeltas(
  weekEntries: WorkoutHistoryEntry[],
  byExercise: Record<string, WorkoutHistoryEntry[]>
): { entry: WorkoutHistoryEntry; delta: number; percent: number } | null {
  let best: { entry: WorkoutHistoryEntry; delta: number; percent: number } | null = null;
  for (const entry of weekEntries) {
    const cur = entry.sessionCps;
    if (cur === null || !Number.isFinite(cur)) continue;
    const prev = getPreviousComparableWorkoutEntry(entry, byExercise);
    if (!prev) continue;
    const pC = prev.sessionCps;
    if (pC === null || !Number.isFinite(pC)) continue;
    if (Math.abs(pC) < EPS) continue;
    const delta = cur - pC;
    if (delta <= EPS) continue;
    const percent = (delta / pC) * 100;
    if (!best || percent > best.percent) best = { entry, delta, percent };
  }
  return best;
}

function bestPositiveVolumeDeltas(
  weekEntries: WorkoutHistoryEntry[],
  byExercise: Record<string, WorkoutHistoryEntry[]>
): { entry: WorkoutHistoryEntry; delta: number } | null {
  let best: { entry: WorkoutHistoryEntry; delta: number } | null = null;
  for (const entry of weekEntries) {
    const cur = entry.sessionVolume;
    const prev = getPreviousComparableWorkoutEntry(entry, byExercise);
    if (!prev) continue;
    const d = cur - prev.sessionVolume;
    if (d <= EPS) continue;
    if (!best || d > best.delta) best = { entry, delta: d };
  }
  return best;
}

export function computeWeekReview(
  allEntries: WorkoutHistoryEntry[],
  byExercise: Record<string, WorkoutHistoryEntry[]>,
  /** Any YYYY-MM-DD in the week; normalized to the local Sunday. */
  anyYmdInWeek: string
): WeekReviewSnapshot {
  const sun = getWeekDaysSunToSat(anyYmdInWeek)[0] ?? anyYmdInWeek;
  const inWeek = entriesInWeek(allEntries, sun);

  if (inWeek.length === 0) {
    return { cpsChangeLeader: null, largestVolumeImprovement: null };
  }

  const cpsWin = bestPositiveCpsDeltas(inWeek, byExercise);
  const volWin = bestPositiveVolumeDeltas(inWeek, byExercise);

  const fmtCpsD = (d: number) => (Math.round(d * 10) / 10).toFixed(1);
  const fmtPct = (d: number) => (Math.round(d * 10) / 10).toFixed(1);
  const fmtVol = (d: number) => (Math.abs(d - Math.round(d)) < 0.05 ? String(Math.round(d)) : d.toFixed(1));

  const cpsLine = cpsWin
    ? {
        exerciseName: cpsWin.entry.exerciseName,
        valueLabel: `+${fmtPct(cpsWin.percent)}% ( +${fmtCpsD(cpsWin.delta)} CPS )`
      }
    : null;

  return {
    cpsChangeLeader: cpsLine,
    largestVolumeImprovement: volWin
      ? { exerciseName: volWin.entry.exerciseName, valueLabel: `+${fmtVol(volWin.delta)} vol` }
      : null
  };
}

/** Chunks 7 * N cells into N rows. */
export function monthCellsToRows(cells: MonthCell[]): MonthCell[][] {
  const out: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    out.push(cells.slice(i, i + 7));
  }
  return out;
}

export function rowHasDayInViewMonth(row: MonthCell[], viewMonth1: number): boolean {
  for (const c of row) {
    if (c.type !== "day") continue;
    const p = parseYmd(c.ymd);
    if (p && p.m === viewMonth1) return true;
  }
  return false;
}

export function getMonthName(m1: number): string {
  return new Date(2026, m1 - 1, 1, 12, 0, 0, 0).toLocaleDateString("en-US", { month: "long" });
}
