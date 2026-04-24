/** Inclusive bounds for loggable workout dates (matches existing behavior). */
export const WORKOUT_DATE_MIN = "2026-01-01";
export const WORKOUT_DATE_MAX = "2026-12-31";

export function ymdFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

export function isYmdInWorkoutRange(ymd: string): boolean {
  return ymd.length >= 10 && ymd >= WORKOUT_DATE_MIN && ymd <= WORKOUT_DATE_MAX;
}

/**
 * The seven local calendar days from Sunday through Saturday for the week
 * that contains `anchorYmd` (inclusive, Sun–Sat in local time).
 */
export function getWeekDaysSunToSat(anchorYmd: string): string[] {
  const p = parseYmd(anchorYmd);
  if (!p) return [];
  const mid = new Date(p.y, p.m - 1, p.d, 12, 0, 0, 0);
  const sun = new Date(mid);
  sun.setDate(mid.getDate() - mid.getDay());
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const t = new Date(sun);
    t.setDate(sun.getDate() + i);
    out.push(ymdFromParts(t.getFullYear(), t.getMonth() + 1, t.getDate()));
  }
  return out;
}

export type MonthCell = { type: "blank" } | { type: "day"; ymd: string };

/**
 * 7-column rows (Sun-first). Pads the leading gap before the 1st, then
 * all days, then trailing blanks to fill a multiple of 7 and at least 5 rows
 * (35) or 6 rows (42) for layout stability.
 */
export function getMonthGridCells(viewYear: number, viewMonth1: number): MonthCell[] {
  const first = new Date(viewYear, viewMonth1 - 1, 1, 12, 0, 0, 0);
  const startPad = first.getDay();
  const lastDay = new Date(viewYear, viewMonth1, 0, 12, 0, 0, 0).getDate();
  const cells: MonthCell[] = [];
  for (let i = 0; i < startPad; i++) {
    cells.push({ type: "blank" });
  }
  for (let d = 1; d <= lastDay; d++) {
    cells.push({ type: "day", ymd: ymdFromParts(viewYear, viewMonth1, d) });
  }
  const minCells = 35;
  const total = Math.max(minCells, Math.ceil(cells.length / 7) * 7);
  while (cells.length < total) {
    cells.push({ type: "blank" });
  }
  return cells;
}

export function isSameYmd(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

/** 2026-only calendar: single allowed view year. */
export const WORKOUT_VIEW_YEAR = 2026;
