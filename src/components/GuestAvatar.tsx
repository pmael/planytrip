import { Star } from "lucide-react";
import { initialsOf } from "@/lib/deliberationText";
import { cn } from "@/lib/utils";

/**
 * A guest as a coloured disc with their initials. `ring` outlines it in a colour (how they stand at
 * a destination), and `starred` pins a small ★ on it: that destination is their favourite.
 */
export function GuestAvatar({
  name,
  hue,
  ring,
  dashed,
  starred,
  size = 40,
  className,
}: {
  name: string;
  hue: string;
  ring?: string;
  /** For a guest who cannot get there: the ring is dashed */
  dashed?: boolean;
  starred?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full text-white", className)}
      style={{
        width: size,
        height: size,
        backgroundColor: hue,
        fontSize: size * 0.4,
        boxShadow: ring && !dashed ? `0 0 0 3px ${ring}` : undefined,
        outline: ring && dashed ? `3px dashed ${ring}` : undefined,
        outlineOffset: ring && dashed ? 1 : undefined,
      }}
    >
      {initialsOf(name)}
      {starred && (
        <span className="absolute -top-1.5 -right-1.5 flex size-[46%] items-center justify-center rounded-full bg-[#c9a84c] shadow-[0_0_8px_rgb(230_180_70/0.7)]">
          <Star aria-hidden className="size-[68%] fill-white stroke-white" />
        </span>
      )}
    </span>
  );
}
