import type { ButtonHTMLAttributes } from "react";

/**
 * Shared Tailwind classes for button hierarchy (see PROJECT_CONTEXT.md).
 * Prefer `<ActionButton variant={...} />` or compose `className={actionButtonClasses.secondary}` when needed.
 */
export const actionButtonClasses = {
  primary:
    "inline-flex items-center justify-center rounded-md border border-black bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-45",
  primarySm:
    "inline-flex items-center justify-center rounded-md border border-black bg-black px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-45",
  secondary:
    "inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 disabled:cursor-not-allowed disabled:opacity-45",
  secondarySm:
    "inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 disabled:cursor-not-allowed disabled:opacity-50",
  destructive:
    "inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900 transition-colors enabled:hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 disabled:cursor-not-allowed disabled:opacity-50",
  destructiveSm:
    "inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-900 transition-colors enabled:hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 disabled:cursor-not-allowed disabled:opacity-50",
  destructiveSolid:
    "inline-flex items-center justify-center rounded-md border border-red-800 bg-red-800 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800",
  info:
    "inline-flex items-center justify-center rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:bg-sky-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
} as const;

export type ActionButtonVariant = keyof typeof actionButtonClasses;

export function actionButtonClass(
  variant: ActionButtonVariant,
  ...extra: (string | undefined)[]
): string {
  return [actionButtonClasses[variant], ...extra.filter(Boolean)].join(" ");
}

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant: ActionButtonVariant;
  className?: string;
};

export function ActionButton({ variant, className, type = "button", ...props }: ActionButtonProps) {
  return (
    <button
      type={type}
      className={[actionButtonClasses[variant], className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
