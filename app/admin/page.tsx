import Link from "next/link";
import { getAdminOverview } from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export default async function AdminDashboardPage() {
  await requireAdmin();

  let overview;
  try {
    overview = await getAdminOverview();
  } catch {
    return (
      <section className="mx-auto max-w-4xl space-y-4 pt-6">
        <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Admin data could not be loaded. Ensure <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> is set
          on the server (never in the browser) and redeploy.
        </p>
      </section>
    );
  }

  const { totals, users } = overview;

  return (
    <section className="mx-auto max-w-5xl space-y-6 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">Read-only overview (beta).</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Users (with workouts)</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totals.usersWithData}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total workouts</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totals.workouts}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total exercises</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totals.exercises}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total presets</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totals.presets}</p>
        </div>
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
