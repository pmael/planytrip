import Link from "next/link";
import { tripPath } from "@/lib/trip";

/** Shown instead of a dashboard page when the trip has not been computed: the wizard comes first. */
export function NotReady({ tripId }: { tripId: string }) {
  return (
    <div className="mx-auto mt-[18vh] flex max-w-[640px] animate-[fade-up_0.5s_ease-out_both] flex-col items-center gap-8 text-center text-white">
      <p className="text-3xl">This trip hasn’t been worked out yet.</p>
      <p className="text-xl text-white/65">Finish the three steps and the dashboard will fill in with real figures.</p>
      <Link
        href={tripPath(tripId, "/setup/guests")}
        className="rounded-full border border-emerald-200/40 bg-[#6f9f72] px-10 py-4 text-lg transition-colors hover:bg-[#7db380]"
      >
        Continue the setup
      </Link>
    </div>
  );
}
