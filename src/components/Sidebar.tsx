"use client";

import { House, MapPin, Settings, User } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { tripPath } from "@/lib/trip";
import { useSidebarCollapsed } from "./CollapsibleSidebar";
import { cn } from "@/lib/utils";

type NavItem = { label: string; path: string; icon: ReactNode; exact?: boolean };

/** The dashboard's own pages hang under Home: while one is open, Home stays lit. */
const HOME_PAGES = ["/budget", "/housing", "/transports", "/extra"];

const links: NavItem[] = [
  { label: "Home", path: "", icon: <House />, exact: true },
  { label: "Destinations", path: "/destinations", icon: <MapPin /> },
  { label: "Guests", path: "/guests", icon: <User /> },
];

const settings: NavItem = { label: "Settings", path: "/settings", icon: <Settings /> };

function NavLink({ link, href, active }: { link: NavItem; href: string; active: boolean }) {
  const collapsed = useSidebarCollapsed();
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? link.label : undefined}
      className={cn(
        "flex items-center gap-5 rounded-full py-3.5 text-2xl text-white outline-none transition-[background-color,box-shadow] duration-300 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-emerald-300/50 [&_svg]:size-8 [&_svg]:shrink-0 [&_svg]:stroke-[1.4]",
        collapsed ? "justify-center px-0" : "px-6",
        active && "bg-[#3f7a62]/60 shadow-[0_0_24px_rgb(46_196_143/0.3)] hover:bg-[#3f7a62]/70",
      )}
    >
      {link.icon}
      {/* Folded, the name is only for screen readers (and the tooltip) */}
      <span className={cn("whitespace-nowrap", collapsed && "sr-only")}>{link.label}</span>
    </Link>
  );
}

export function SidebarNav() {
  const { tripId } = useParams<{ tripId: string }>();
  const pathname = usePathname();
  const hrefOf = (link: NavItem) => tripPath(tripId, link.path);
  const isActive = (link: NavItem) =>
    link.exact
      ? pathname === hrefOf(link) || HOME_PAGES.some((page) => pathname.startsWith(hrefOf(link) + page))
      : pathname.startsWith(hrefOf(link));

  return (
    <>
      <nav aria-label="Trip" className="mt-10 flex flex-col gap-3">
        {links.map((link) => (
          <NavLink key={link.label} link={link} href={hrefOf(link)} active={isActive(link)} />
        ))}
      </nav>
      <nav aria-label="Trip settings" className="mt-auto pt-10">
        <NavLink link={settings} href={hrefOf(settings)} active={isActive(settings)} />
      </nav>
    </>
  );
}
