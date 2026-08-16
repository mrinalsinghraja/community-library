import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Status is never carried by colour alone — every badge pairs its colour with a
 * word and a shape. A reader with colour vision deficiency, or one reading a
 * printed shelf list, must get the same information.
 */

export type StatusTone = "available" | "out" | "soon" | "late" | "neutral";

const TONE_CLASSES: Record<StatusTone, string> = {
  available: "bg-success-wash text-success",
  out: "bg-surface-sunk text-ink-soft",
  soon: "bg-warn-wash text-warn",
  late: "bg-danger-wash text-danger",
  neutral: "bg-primary-wash text-primary-deep",
};

const TONE_MARKS: Record<StatusTone, string> = {
  available: "●",
  out: "○",
  soon: "◐",
  late: "◆",
  neutral: "●",
};

export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-base font-bold",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="text-xs leading-none">
        {TONE_MARKS[tone]}
      </span>
      {children}
    </span>
  );
}
