"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAdminExerciseAnalyticsAction } from "@/lib/admin/adminDataActions";
import type {
  AdminExerciseAnalyticsConfigStat,
  AdminExerciseAnalyticsNameStat,
  AdminExerciseAnalyticsSnapshot
} from "@/lib/admin/exerciseAnalyticsAggregate";
import { supabase } from "@/lib/supabaseClient";
import { actionButtonClasses } from "@/components/action-button";

type Phase = "loading" | "login" | "unauthorized" | "ready" | "fetch_error";
type TypeFilter = "all" | "weight" | "bodyweight" | "time";
type SortKey = "users" | "sessions" | "cpsHigh" | "cpsLow" | "name";

function formatCps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return (Math.round(value * 10) / 10).toFixed(1);
}

function formatAvg(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function AdminExerciseAnalyticsClient({ expectedAdminEmail }: { expectedAdminEmail: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [snapshot, setSnapshot] = useState<AdminExerciseAnalyticsSnapshot | null>(null);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const load = useCallback(async (token: string) => {
    setPhase("loading");
    const res = await fetchAdminExerciseAnalyticsAction(token);
    if (!res.ok) {
      setFetchMessage(res.message);
      setPhase("fetch_error");
      return false;
    }
    setSnapshot(res.data);
    setPhase("ready");
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const expected = expectedAdminEmail.trim().toLowerCase();
      if (!expected) {
        if (!cancelled) {
          setFetchMessage("Admin email is not configured.");
          setPhase("fetch_error");
        }
        return;
      }
      const {
        data: { session },
        error: sessionError
      } = await supabase.auth.getSession();
      if (cancelled) return;
      const token = session?.access_token;
      const user = session?.user;
      if (sessionError || !user?.email || !token) {
        setPhase("login");
        return;
      }
      if (user.email.trim().toLowerCase() !== expected) {
        setPhase("unauthorized");
        return;
      }
      setAccessToken(token);
      await load(token);
    })();
    return () => {
      cancelled = true;
    };
  }, [expectedAdminEmail, load]);

  const filteredSorted = useMemo(() => {
    if (!snapshot) return [];
    const q = search.trim().toLowerCase();
    let list = snapshot.rows.filter((row) => {
      if (q && !row.displayName.toLowerCase().includes(q)) return false;
      if (typeFilter === "all") return true;
      if (row.primaryType === "mixed") {
        return row.configs.some((c) => c.type === typeFilter);
      }
      return row.primaryType === typeFilter;
    });
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case "users":
          return b.userCount - a.userCount || a.displayName.localeCompare(b.displayName);
        case "sessions":
          return b.sessionCount - a.sessionCount || a.displayName.localeCompare(b.displayName);
        case "cpsHigh": {
          const ah = a.cpsHigh ?? -Infinity;
          const bh = b.cpsHigh ?? -Infinity;
          return bh - ah || a.displayName.localeCompare(b.displayName);
        }
        case "cpsLow": {
          const al = a.cpsLow ?? Infinity;
          const bl = b.cpsLow ?? Infinity;
          return al - bl || a.displayName.localeCompare(b.displayName);
        }
        case "name":
        default:
          return a.displayName.localeCompare(b.displayName);
      }
    });
    return list;
  }, [snapshot, search, typeFilter, sortKey]);

  const toggleExpand = (nameKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nameKey)) next.delete(nameKey);
      else next.add(nameKey);
      return next;
    });
  };

  if (phase === "loading" && snapshot === null) {
    return (
      <p className="text-sm text-slate-600" aria-live="polite">
        Loading exercise analytics…
      </p>
    );
  }

  if (phase === "login") {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-sm text-slate-800" role="status">
        Please log in first.
      </div>
    );
  }

  if (phase === "unauthorized") {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-950" role="status">
        Not authorized.
      </div>
    );
  }

  if (phase === "fetch_error" || !snapshot) {
    return (
      <section className="space-y-4">
        <Link href="/admin" className="text-sm font-medium text-slate-700 underline underline-offset-2">
          ← Back to admin
        </Link>
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
          {fetchMessage ?? "Could not load exercise analytics."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm font-medium text-slate-700 underline underline-offset-2">
            ← Back to admin
          </Link>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Exercise Analytics</h2>
          <p className="mt-1 text-sm text-slate-600">
            Aggregate usage and CPS ranges by normalized exercise name (no individual user identities). Generated{" "}
            <span className="font-mono text-xs">{snapshot.generatedAt}</span>
          </p>
        </div>
        <button
          type="button"
          disabled={!accessToken}
          className={actionButtonClasses.secondary}
          onClick={() => {
            if (accessToken) void load(accessToken);
          }}
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="min-w-[200px] flex-1 space-y-1">
          <span className="text-xs font-medium text-slate-600">Search name</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm"
            placeholder="Filter by exercise name…"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-600">Type</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm"
          >
            <option value="all">All</option>
            <option value="weight">Weight</option>
            <option value="bodyweight">Bodyweight</option>
            <option value="time">Time</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-600">Sort</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm"
          >
            <option value="name">Exercise name</option>
            <option value="users">Most users</option>
            <option value="sessions">Most sessions</option>
            <option value="cpsHigh">Highest CPS</option>
            <option value="cpsLow">Lowest CPS</option>
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2" />
                <th className="px-3 py-2">Exercise</th>
                <th className="px-3 py-2 text-right">Users</th>
                <th className="px-3 py-2 text-right">Sessions</th>
                <th className="px-3 py-2 text-right">CPS high</th>
                <th className="px-3 py-2 text-right">CPS low</th>
                <th className="px-3 py-2 text-right">Configs</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-600">
                    No rows match this filter.
                  </td>
                </tr>
              ) : (
                filteredSorted.map((row) => (
                  <ExerciseNameRow
                    key={row.nameKey}
                    row={row}
                    expanded={expanded.has(row.nameKey)}
                    onToggle={() => toggleExpand(row.nameKey)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function ExerciseNameRow({
  row,
  expanded,
  onToggle
}: {
  row: AdminExerciseAnalyticsNameStat;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50/80">
        <td className="px-2 py-2 align-top">
          <button
            type="button"
            onClick={onToggle}
            className="rounded px-2 py-1 text-xs font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 hover:bg-slate-100"
            aria-expanded={expanded}
          >
            {expanded ? "−" : "+"}
          </button>
        </td>
        <td className="px-3 py-2">
          <button type="button" onClick={onToggle} className="text-left font-medium text-slate-900 hover:underline">
            {row.displayName}
          </button>
          <p className="text-[0.65rem] uppercase tracking-wide text-slate-400">
            Type: {row.primaryType} · key: {row.nameKey}
          </p>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{row.userCount}</td>
        <td className="px-3 py-2 text-right tabular-nums">{row.sessionCount}</td>
        <td className="px-3 py-2 text-right tabular-nums">{formatCps(row.cpsHigh)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{formatCps(row.cpsLow)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{row.distinctConfigCount}</td>
      </tr>
      {expanded
        ? row.configs.map((cfg) => (
            <tr key={cfg.fingerprint} className="border-t border-slate-100 bg-slate-50/90 text-xs">
              <td />
              <td className="px-3 py-2 pl-8 text-slate-700" colSpan={6}>
                <ConfigDetail cfg={cfg} />
              </td>
            </tr>
          ))
        : null}
    </>
  );
}

function ConfigDetail({ cfg }: { cfg: AdminExerciseAnalyticsConfigStat }) {
  const targetLabel = cfg.type === "time" ? "Target time (s)" : "Target reps";
  return (
    <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
      <p>
        <span className="font-medium text-slate-600">Sets:</span> {cfg.setCount}
      </p>
      <p>
        <span className="font-medium text-slate-600">{targetLabel}:</span> {cfg.targetReps}
      </p>
      <p>
        <span className="font-medium text-slate-600">Increment:</span> {cfg.increment} {cfg.unit}
      </p>
      <p>
        <span className="font-medium text-slate-600">Type:</span> {cfg.type}
      </p>
      <p>
        <span className="font-medium text-slate-600">Track RIR:</span> {cfg.trackRir ? "yes" : "no"} ·{" "}
        <span className="font-medium text-slate-600">Track RPE:</span> {cfg.trackRpe ? "yes" : "no"}
      </p>
      <p>
        <span className="font-medium text-slate-600">Users:</span> {cfg.userCount} ·{" "}
        <span className="font-medium text-slate-600">Sessions:</span> {cfg.sessionCount}
      </p>
      <p>
        <span className="font-medium text-slate-600">CPS high / low / avg:</span> {formatCps(cfg.cpsHigh)} /{" "}
        {formatCps(cfg.cpsLow)} / {formatAvg(cfg.cpsAverage)}
      </p>
    </div>
  );
}
