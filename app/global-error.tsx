"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Catches errors in the root layout. Replaces the whole tree, so it includes html/body.
 */
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Fitness Tracker] Root error", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-8">
          <div className="w-full rounded-lg border border-rose-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-600">
              The app failed to load. Try again, or refresh the page.
            </p>
            <button
              type="button"
              onClick={() => reset()}
              className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
