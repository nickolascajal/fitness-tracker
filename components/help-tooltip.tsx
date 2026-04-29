"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Tooltip copy for exercise/workout configuration fields (shared across app forms). */
export const EXERCISE_CONFIG_HELP = {
  sets: "How many working sets you plan to log for this exercise.",
  targetReps: "The rep goal for each set. Progression is based on reaching this target.",
  targetTime: "The time goal for each set, usually in seconds.",
  increment:
    "Controls how much weight gets added when the app recommends progressing. Different equipment uses different jumps — for example dumbbells, barbells, and machines may all increase differently.",
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
  const [mounted, setMounted] = useState(false);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const maxPanelWidth = Math.min(viewportW - 16, 256);
      const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportW - maxPanelWidth - 8));
      const top = Math.min(window.innerHeight - 8, rect.bottom + 6);
      setPanelStyle({ top, left });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <div className="relative inline-flex items-center" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="group -m-2 inline-flex shrink-0 touch-manipulation items-center justify-center rounded-full p-2 text-[0.6rem] font-medium leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="flex h-[15px] w-[15px] items-center justify-center rounded-full border border-white/15 bg-zinc-900 text-white shadow-sm transition-colors group-hover:bg-zinc-800 group-active:bg-zinc-950"
          aria-hidden
        >
          ?
        </span>
      </button>
      {open && mounted
        ? createPortal(
            <div
              className="fixed z-[100] w-[min(calc(100vw-1rem),16rem)] rounded-md border border-slate-200 bg-white p-2.5 text-xs leading-snug text-slate-700 shadow-lg"
              style={{ top: panelStyle.top, left: panelStyle.left }}
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
            </div>,
            document.body
          )
        : null}
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
