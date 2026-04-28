"use client";

import { useEffect, useRef, useState } from "react";

/** Tooltip copy for exercise/workout configuration fields (shared across app forms). */
export const EXERCISE_CONFIG_HELP = {
  sets: "How many working sets you plan to log for this exercise.",
  targetReps: "The rep goal for each set. Progression is based on reaching this target.",
  targetTime: "The time goal for each set, usually in seconds.",
  increment: "How much weight the app recommends adding when you are ready to progress.",
  unit: "Choose whether this exercise uses pounds or kilograms.",
  rir: "Reps in reserve — how many more reps you felt you could have done.",
  rpe: "Rate of perceived exertion — how hard the set felt from 1 to 10.",
  tir: "Time in reserve — how many more seconds you felt you could have held."
} as const;

type HelpTooltipProps = {
  text: string;
  /** Screen reader label for the help control */
  label?: string;
};

export function HelpTooltip({ text, label = "Help" }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-flex items-center" ref={rootRef}>
      <button
        type="button"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-[0.65rem] font-semibold leading-none text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-800"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open ? (
        <div
          className="absolute left-0 top-full z-[60] mt-1 w-[min(100vw-2rem,16rem)] rounded-md border border-slate-200 bg-white p-2.5 text-xs leading-snug text-slate-700 shadow-lg"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <p>{text}</p>
          <button
            type="button"
            className="mt-2 text-xs font-medium text-slate-500 underline hover:text-slate-800"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function FieldLabelHelp({
  htmlFor,
  label,
  helpText,
  className
}: {
  htmlFor?: string;
  label: string;
  helpText: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <HelpTooltip text={helpText} label={`About ${label}`} />
    </div>
  );
}

/** Checkbox + label text + help icon (used for Track RIR / RPE / TIR rows). */
export function TrackCheckboxRow({
  checked,
  onChange,
  labelText,
  helpText,
  className
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelText: string;
  helpText: string;
  className?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 ${className ?? ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
      />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm text-slate-700">
        {labelText}
        <HelpTooltip text={helpText} label={`About ${labelText}`} />
      </span>
    </label>
  );
}
