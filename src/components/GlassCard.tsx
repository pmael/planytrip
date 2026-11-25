import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const glassSurface =
  "border border-white/15 bg-white/[0.14] shadow-[0_0_24px_rgb(110_210_180/0.18)] backdrop-blur-md";

export function GlassCard({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(glassSurface, className)} {...props} />;
}
