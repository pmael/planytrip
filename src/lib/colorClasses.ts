// How the colour words of core/colors.ts look on the white cards of the dashboard.
import type { Tone } from "@/components/EntryRow";
import type { BudgetTier, Color } from "@/core/types";
import { colorOf } from "@/core/colors";

export const COLOR_TEXT: Record<Color, string> = {
  green: "text-[#2ec48f]",
  yellow: "text-[#c9a227]",
  red: "text-[#d33a2f]",
  neutral: "text-[#1f1f1f]",
};

const TONES: Record<Color, Tone> = { green: "good", yellow: "warn", red: "bad", neutral: "neutral" };

/** The tone the pills of the entry rows use for a colour word. */
export const toneOfColor = (color: Color): Tone => TONES[color];

/** The tone for a budget tier: comfy is green, limited yellow, over red. */
export const toneOfTier = (tier: BudgetTier): Tone => TONES[colorOf("budget", tier)];

export const TIER_LABELS: Record<BudgetTier, string> = { comfy: "Comfy", limited: "Limited", over: "Over budget" };
