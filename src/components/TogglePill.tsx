"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  emerald: {
    on: "border-emerald-200/60 bg-[#3f7a62]/85 shadow-[0_0_22px_rgb(46_196_143/0.45)]",
    off: "border-white/25 bg-[#7d968b]/80 hover:bg-[#8aa598]/90",
  },
  violet: {
    on: "border-violet-300/70 bg-violet-500/60 shadow-[0_0_24px_rgb(167_139_250/0.6)]",
    off: "border-violet-300/40 bg-violet-400/20 hover:bg-violet-400/30",
  },
};

/** A pill with a switch in it, for turning a part of the page on or off. */
export function TogglePill({
  checked,
  onChange,
  icon,
  label,
  tone = "emerald",
  busy,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon: ReactNode;
  label: string;
  tone?: keyof typeof TONES;
  /** Something is happening because of the switch: it pulses */
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-[60px] cursor-pointer items-center gap-3 rounded-full border px-4 text-xl sm:pr-3 sm:pl-5 text-white outline-none transition-[background-color,border-color,box-shadow,transform] duration-300 focus-visible:ring-2 focus-visible:ring-emerald-200/70 active:scale-[0.97] [&_svg]:size-6 [&_svg]:stroke-[1.5]",
        checked ? TONES[tone].on : TONES[tone].off,
        busy && "animate-[ai-breathe_1.6s_ease-in-out_infinite]",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span aria-hidden className={cn("relative ml-1 hidden h-8 w-14 rounded-full transition-colors duration-300 sm:block", checked ? "bg-white/45" : "bg-black/30")}>
        <span className={cn("absolute top-1 left-1 size-6 rounded-full bg-white shadow transition-transform duration-300", checked && "translate-x-6")} />
      </span>
    </button>
  );
}
