import Link from "next/link";
import { getAdminAccessState } from "@/lib/admin/getAdminAccessState";
import { getUserWorkoutsForAdmin, groupWorkoutsByDate } from "@/lib/admin/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatCps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return (Math.round(value * 10) / 10).toFixed(1);
}

type PageProps = {
  params: Promise<{ userId: string }>;
};

export default async function AdminUserDetailPage(props: PageProps) {
  const access = await getAdminAccessState();
  if (!access.ok) {
    return null;
  }

  const { userId } = await props.params;

  if (!UUID_RE.test(userId)) {
    return (
      <section className="space-y-4">
        <Link href="/admin" className="text-sm font-medium text-slate-700 underline underline-offset-2">
          ← Back to admin
        </Link>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Invalid user id in URL. Expected a UUID.
        </p>
      </section>
    );
  }

  let rows;
  try {
    rows = await getUserWorkoutsForAdmin(userId);
  } catch {
    return (
      <section className="mx-auto max-w-4xl space-y-4">
        <Link href="/admin" className="text-sm font-medium text-slate-700 underline underline-offset-2">
          ← Back to admin
        </Link>
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
          Could not load workouts. Check server <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </section>
    );
  }

  const byDate = groupWorkoutsByDate(rows);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm font-medium text-slate-700 underline underline-offset-2">
            ← Back to admin
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">User workouts</h1>
          <p className="mt-1 font-mono text-xs text-slate-600">{userId}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No workout rows for this user in Supabase.
        </p>
      ) : null}

      <div className="space-y-8">
        {Array.from(byDate.entries()).map(([dateKey, dayRows]) => (
          <div key={dateKey} className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
              <h2 className="text-sm font-semibold text-slate-800">{dateKey}</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {dayRows.map((row) => (
                <div key={row.id} className="space-y-3 px-4 py-4">
                  {row.parsed ? (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-base font-semibold text-slate-900">{row.parsed.exerciseName}</p>
                          <p className="text-xs text-slate-500">
                            Submitted: {row.parsed.submittedAt}
                            {row.parsed.updatedAt ? ` · Updated: ${row.parsed.updatedAt}` : ""}
                            {row.createdAt ? ` · Row created_at: ${row.createdAt}` : ""}
                          </p>
                          {row.parsed.isDraft ? (
                            <p className="mt-1 text-xs font-medium text-amber-800">Draft</p>
                          ) : null}
                        </div>
                        <div className="text-right text-sm text-slate-700">
                          <p>
                            CPS: <span className="font-semibold">{formatCps(row.parsed.sessionCps)}</span>
                          </p>
                          <p>Volume: {row.parsed.sessionVolume}</p>
                          <p className="text-xs text-slate-500">{row.parsed.progressionStage}</p>
                        </div>
                      </div>
                      <p className="text-sm text-slate-800">
                        <span className="font-medium text-slate-600">Recommendation:</span>{" "}
                        {row.parsed.recommendation}
                      </p>
                      <div className="overflow-x-auto rounded-md border border-slate-200">
                        <table className="min-w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-600">
                            <tr>
                              <th className="px-2 py-1.5">Set</th>
                              <th className="px-2 py-1.5">Weight</th>
                              <th className="px-2 py-1.5">Reps</th>
                              <th className="px-2 py-1.5">Time (s)</th>
                              <th className="px-2 py-1.5">RIR</th>
                              <th className="px-2 py-1.5">RPE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.parsed.sets.map((set, i) => (
                              <tr key={i} className="border-t border-slate-100">
                                <td className="px-2 py-1.5 tabular-nums">{i + 1}</td>
                                <td className="px-2 py-1.5">{set.weight}</td>
                                <td className="px-2 py-1.5">{set.reps}</td>
                                <td className="px-2 py-1.5 tabular-nums">{set.timeSeconds}</td>
                                <td className="px-2 py-1.5">{set.rir || "—"}</td>
                                <td className="px-2 py-1.5">{set.rpe || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-rose-800">Unparseable workout row</p>
                      <p className="mt-1 font-mono text-xs text-slate-600">id: {row.id}</p>
                      {row.rawPreview ? (
                        <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-800">
                          {row.rawPreview}
                        </pre>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
