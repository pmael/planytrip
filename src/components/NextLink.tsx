import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Green "Next" pill that leads to the following wizard step. */
export function NextLink({
  href,
  disabled,
  className,
}: {
  /** Relative to the current step, e.g. "destinations". */
  href: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : undefined}
      className={cn(
        "flex h-[62px] animate-[row-in_0.6s_cubic-bezier(0.22,1,0.36,1)_0.3s_both] items-center gap-3 rounded-full border border-emerald-200/40 bg-[#6f9f72] px-9 text-lg text-white transition-[background-color,opacity] hover:bg-[#7db380]",
        disabled && "pointer-events-none opacity-40",
        className,
      )}
    >
      Next
      <ArrowRight className="size-5" />
    </Link>
  );
}
