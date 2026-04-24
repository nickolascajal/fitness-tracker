"use client";

import type { ReactNode } from "react";
import type { WeekReviewSnapshot } from "@/lib/weeklyReview";

function trendFromValueLabel(valueLabel: string): { arrow: string; toneClass: string } {
  const match = valueLabel.match(/[-+]?\d+(?:\.\d+)?/);
  const value = match ? Number(match[0]) : 0;
  if (value > 0) return { arrow: "↑", toneClass: "text-emerald-700" };
  if (value < 0) return { arrow: "↓", toneClass: "text-rose-700" };
  return { arrow: "→", toneClass: "text-amber-700" };
}

export function weekReviewBodyFromSnapshot(s: WeekReviewSnapshot): { cps: ReactNode; vol: ReactNode } {
  const cpsNode = (c: WeekReviewSnapshot["cpsChangeLeader"]) => {
    if (!c) {
      return (
        <span className="text-slate-500">Not enough data for a positive change vs the last session.</span>
      );
    }
    const trend = trendFromValueLabel(c.valueLabel);
    return (
      <>
        <span className="font-semibold text-slate-900">{c.exerciseName}</span>{" "}
        <span className={`font-medium ${trend.toneClass}`}>({trend.arrow} {c.valueLabel})</span>
      </>
    );
  };
  const v = s.largestVolumeImprovement;
  const volTrend = v ? trendFromValueLabel(v.valueLabel) : null;
  return {
    cps: cpsNode(s.cpsChangeLeader),
    vol: !v ? (
      <span className="text-slate-500">Not enough data for a positive volume change vs the last session.</span>
    ) : (
      <>
        <span className="font-semibold text-slate-900">{v.exerciseName}</span>{" "}
        <span className={`font-medium ${volTrend?.toneClass ?? "text-amber-700"}`}>
          ({volTrend?.arrow ?? "→"} {v.valueLabel})
        </span>
      </>
    )
  };
}
