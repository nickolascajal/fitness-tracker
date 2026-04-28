"use client";

import { useEffect } from "react";
import type { WeekReviewSnapshot } from "@/lib/weeklyReview";
import { actionButtonClasses } from "@/components/action-button";
import { weekReviewBodyFromSnapshot } from "./weeklyReviewContent";

type WeeklyReviewModalProps = {
  isOpen: boolean;
  onBack: () => void;
  /** e.g. "Week 1 of April" */
  weekTitle: string;
  snapshot: WeekReviewSnapshot;
};

export function WeeklyReviewModal({ isOpen, onBack, weekTitle, snapshot }: WeeklyReviewModalProps) {
  const body = weekReviewBodyFromSnapshot(snapshot);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onBack]);

  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="weekly-review-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-slate-900/50"
        onClick={onBack}
        aria-label="Close weekly review"
      />
      <div
        className="relative z-[101] w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="weekly-review-title">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">Weekly review</h2>
          <p className="mt-0.5 text-sm text-slate-600">{weekTitle}</p>
        </div>
        <ul className="mt-4 list-none space-y-3.5 pl-0 text-sm leading-relaxed sm:text-base">
          <li>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top performer</p>
            <p className="mt-1 text-slate-800">{body.cps}</p>
          </li>
          <li>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Biggest CPS improvement
            </p>
            <p className="mt-1 text-slate-800">{body.cps}</p>
          </li>
          <li>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Biggest volume improvement
            </p>
            <p className="mt-1 text-slate-800">{body.vol}</p>
          </li>
        </ul>
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onBack} className={actionButtonClasses.secondary}>
            Back to calendar
          </button>
        </div>
      </div>
    </div>
  );
}
