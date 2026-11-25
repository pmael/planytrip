import { ChevronDown, ChevronUp, Waves } from "lucide-react";
import { colorOf } from "@/core/colors";
import type { Trend } from "@/core/types";
import { COLOR_TEXT } from "@/lib/colorClasses";
import { cn } from "@/lib/utils";

const ICONS = { "▲": ChevronUp, "▼": ChevronDown, "≈": Waves };
const LABELS: Record<Trend, string> = {
  "▲": "Lowest of the destinations",
  "▼": "Highest of the destinations",
  "≈": "In between",
};

/** ▲ ▼ ≈ as an icon: the lowest figure among the destinations is green, the highest red, the rest yellow. */
export function TrendIcon({ trend, className }: { trend: Trend; className?: string }) {
  const Icon = ICONS[trend];
  return (
    <span role="img" aria-label={LABELS[trend]} title={LABELS[trend]} className={cn("inline-flex", COLOR_TEXT[colorOf("trend", trend)], className)}>
      <Icon aria-hidden className="size-8 stroke-[2.5]" />
    </span>
  );
}
