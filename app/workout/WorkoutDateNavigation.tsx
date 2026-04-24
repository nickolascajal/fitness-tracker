"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkoutHistoryEntry } from "@/app/workout-history-provider";
import {
  computeWeekReview,
  getMonthName,
  monthCellsToRows,
  rowHasDayInViewMonth,
  type WeekReviewSnapshot
} from "@/lib/weeklyReview";
import { WeeklyReviewModal } from "./WeeklyReviewModal";
import {
  getMonthGridCells,
  getWeekDaysSunToSat,
  isSameYmd,
  isYmdInWorkoutRange,
  parseYmd,
  type MonthCell,
  WORKOUT_DATE_MAX,
  WORKOUT_DATE_MIN,
  WORKOUT_VIEW_YEAR
} from "./workoutDateNavUtils";

const WEEK_HEADER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Wk"] as const;

function getLocalYmd(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function monthTitle(y: number, m: number): string {
  return new Date(y, m - 1, 1, 12, 0, 0, 0).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });
}

function dayLabel(ymd: string): { weekday: string; dayNumber: string } {
  const p = parseYmd(ymd);
  if (!p) return { weekday: "—", dayNumber: "—" };
  const d = new Date(p.y, p.m - 1, p.d, 12, 0, 0, 0);
  return {
    weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
    dayNumber: String(p.d)
  };
}

type WorkoutDateNavigationProps = {
  value: string;
  /** Week strip: Sun–Sat cells (when `allowInteraction`). */
  onWeekdayClick?: (ymd: string) => void;
  /** Month grid (when `allowInteraction` and `showMonthCalendar`). */
  onMonthdayClick?: (ymd: string) => void;
  /** Fires when the user changes month with ← / → (e.g. clear a pending “first tap” in the parent). */
  onUserNavigateMonth?: () => void;
  /** When false, week and month are read-only (selection still shown). */
  allowInteraction: boolean;
  /** When false, the month grid is hidden (e.g. non–day_overview). */
  showMonthCalendar: boolean;
  /** If set, month view shows a weekly review after each week row. */
  historyByExerciseId?: Record<string, WorkoutHistoryEntry[]>;
  /** Optional date-status overlays for subtle calendar tinting. */
  restDates?: Set<string>;
  finishedDates?: Set<string>;
};

export function WorkoutDateNavigation({
  value,
  onWeekdayClick,
  onMonthdayClick,
  onUserNavigateMonth,
  allowInteraction,
  showMonthCalendar,
  historyByExerciseId: historyByExercise,
  restDates,
  finishedDates
}: WorkoutDateNavigationProps) {
  const p = parseYmd(value);
  const initM =
    p && p.y === WORKOUT_VIEW_YEAR && p.m >= 1 && p.m <= 12
      ? p.m
      : 1;
  const [viewMonth, setViewMonth] = useState(initM);
  const [weekReviewOpen, setWeekReviewOpen] = useState<{
    weekLabel: string;
    snapshot: WeekReviewSnapshot;
  } | null>(null);

  useEffect(() => {
    const v = parseYmd(value);
    if (v && v.y === WORKOUT_VIEW_YEAR && v.m >= 1 && v.m <= 12) {
      setViewMonth(v.m);
    }
  }, [value]);

  const weekDays = getWeekDaysSunToSat(value);
  const monthCells = getMonthGridCells(WORKOUT_VIEW_YEAR, viewMonth);
  const todayYmd = getLocalYmd(new Date());

  const allWorkoutEntries = useMemo((): WorkoutHistoryEntry[] => {
    if (!historyByExercise || !showMonthCalendar) return [];
    return Object.values(historyByExercise).flat();
  }, [historyByExercise, showMonthCalendar]);

  const { monthRows, weekInMonthByRow } = useMemo(() => {
    const rows = monthCellsToRows(monthCells);
    const wn: (number | null)[] = [];
    let n = 0;
    for (const r of rows) {
      if (rowHasDayInViewMonth(r, viewMonth)) {
        n += 1;
        wn.push(n);
      } else {
        wn.push(null);
      }
    }
    return { monthRows: rows, weekInMonthByRow: wn };
  }, [monthCells, viewMonth]);

  const canGoPrev = viewMonth > 1;
  const canGoNext = viewMonth < 12;

  const goPrevMonth = () => {
    if (!canGoPrev) return;
    setViewMonth((m) => m - 1);
    onUserNavigateMonth?.();
  };

  const goNextMonth = () => {
    if (!canGoNext) return;
    setViewMonth((m) => m + 1);
    onUserNavigateMonth?.();
  };

  const handleWeekdayPick = (ymd: string) => {
    if (!allowInteraction) return;
    if (!isYmdInWorkoutRange(ymd)) return;
    onWeekdayClick?.(ymd);
  };

  const handleMonthdayPick = (ymd: string) => {
    if (!allowInteraction) return;
    if (!isYmdInWorkoutRange(ymd)) return;
    onMonthdayClick?.(ymd);
  };

  const dayTone = (ymd: string): string => {
    if (restDates?.has(ymd)) {
      return "border-slate-300 bg-slate-100 text-slate-800";
    }
    if (finishedDates?.has(ymd)) {
      return "border-slate-300 bg-slate-200 text-slate-900 font-semibold";
    }
    return "border-slate-200 bg-white text-slate-800";
  };

  function renderMonthCell(cell: MonthCell, cellKey: string) {
    if (cell.type === "blank") {
      return <div key={cellKey} className="aspect-square min-h-[2.25rem]" aria-hidden />;
    }
    const ymd = cell.ymd;
    const inRange = isYmdInWorkoutRange(ymd);
    const selected = isSameYmd(ymd, value);
    const isToday = isSameYmd(ymd, todayYmd);
    const interactive = allowInteraction && inRange;
    const d = parseYmd(ymd);
    const className = [
      "flex aspect-square min-h-[2.25rem] items-center justify-center rounded-md border text-sm font-medium",
      selected
        ? "border-slate-900 bg-slate-900 text-white"
        : inRange
          ? isToday
            ? dayTone(ymd).replace("text-slate-800", "text-slate-900").replace("border-slate-200", "border-slate-400") +
              (interactive ? " hover:border-slate-300" : "")
            : dayTone(ymd) +
              (interactive ? " hover:border-slate-300 hover:bg-slate-50" : "")
          : "border-transparent bg-slate-50/50 text-slate-300" +
            (interactive ? "" : " cursor-not-allowed")
    ].join(" ");
    if (interactive) {
      return (
        <button
          key={cellKey}
          type="button"
          onClick={() => handleMonthdayPick(ymd)}
          className={className}
        >
          {d?.d}
        </button>
      );
    }
    return (
      <div
        key={cellKey}
        className={className + (inRange ? " cursor-default" : "")}
        aria-current={selected ? "date" : undefined}
      >
        {d?.d}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-700">This week</p>
        <div className="mt-2 grid grid-cols-7 gap-1.5 sm:gap-2">
          {weekDays.map((ymd) => {
            const inRange = isYmdInWorkoutRange(ymd);
            const selected = isSameYmd(ymd, value);
            const { weekday, dayNumber } = dayLabel(ymd);
            const interactive = allowInteraction && inRange;
            const className = [
              "flex min-h-[3.5rem] flex-col items-center justify-center rounded-lg border px-0.5 py-2 text-center sm:min-h-0 sm:px-1 sm:py-2",
              selected
                ? "border-slate-900 bg-slate-900 text-white ring-2 ring-slate-900 ring-offset-2"
                : inRange
                  ? dayTone(ymd) +
                    (interactive ? " hover:border-slate-300 hover:bg-slate-50" : "")
                  : "border-slate-100 bg-slate-50 text-slate-400"
            ].join(" ");
            if (interactive) {
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => handleWeekdayPick(ymd)}
                  className={className}
                >
                  <span className="text-[0.65rem] font-medium uppercase text-current sm:text-xs">
                    {weekday}
                  </span>
                  <span className="text-sm font-semibold leading-tight sm:text-base">{dayNumber}</span>
                </button>
              );
            }
            return (
              <div
                key={ymd}
                className={className + (inRange ? " cursor-default" : " cursor-not-allowed opacity-80")}
                aria-current={selected ? "date" : undefined}
              >
                <span className="text-[0.65rem] font-medium uppercase sm:text-xs">{weekday}</span>
                <span className="text-sm font-semibold leading-tight sm:text-base">{dayNumber}</span>
              </div>
            );
          })}
        </div>
      </div>

      {showMonthCalendar ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={!allowInteraction || !canGoPrev}
              onClick={goPrevMonth}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous month"
            >
              ←
            </button>
            <h3 className="min-w-0 flex-1 text-center text-sm font-semibold text-slate-900">
              {monthTitle(WORKOUT_VIEW_YEAR, viewMonth)}
            </h3>
            <button
              type="button"
              disabled={!allowInteraction || !canGoNext}
              onClick={goNextMonth}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next month"
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-8 gap-0.5 text-center text-[0.6rem] font-medium uppercase text-slate-500 sm:text-xs">
            {WEEK_HEADER.map((d) => (
              <div key={d} className="min-w-0 py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="space-y-0.5">
            {monthRows.map((row, rowIndex) => {
              const wn = weekInMonthByRow[rowIndex] ?? null;
              const firstDay = row.find((c): c is { type: "day"; ymd: string } => c.type === "day");
              const canOpenReview = Boolean(wn && firstDay && historyByExercise);
              const openReview = () => {
                if (!canOpenReview || !wn || !firstDay || !historyByExercise) return;
                setWeekReviewOpen({
                  weekLabel: `Week ${wn} of ${getMonthName(viewMonth)} ${WORKOUT_VIEW_YEAR}`,
                  snapshot: computeWeekReview(allWorkoutEntries, historyByExercise, firstDay.ymd)
                });
              };
              return (
                <div
                  key={`mrow-${rowIndex}`}
                  className="grid min-w-0 grid-cols-8 items-stretch gap-0.5"
                >
                  {row.map((cell, ci) => renderMonthCell(cell, `r${rowIndex}-c${ci}`))}
                  {wn ? (
                    canOpenReview ? (
                      <button
                        type="button"
                        onClick={openReview}
                        className="flex min-h-[2.25rem] flex-col items-center justify-center rounded-md border-2 border-indigo-200/90 bg-indigo-50/90 px-0.5 text-center text-[0.65rem] font-semibold leading-tight text-indigo-900 shadow-sm hover:border-indigo-300 hover:bg-indigo-100/90 sm:text-xs"
                        title={`Weekly review for week ${wn}`}
                        aria-label={`Open weekly review for week ${wn} of ${getMonthName(viewMonth)}`}
                      >
                        <span className="text-indigo-600/90">W{wn}</span>
                        <span className="mt-0.5 text-[0.6rem] font-medium text-indigo-800/80">Review</span>
                      </button>
                    ) : (
                      <div
                        className="flex min-h-[2.25rem] flex-col items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/50 px-0.5 text-[0.6rem] text-slate-400"
                        title="Add workout history to see review"
                        aria-hidden
                      >
                        —
                      </div>
                    )
                  ) : (
                    <div className="min-h-[2.25rem] rounded-md border border-transparent" aria-hidden />
                  )}
                </div>
              );
            })}
          </div>

          {weekReviewOpen ? (
            <WeeklyReviewModal
              isOpen
              onBack={() => setWeekReviewOpen(null)}
              weekTitle={weekReviewOpen.weekLabel}
              snapshot={weekReviewOpen.snapshot}
            />
          ) : null}
          <p className="text-xs text-slate-500">
            Log dates are limited to {WORKOUT_DATE_MIN} through {WORKOUT_DATE_MAX}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
