"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cleanupAdminOrphanedRowsAction, fetchAdminOverviewAction } from "@/lib/admin/adminDataActions";
import type { AdminOverview } from "@/lib/admin/queries";
import { supabase } from "@/lib/supabaseClient";

type Phase = "loading" | "login" | "unauthorized" | "ready" | "fetch_error";

export function AdminDashboardClient({ expectedAdminEmail }: { expectedAdminEmail: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  const loadOverview = useCallback(async (token: string) => {
    setPhase("loading");
    const res = await fetchAdminOverviewAction(token);
    if (!res.ok) {
      setFetchMessage(res.message);
      setPhase("fetch_error");
      return false;
    }
    setOverview(res.data);
    setPhase("ready");
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const expected = expectedAdminEmail.trim().toLowerCase();
      if (!expected) {
        if (!cancelled) setPhase("fetch_error");
        if (!cancelled) setFetchMessage("Admin email is not configured.");
        return;
      }

      const {
        data: { session },
        error: sessionError
      } = await supabase.auth.getSession();

      if (cancelled) return;

      const accessToken = session?.access_token;
      const user = session?.user;

      if (sessionError || !user?.email || !accessToken) {
        setPhase("login");
        return;
      }

      if (user.email.trim().toLowerCase() !== expected) {
        setPhase("unauthorized");
        return;
      }

      setAccessToken(accessToken);
      const didLoad = await loadOverview(accessToken);
      if (cancelled) return;
      if (!didLoad) return;
    })();

    return () => {
      cancelled = true;
    };
  }, [expectedAdminEmail, loadOverview]);

  if (phase === "loading" && overview === null) {
    return (
      <p className="text-sm text-slate-600" aria-live="polite">
        Loading admin dashboard…
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

  if (phase === "fetch_error" || !overview) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Could not load data</h2>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {fetchMessage ??
            "Admin data could not be loaded. Ensure SUPABASE_SERVICE_ROLE_KEY is set on the server (never in the browser)."}
        </p>
      </section>
    );
  }

  const { totals, users } = overview;
  const hasOrphanedRows =
    totals.orphanedWorkouts + totals.orphanedExercises + totals.orphanedPresets > 0;

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Overview</h2>
        <p className="mt-1 text-sm text-slate-600">Read-only overview (beta).</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active users (with data)</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totals.activeUsersWithData}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active workouts</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totals.workouts}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active exercises</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totals.exercises}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active presets</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totals.presets}</p>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="font-medium text-amber-900">
          Active Auth users: {totals.activeUsersTotal}
          {hasOrphanedRows ? " · Orphaned rows detected" : ""}
        </p>
        <p className="mt-1">
          Orphaned rows (deleted/missing auth users): workouts {totals.orphanedWorkouts}, exercises{" "}
          {totals.orphanedExercises}, presets {totals.orphanedPresets}.
        </p>
        {hasOrphanedRows ? (
          <div className="mt-3">
            <button
              type="button"
              disabled={isCleaning || !accessToken}
              onClick={async () => {
                if (!accessToken) return;
                const confirmed = window.confirm(
                  "Delete all orphaned rows for deleted users? This cannot be undone."
                );
                if (!confirmed) return;

                setIsCleaning(true);
                setCleanupMessage(null);
                setCleanupError(null);
                const res = await cleanupAdminOrphanedRowsAction(accessToken);
                if (!res.ok) {
                  setCleanupError(res.message);
                  setIsCleaning(false);
                  return;
                }

                const { deletedWorkouts, deletedExercises, deletedPresets } = res.data;
                if (deletedWorkouts + deletedExercises + deletedPresets === 0) {
                  setCleanupMessage("No orphaned rows were deleted.");
                } else {
                  setCleanupMessage(
                    `Deleted ${deletedWorkouts} orphaned workouts, ${deletedExercises} orphaned exercises, and ${deletedPresets} orphaned presets.`
                  );
                }
                await loadOverview(accessToken);
                setIsCleaning(false);
              }}
              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 enabled:hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCleaning ? "Cleaning..." : "Clean up orphaned rows"}
            </button>
          </div>
        ) : null}
        {cleanupMessage ? <p className="mt-2 text-xs text-amber-900">{cleanupMessage}</p> : null}
        {cleanupError ? <p className="mt-2 text-xs text-rose-900">{cleanupError}</p> : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Users</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">User ID</th>
                <th className="px-4 py-2 text-right">Workouts</th>
                <th className="px-4 py-2 text-right">Exercises</th>
                <th className="px-4 py-2 text-right">Presets</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-600">
                    No user rows found in Supabase tables.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.userId} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className="px-4 py-2 text-slate-900">{u.email ?? "—"}</td>
                    <td className="max-w-[200px] truncate px-4 py-2 font-mono text-xs text-slate-700">
                      {u.userId}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.workoutCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.exerciseCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.presetCount}</td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/admin/user/${u.userId}`}
                        className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
