import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { glassSurface } from "./GlassCard";

export type Tone = "good" | "warn" | "bad" | "neutral";

const toneText: Record<Tone, string> = {
  good: "text-[#2ec48f]",
  warn: "text-[#c9a227]",
  bad: "text-[#d33a2f]",
  neutral: "text-[#1f1f1f]",
};

const rowIn = "animate-[row-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both]";

/**
 * Glass pill holding one entry (a guest, a destination...). Children are its segments. When
 * `onRemove` is given, a small ✕ appears at the end of the pill on hover or focus.
 */
export function EntryRow({
  children,
  onRemove,
  removeLabel = "Remove",
  badge,
}: {
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  /** A small label straddling the top edge of the pill, e.g. "Outside Europe" */
  badge?: ReactNode;
}) {
  return (
    <li
      className={cn(
        glassSurface,
        rowIn,
        "group relative flex h-[86px] items-center justify-between gap-5 rounded-full px-9 text-2xl text-white [&_svg]:stroke-[1.25]",
      )}
    >
      {badge && (
        <span className="absolute -top-3 left-14 rounded-full border border-amber-200/50 bg-[#7a6a3a] px-4 py-0.5 text-base text-amber-100 shadow-[0_0_14px_rgb(251_191_36/0.3)]">
          {badge}
        </span>
      )}
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          onClick={onRemove}
          className="absolute top-1/2 right-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white opacity-0 outline-none transition-[opacity,background-color] hover:bg-rose-500/70 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-emerald-300/60 group-hover:opacity-100 [&_svg]:size-5 [&_svg]:stroke-2"
        >
          <X aria-hidden />
        </button>
      )}
    </li>
  );
}

/** Empty slot shown after the last entry. */
export function EmptyEntryRow() {
  return (
    <li
      aria-hidden
      className={cn(
        rowIn,
        "h-[86px] rounded-full border border-dashed border-emerald-200/40 bg-white/[0.14] shadow-[0_0_18px_rgb(110_210_180/0.18)]",
      )}
    />
  );
}

export function Divider() {
  return <span aria-hidden className="h-8 w-px shrink-0 bg-white/70" />;
}

/** Icon + text segment, plain on the glass. */
export function TextSegment({
  icon,
  className,
  children,
}: {
  icon: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-4 [&_svg]:size-7 [&_svg]:shrink-0", className)}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </span>
  );
}

/** White pill with an icon and a coloured value. */
export function ValuePill({
  icon,
  tone,
  className,
  children,
}: {
  icon: ReactNode;
  tone: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex h-[52px] shrink-0 items-center gap-3 rounded-full bg-white px-4 text-[#0d4a35] [&_svg]:size-7 [&_svg]:stroke-[1.5]",
        className,
      )}
    >
      {icon}
      <span className={cn("flex-1 whitespace-nowrap text-center text-2xl", toneText[tone])}>{children}</span>
    </span>
  );
}
