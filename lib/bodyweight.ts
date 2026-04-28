"use client";

export type BodyweightUnit = "lbs" | "kg";

export type BodyweightLog = {
  weekDate: string; // Sunday date (YYYY-MM-DD)
  bodyweight: number;
  unit: BodyweightUnit;
  createdAt: string;
  updatedAt: string;
};

function safeYmd(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export function toSundayYmd(date: string | Date): string {
  const d = typeof date === "string" ? new Date(`${date}T12:00:00`) : new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  const copy = new Date(d);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - day);
  const local = new Date(copy.getTime() - copy.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function isSundayYmd(dateYmd: string): boolean {
  const date = new Date(`${dateYmd}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return false;
  return date.getDay() === 0;
}

export function safeBodyweightLogs(input: unknown): BodyweightLog[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is BodyweightLog => {
      if (!item || typeof item !== "object") return false;
      const row = item as Partial<BodyweightLog>;
      return (
        typeof row.weekDate === "string" &&
        typeof row.bodyweight === "number" &&
        Number.isFinite(row.bodyweight) &&
        row.bodyweight > 0 &&
        (row.unit === "lbs" || row.unit === "kg")
      );
    })
    .map((item) => {
      const weekDate = safeYmd(item.weekDate) || toSundayYmd(new Date());
      const createdAt = typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString();
      const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : createdAt;
      return { ...item, weekDate, createdAt, updatedAt };
    })
    .sort((a, b) => b.weekDate.localeCompare(a.weekDate));
}

export function listBodyweightLogs(logs: BodyweightLog[]): BodyweightLog[] {
  return [...logs].sort((a, b) => b.weekDate.localeCompare(a.weekDate));
}

export function getLatestBodyweight(logs: BodyweightLog[]): BodyweightLog | null {
  const sorted = listBodyweightLogs(logs);
  return sorted[0] ?? null;
}

export function getEffectiveBodyweightForDate(
  logs: BodyweightLog[],
  date: string
): BodyweightLog | null {
  const ymd = safeYmd(date);
  if (!ymd) return null;
  const sorted = listBodyweightLogs(logs);
  return sorted.find((log) => log.weekDate <= ymd) ?? null;
}

