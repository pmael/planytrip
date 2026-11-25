"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FieldRow, pillSurface } from "./PillField";

const dateInput =
  "h-full min-w-0 flex-1 bg-transparent text-2xl text-white outline-none [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer";

/**
 * Same look as `PillField`, but the pill holds a start and an end date. Submits as
 * `<name>From` and `<name>To`; the end date can't be set before the start date.
 */
export function DateRangeField({ icon, name, error }: { icon: ReactNode; name: string; error?: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  return (
    <FieldRow icon={icon} name={name} error={error}>
      <div className={cn(pillSurface(Boolean(error)), "flex h-[86px] w-full items-center gap-6 px-10 text-white/60")}>
        <label className="flex h-full min-w-0 flex-1 items-center gap-4">
          From
          <input
            type="date"
            name={`${name}From`}
            value={from}
            max={to || undefined}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setFrom(e.target.value)}
            className={cn(dateInput, !from && "text-white/35")}
          />
        </label>
        <label className="flex h-full min-w-0 flex-1 items-center gap-4">
          To
          <input
            type="date"
            name={`${name}To`}
            value={to}
            min={from || undefined}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setTo(e.target.value)}
            className={cn(dateInput, !to && "text-white/35")}
          />
        </label>
      </div>
    </FieldRow>
  );
}
