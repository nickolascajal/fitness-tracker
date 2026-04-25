"use client";

import { useEffect, useState } from "react";
import { getPendingSyncCount } from "@/lib/storage";

export function PendingSyncStatus() {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const refresh = () => {
      setPendingCount(getPendingSyncCount());
    };
    refresh();
    window.addEventListener("fitness-tracker:pending-sync-updated", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener("fitness-tracker:pending-sync-updated", refresh);
      window.removeEventListener("online", refresh);
    };
  }, []);

  if (pendingCount <= 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-full border border-amber-300/50 bg-amber-100/90 px-3 py-1 text-xs font-medium text-amber-900 shadow-sm">
      Saved locally - will sync when online.
    </div>
  );
}
