import { Suspense } from "react";
import { CollapsibleSidebar } from "@/components/CollapsibleSidebar";
import { RatingNotice } from "@/components/RatingNotice";
import { SidebarNav } from "@/components/Sidebar";

export default function DashboardLayout({ children, params }: LayoutProps<"/trips/[tripId]">) {
  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <CollapsibleSidebar>
        {/* usePathname needs a Suspense boundary under cacheComponents */}
        <Suspense fallback={null}>
          <SidebarNav />
        </Suspense>
      </CollapsibleSidebar>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Reads the database for the trip's ratings, so it streams in behind Suspense like the pages */}
        <Suspense fallback={null}>
          <RatingNotice params={params} />
        </Suspense>
        {children}
      </div>
    </div>
  );
}
