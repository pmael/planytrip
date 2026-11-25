import Image from "next/image";
import { cn } from "@/lib/utils";

const LOGOS = {
  /** The name on one line */
  horizontal: { file: "logo-horizontal.png", width: 505, height: 83 },
  /** "Plany" over "Trip" */
  stacked: { file: "logo-stacked.png", width: 280, height: 169 },
  /** The icon beside "Plany" over "Trip" */
  iconStacked: { file: "logo-icon-stacked.png", width: { light: 409, green: 389 }, height: 183 },
  /** The icon alone */
  icon: { file: "icon.png", width: 92, height: 92 },
} as const;

type Variant = keyof typeof LOGOS;

/** The logo comes in two colours: the light one for the app's dark screens, the green one for a white page. */
function sizeOf(variant: Variant, tone: "light" | "green") {
  const { width, height } = LOGOS[variant];
  return { width: typeof width === "number" ? width : width[tone], height };
}

/**
 * The PlanyTrip logo. `tone="light"` (the default) is for the dark screens of the app, `green` for a white
 * surface such as the PDF or a README.
 */
export function Logo({
  variant = "horizontal",
  tone = "light",
  width,
  className,
  priority,
}: {
  variant?: Variant;
  tone?: "light" | "green";
  width?: number;
  className?: string;
  priority?: boolean;
}) {
  const natural = sizeOf(variant, tone);
  const shown = width ?? natural.width;
  return (
    <Image
      src={`/brand/${tone === "light" ? "light/" : ""}${LOGOS[variant].file}`}
      alt="PlanyTrip"
      width={shown}
      height={Math.round((natural.height / natural.width) * shown)}
      priority={priority}
      className={cn("h-auto max-w-full", className)}
    />
  );
}

/** The icon next to the one-line name, put together from the two pictures. */
export function LogoWithIcon({ width = 220, tone = "light", className }: { width?: number; tone?: "light" | "green"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Logo variant="icon" tone={tone} width={Math.round(width * 0.2)} priority />
      <Logo variant="horizontal" tone={tone} width={Math.round(width * 0.78)} priority />
    </span>
  );
}
