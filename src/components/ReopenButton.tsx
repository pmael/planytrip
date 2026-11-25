"use client";

import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { tripPath } from "@/lib/trip";
import { cn } from "@/lib/utils";

const pill =
  "flex h-[50px] cursor-pointer items-center gap-2 rounded-full border px-5 text-lg text-white outline-none transition-[background-color,transform] focus-visible:ring-2 focus-visible:ring-emerald-300/60 active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 [&_svg]:size-5 [&_svg]:stroke-[1.5]";

/** Takes the decision back: the summary is deleted and the trip is open again. Asks first. */
export function ReopenButton({ tripId, summaryId }: { tripId: string; summaryId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function reopen() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(`/api/summaries/${summaryId}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error(`Summary answered ${response.status}`);
      router.push(tripPath(tripId));
      router.refresh();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return confirming ? (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-lg text-white/85">Delete this summary and decide again?</span>
      <button type="button" onClick={reopen} disabled={busy} className={cn(pill, "border-rose-300/60 bg-rose-500/60 hover:bg-rose-500/80")}>
        {busy ? "Reopening…" : "Reopen"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={cn(pill, "border-white/25 bg-white/[0.12] hover:bg-white/20")}>
        Cancel
      </button>
      {error && (
        <span role="alert" className="text-base text-rose-200">
          Couldn’t reopen, please try again.
        </span>
      )}
    </span>
  ) : (
    <button type="button" onClick={() => setConfirming(true)} className={cn(pill, "border-white/25 bg-white/[0.12] hover:bg-white/20")}>
      <Undo2 aria-hidden />
      Reopen the decision
    </button>
  );
}
