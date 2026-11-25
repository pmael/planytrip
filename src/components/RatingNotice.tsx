import { connection } from "next/server";
import { TriangleAlert } from "lucide-react";
import { db } from "@/db/client";
import { ratingNoticesOf, type RatingNotice as Notice } from "@/lib/ratingText";
import { searchNoticeOf } from "@/lib/searchText";
import { getSearchProblems } from "@/server/services/compute";
import { getRatingStatus } from "@/server/services/ratings";
import { RecomputeButton } from "./RecomputeButton";

function Banner({ tripId, notice, mode = "ratings" }: { tripId: string; notice: Notice; mode?: "ratings" | "retry" }) {
  return (
    <section
      role="status"
      aria-label={notice.title}
      className="flex animate-[fade-up_0.5s_ease-out_both] flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-[28px] border border-amber-200/40 bg-amber-300/15 px-6 py-4 text-white backdrop-blur-md"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 basis-[420px]">
        <TriangleAlert aria-hidden className="mt-1 size-6 shrink-0 text-amber-200" />
        <div className="min-w-0">
          <p className="text-xl text-amber-100">{notice.title}</p>
          <p className="mt-0.5 text-base text-white/80">{notice.text}</p>
          {notice.detail && <p className="mt-1 text-sm break-words text-white/55">{notice.detail}</p>}
        </div>
      </div>
      <RecomputeButton tripId={tripId} mode={mode} size="small">
        {notice.action}
      </RecomputeButton>
    </section>
  );
}

/**
 * Tells the person what to doubt about what they are looking at: searches that failed (so that "nothing
 * found" is not taken for "there is nothing"), and the scores: options that "were not rated by
 * the AI" (the rules scored them because the AI was not available), and ratings that a change of
 * budget, dates or offer may have made out of date. Each comes with a button to rate again; the AI is
 * never asked until it is pressed. Read from what is stored, so it shows nothing for a fresh trip.
 */
export async function RatingNotice({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  // Prices seen on SNCF Connect count for a day: this is read at request time, not prerendered (the clock is read below)
  await connection();
  const { notRated, outOfDate } = ratingNoticesOf(getRatingStatus(db, tripId));
  const failed = searchNoticeOf(getSearchProblems(db, tripId));
  if (!failed && !notRated && !outOfDate) return null;

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 px-[4%] pt-6 lg:pt-[3vh]">
      {failed && <Banner tripId={tripId} notice={failed} mode="retry" />}
      {notRated && <Banner tripId={tripId} notice={notRated} />}
      {outOfDate && <Banner tripId={tripId} notice={outOfDate} />}
    </div>
  );
}
