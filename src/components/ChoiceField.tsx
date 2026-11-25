"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FieldRow, pillSurface } from "./PillField";

export type Choice = { id: string; label: string; icon?: ReactNode };

/**
 * The pill holds one button per choice, one of them selected (optionally from the start).
 * Submits the chosen id as `<name>`, an empty string while nothing is chosen.
 */
export function ChoiceField({
  icon,
  name,
  label,
  choices,
  defaultValue = "",
  error,
}: {
  icon: ReactNode;
  name: string;
  /** Names the group for screen readers */
  label: string;
  choices: Choice[];
  defaultValue?: string;
  error?: string;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <FieldRow icon={icon} name={name} error={error}>
      <div
        role="radiogroup"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        className={cn(pillSurface(Boolean(error)), "flex h-[86px] w-full items-center gap-3 px-3")}
      >
        {choices.map((choice) => {
          const selected = value === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setValue(choice.id)}
              className={cn(
                "flex h-[62px] min-w-0 flex-1 items-center justify-center gap-3 rounded-full px-2 text-2xl outline-none transition-[background-color,color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-emerald-300/60 active:scale-[0.97] [&_svg]:size-7 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
                selected ? "bg-white text-[#0d4a35]" : "text-white/55 hover:bg-white/10 hover:text-white",
              )}
            >
              {choice.icon}
              <span className="truncate">{choice.label}</span>
            </button>
          );
        })}
      </div>
      <input type="hidden" name={name} value={value} />
    </FieldRow>
  );
}
