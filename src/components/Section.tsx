import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { glassSurface } from "./GlassCard";

/** A titled panel of a settings-like page: it comes in after its neighbours, one by one. */
export function Section({ title, hint, index, children, className }: { title: string; hint?: string; index: number; children: ReactNode; className?: string }) {
  return (
    <section
      aria-label={title}
      className={cn(glassSurface, "flex animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both] flex-col gap-6 rounded-[44px] bg-white/[0.12] p-8 text-white", className)}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <header>
        <h2 className="text-3xl font-normal">{title}</h2>
        {hint && <p className="mt-1 text-lg text-white/65">{hint}</p>}
      </header>
      {children}
    </section>
  );
}
