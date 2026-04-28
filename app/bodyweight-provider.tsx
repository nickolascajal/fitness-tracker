"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadClientBodyweightLogs, saveClientBodyweightLogs } from "@/lib/storage";
import { supabase } from "@/lib/supabaseClient";
import {
  type BodyweightLog,
  type BodyweightUnit,
  getEffectiveBodyweightForDate,
  getLatestBodyweight,
  listBodyweightLogs,
  safeBodyweightLogs
} from "@/lib/bodyweight";

type BodyweightContextValue = {
  logs: BodyweightLog[];
  listBodyweightLogs: () => BodyweightLog[];
  getLatestBodyweight: () => BodyweightLog | null;
  getEffectiveBodyweightForDate: (date: string) => BodyweightLog | null;
  upsertWeeklyBodyweight: (weekDate: string, bodyweight: number, unit: BodyweightUnit) => Promise<void>;
};

const BodyweightContext = createContext<BodyweightContextValue | null>(null);

export function BodyweightProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<BodyweightLog[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLogs(safeBodyweightLogs(loadClientBodyweightLogs()));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveClientBodyweightLogs(logs);
  }, [hydrated, logs]);

  useEffect(() => {
    if (!hydrated) return;
    const fetchRemote = async () => {
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase
          .from("bodyweight_logs")
          .select("week_date,bodyweight,unit,created_at,updated_at")
          .eq("user_id", user.id)
          .order("week_date", { ascending: false });
        if (error) return;
        const mapped = safeBodyweightLogs(
          (data ?? []).map((row) => ({
            weekDate: String((row as { week_date?: unknown }).week_date ?? ""),
            bodyweight: Number((row as { bodyweight?: unknown }).bodyweight ?? 0),
            unit: (row as { unit?: unknown }).unit === "kg" ? "kg" : "lbs",
            createdAt: String((row as { created_at?: unknown }).created_at ?? ""),
            updatedAt: String((row as { updated_at?: unknown }).updated_at ?? "")
          }))
        );
        setLogs(mapped);
      } catch {
        // local fallback remains active
      }
    };
    void fetchRemote();
  }, [hydrated]);

  const upsertWeeklyBodyweight = useCallback(
    async (weekDate: string, bodyweight: number, unit: BodyweightUnit) => {
      const now = new Date().toISOString();
      setLogs((previous) => {
        const idx = previous.findIndex((log) => log.weekDate === weekDate);
        if (idx < 0) {
          return [{ weekDate, bodyweight, unit, createdAt: now, updatedAt: now }, ...previous];
        }
        const next = [...previous];
        next[idx] = { ...next[idx]!, bodyweight, unit, updatedAt: now };
        return next;
      });
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from("bodyweight_logs").upsert(
          {
            user_id: user.id,
            week_date: weekDate,
            bodyweight,
            unit,
            updated_at: now
          },
          { onConflict: "user_id,week_date" }
        );
      } catch {
        // local fallback already updated
      }
    },
    []
  );

  const value = useMemo<BodyweightContextValue>(
    () => ({
      logs,
      listBodyweightLogs: () => listBodyweightLogs(logs),
      getLatestBodyweight: () => getLatestBodyweight(logs),
      getEffectiveBodyweightForDate: (date: string) => getEffectiveBodyweightForDate(logs, date),
      upsertWeeklyBodyweight
    }),
    [logs, upsertWeeklyBodyweight]
  );

  return <BodyweightContext.Provider value={value}>{children}</BodyweightContext.Provider>;
}

export function useBodyweight() {
  const context = useContext(BodyweightContext);
  if (!context) {
    throw new Error("useBodyweight must be used within a BodyweightProvider");
  }
  return context;
}

