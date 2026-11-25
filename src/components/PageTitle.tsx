import type { ReactNode } from "react";

/**
 * The pill that names a dashboard page, where the destination picker sits on the home page.
 * `action` is a control that lives inside the pill, at its right end (e.g. the destination menu), and
 * `lead` one at its left end (e.g. the guest menu).
 */
export function PageTitle({ children, action, lead }: { children: string; action?: ReactNode; lead?: ReactNode }) {
  return (
    <div className="relative">
      <h1 className="flex h-[86px] animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both] items-center justify-center rounded-full border border-emerald-200/35 bg-white/[0.16] text-4xl font-normal text-white shadow-[0_0_28px_rgb(46_196_143/0.3)] backdrop-blur-md">
        {children}
      </h1>
      {lead && <div className="absolute top-1/2 left-4 -translate-y-1/2">{lead}</div>}
      {action && <div className="absolute top-1/2 right-4 -translate-y-1/2">{action}</div>}
    </div>
  );
}

// The housing page puts its destination menu in the action slot.
