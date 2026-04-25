import type { ReactNode } from "react";
import { getAdminAccessState } from "@/lib/admin/getAdminAccessState";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const state = await getAdminAccessState();

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-12">
      <header className="-mx-4 border-b border-slate-200 bg-white px-4 py-4">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin Dashboard</h1>
        </div>
      </header>

      {!state.ok ? (
        <div className="mx-auto mt-6 max-w-4xl" role="alert">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-semibold text-amber-900">Admin preview — access blocked</p>
            <p className="mt-2 whitespace-pre-wrap">{state.message}</p>
            {state.detail ? (
              <p className="mt-3 whitespace-pre-wrap rounded-md bg-amber-100/80 px-3 py-2 font-mono text-xs text-amber-950">
                {state.detail}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-5xl pt-6">{children}</div>
      )}
    </div>
  );
}
