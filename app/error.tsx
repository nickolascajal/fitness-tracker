"use client";

import { useEffect } from "react";

/**
 * Catches runtime errors in route segments (pages, layouts below root).
 * Does not catch errors inside event handlers — those need try/catch locally.
 */
export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Fitness Tracker]", error);
  }, [error]);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-8 text-center">
      <h2 className="text-lg font-semibold text-slate-900">Something went wrong</h2>
      <p className="mt-2 text-sm text-slate-600">
        An unexpected error occurred while rendering this page. You can try again—your saved data in
        this browser is usually still there.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Try again
      </button>
    </div>
  );
}
