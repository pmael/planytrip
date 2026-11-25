import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ExportPdfButton } from "@/components/ExportPdfButton";
import { ReopenButton } from "@/components/ReopenButton";
import { SummaryDocument } from "@/components/SummaryDocument";
import { db } from "@/db/client";
import { tripPath } from "@/lib/trip";
import { getSummary, latestSummaryId } from "@/server/services/summaries";
import { getTrip } from "@/server/services/trips";

/** On paper the page is white and has no controls: what is printed is the summary and nothing else. */
const PRINT_STYLE = "@media print { html, body { background: #fff !important; } }";

/** Loads a summary: the one in the address (`?id=`), or else the latest. It reads the URL and the database, so it streams in behind Suspense. */
async function Summary({ params, searchParams }: Pick<PageProps<"/trips/[tripId]/summary">, "params" | "searchParams">) {
  const { tripId } = await params;
  // Prices seen on SNCF Connect count for a day: this is read at request time, not prerendered (the clock is read below)
  await connection();
  const { id, print } = await searchParams;
  if (!getTrip(db, tripId)) notFound();

  const summaryId = typeof id === "string" ? id : latestSummaryId(db, tripId);
  if (!summaryId) {
    return (
      <main className="flex flex-1 flex-col items-center gap-6 px-[5%] pt-[18vh] text-center text-white">
        <p className="text-3xl">Nothing has been validated yet.</p>
        <p className="text-xl text-white/65">Pick a destination on the dashboard and validate it: its summary will be here.</p>
        <Link href={tripPath(tripId)} className="rounded-full border border-emerald-200/40 bg-[#6f9f72] px-10 py-4 text-lg transition-colors hover:bg-[#7db380]">
          Back to the dashboard
        </Link>
      </main>
    );
  }

  const summary = getSummary(db, summaryId);
  if (!summary || summary.tripId !== tripId) notFound();
  const printing = print === "1";

  return (
    <main className="flex-1 px-[3%] py-10 print:p-0 lg:py-[5vh]">
      <style>{PRINT_STYLE}</style>
      {!printing && (
        <nav aria-label="Summary" className="mx-auto mb-8 flex max-w-[980px] flex-wrap items-center justify-between gap-4 text-white print:hidden">
          <Link
            href={tripPath(tripId)}
            className="flex h-[50px] items-center gap-2 rounded-full border border-white/25 bg-white/[0.12] px-5 text-lg outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-emerald-300/60 [&_svg]:size-5 [&_svg]:stroke-[1.5]"
          >
            <ArrowLeft aria-hidden />
            Dashboard
          </Link>
          <div className="flex flex-wrap items-start justify-end gap-3">
            <ExportPdfButton summaryId={summary.id} />
            <ReopenButton tripId={tripId} summaryId={summary.id} />
          </div>
        </nav>
      )}
      <SummaryDocument summary={summary} />
    </main>
  );
}

export default function SummaryRoute({ params, searchParams }: PageProps<"/trips/[tripId]/summary">) {
  return (
    <Suspense fallback={null}>
      <Summary params={params} searchParams={searchParams} />
    </Suspense>
  );
}
