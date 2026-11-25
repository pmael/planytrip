"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Logo, LogoWithIcon } from "./Logo";

const STORAGE_KEY = "planytrip.sidebar-collapsed";

const SidebarContext = createContext({ collapsed: false });

/** Whether the sidebar is folded down to its icons, for the links inside it. */
export const useSidebarCollapsed = () => useContext(SidebarContext).collapsed;

// The choice lives in the browser's storage (so it is there on the next visit), read through the store
// API: the server cannot know it, and the page must render the same as on the server before it does.
const listeners = new Set<() => void>();
/** What was chosen while storage could not keep it */
let remembered: boolean | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function isCollapsed(): boolean {
  if (remembered !== null) return remembered;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setCollapsedEverywhere(collapsed: boolean) {
  remembered = collapsed;
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Not kept for the next visit: still folded for now
  }
  listeners.forEach((listener) => listener());
}

/**
 * The dashboard's left sidebar, which folds down to a strip of icons and opens again (the choice is
 * remembered in this browser). On a narrow screen, where the sidebar sits above the page, folding hides
 * its links and leaves the logo and the button.
 */
export function CollapsibleSidebar({ children }: { children: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, isCollapsed, () => false);
  const toggle = () => setCollapsedEverywhere(!collapsed);

  return (
    <SidebarContext.Provider value={{ collapsed }}>
      <aside
        data-collapsed={collapsed || undefined}
        className={cn(
          "flex animate-[row-in_0.7s_cubic-bezier(0.22,1,0.36,1)_both] flex-col border-white/10 bg-white/[0.05] py-10 backdrop-blur-md transition-[width,padding] duration-300 ease-out motion-reduce:transition-none lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:overflow-hidden lg:rounded-br-[44px] lg:border-r",
          collapsed ? "px-3 lg:w-[96px]" : "px-6 lg:w-[308px]",
        )}
      >
        {collapsed ? (
          // Folded, the icon is all there is room for: pointing at it turns it into the button that opens the sidebar
          <div className="group/logo relative flex size-11 shrink-0 items-center justify-center self-center">
            <Logo variant="icon" width={44} priority className="transition-opacity duration-200 group-hover/logo:opacity-0 group-has-[:focus-visible]/logo:opacity-0 motion-reduce:transition-none [@media(hover:none)]:opacity-0" />
            <button
              type="button"
              onClick={toggle}
              aria-expanded={false}
              aria-label="Open the sidebar"
              title="Open the sidebar"
              className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full text-white/85 opacity-0 outline-none transition-[opacity,background-color] duration-200 group-hover/logo:opacity-100 hover:bg-white/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-emerald-300/50 motion-reduce:transition-none [@media(hover:none)]:opacity-100 [&_svg]:size-7 [&_svg]:stroke-2"
            >
              <ChevronRight aria-hidden />
            </button>
          </div>
        ) : (
          // The button is only there while the logo is pointed at (or reached by keyboard); with no pointer to hover with, it always is
          <div className="group/logo flex items-center justify-between gap-3">
            <LogoWithIcon width={188} className="px-2" />
            <button
              type="button"
              onClick={toggle}
              aria-expanded
              aria-label="Fold the sidebar"
              title="Fold the sidebar"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/75 opacity-0 outline-none transition-[opacity,background-color,color] duration-200 group-hover/logo:opacity-100 hover:bg-white/10 hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-emerald-300/50 motion-reduce:transition-none [@media(hover:none)]:opacity-100 [&_svg]:size-7 [&_svg]:stroke-2"
            >
              <ChevronLeft aria-hidden />
            </button>
          </div>
        )}
        <hr className={cn("border-white/30", collapsed ? "mt-5 max-lg:hidden" : "mt-8")} />
        <div className={cn("flex flex-1 flex-col", collapsed && "max-lg:hidden")}>{children}</div>
      </aside>
    </SidebarContext.Provider>
  );
}
