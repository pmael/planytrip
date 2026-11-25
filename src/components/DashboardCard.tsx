import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { glassSurface } from "./GlassCard";

/**
 * Grey card holding white tiles and a caption underneath. `glow` tints its halo. With `href` the
 * whole card is a link to the page the caption names.
 */
export function DashboardCard({
  caption,
  glow,
  delay = 0,
  href,
  className,
  children,
}: {
  caption: string;
  /** CSS colour for the halo, e.g. "rgb(120 160 255 / 0.35)" */
  glow: string;
  delay?: number;
  href?: string;
  className?: string;
  children: ReactNode;
}) {
  const classes = cn(
    glassSurface,
    "flex animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both] flex-col gap-5 rounded-[44px] bg-white/[0.16] p-[30px] pb-6 text-2xl text-white",
    href && "cursor-pointer outline-none transition-[transform,background-color] duration-300 hover:scale-[1.015] hover:bg-white/[0.22] focus-visible:ring-2 focus-visible:ring-emerald-300/60",
    className,
  );
  const style = { boxShadow: `0 0 30px ${glow}`, animationDelay: `${delay}ms` };
  const body = (
    <>
      <div className="flex flex-1 flex-col gap-5">{children}</div>
      <h2 className="text-center text-2xl font-normal">{caption}</h2>
    </>
  );

  return href ? (
    <Link href={href} aria-label={`${caption}: open`} className={classes} style={style}>
      {body}
    </Link>
  ) : (
    <section className={classes} style={style}>
      {body}
    </section>
  );
}

/** White tile inside a card. */
export function Tile({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-[22px] bg-white text-[#0d4a35]", className)}>{children}</div>;
}

/** "Label | value" tile used by the budget card. `valueClass` colours the value. */
export function StatTile({ label, value, valueClass = "text-[#2ec48f]" }: { label: string; value: ReactNode; valueClass?: string }) {
  return (
    <Tile className="flex flex-1 items-center gap-6 px-8 text-4xl">
      <span className="w-[42%] whitespace-nowrap">{label}</span>
      <span aria-hidden className="h-[60%] w-px bg-[#0d4a35]/70" />
      <span className={valueClass}>{value}</span>
    </Tile>
  );
}

/** Labels split by dividers, at the foot of a tile. */
export function SplitLabel({ labels }: { labels: string[] }) {
  return (
    <p className="mt-auto flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xl text-black">
      {labels.map((label, index) => (
        <span key={label} className="flex items-center gap-6">
          {index > 0 && <span aria-hidden className="h-6 w-px bg-black/70" />}
          {label}
        </span>
      ))}
    </p>
  );
}
