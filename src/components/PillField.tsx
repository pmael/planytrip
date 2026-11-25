import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { glassSurface } from "./GlassCard";

/** The dashed pill every popup field is made of. Pass `invalid` to turn its border red. */
export const pillSurface = (invalid?: boolean) =>
  cn(
    "rounded-full border border-dashed bg-white/[0.18] text-2xl text-white shadow-[0_0_18px_rgb(110_210_180/0.18)] transition-colors focus-within:ring-2",
    invalid
      ? "border-rose-300/80 focus-within:border-rose-300 focus-within:ring-rose-300/30"
      : "border-emerald-200/40 focus-within:border-emerald-200/80 focus-within:ring-emerald-300/30",
  );

/** Round icon badge, then the field itself, then its error message underneath. */
export function FieldRow({
  icon,
  name,
  error,
  children,
}: {
  icon: ReactNode;
  /** The field's name, so the form can tell which field was touched */
  name: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative" data-field={name}>
      <div className="flex items-center gap-8">
        <span
          className={cn(
            glassSurface,
            "flex size-[92px] shrink-0 items-center justify-center rounded-full bg-white/[0.18] text-white [&_svg]:size-9 [&_svg]:stroke-[1.25]",
          )}
        >
          {icon}
        </span>
        {children}
      </div>
      {error && (
        <p role="alert" className="mt-2 ml-[124px] animate-[fade-up_0.3s_ease-out_both] text-lg text-rose-200">
          {error}
        </p>
      )}
    </div>
  );
}

/** Round icon badge followed by a dashed pill input. */
export function PillField({
  icon,
  error,
  className,
  ...props
}: { icon: ReactNode; error?: string; name: string } & ComponentProps<"input">) {
  return (
    <FieldRow icon={icon} name={props.name} error={error}>
      <input
        aria-invalid={error ? true : undefined}
        className={cn(
          pillSurface(Boolean(error)),
          "h-[86px] w-full px-10 outline-none placeholder:text-white/35",
          className,
        )}
        {...props}
      />
    </FieldRow>
  );
}
