"use client";

import { Map as MapIcon, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { withVotes } from "@/lib/deliberationText";
import type { TripMapData } from "@/lib/tripMap";
import { useSynthesis } from "@/lib/useSynthesis";
import type { ReadyDeliberation } from "@/server/services/deliberation";
import { AiPanel } from "./AiPanel";
import { BudgetToast } from "./BudgetToast";
import { DestinationCard, type AiVerdict } from "./DestinationCard";
import { DestinationDialog, type AiDetail } from "./DestinationDialog";
import { GuestMatrix, type Focus } from "./GuestMatrix";
import { PageTitle } from "./PageTitle";
import { TogglePill } from "./TogglePill";
import { TripMap } from "./TripMap";
import { VerdictBanner } from "./VerdictBanner";

const NO_FOCUS: Focus = { guestId: null, destinationId: null };
const NO_VOTES: Record<string, string | null> = {};

/**
 * The Destinations page (use-cases.md UC-C): the group's verdict, who goes where, each destination
 * in detail, an optional map and the AI's take. The ★ votes are saved as they are put; the figures
 * and the ranking follow once the server has worked them out again.
 */
export function DestinationsPage({
  tripId,
  view,
  map,
  factsHash,
  initial,
}: {
  tripId: string;
  view: ReadyDeliberation;
  map: TripMapData;
  /** Changes whenever the facts the AI reads change */
  factsHash: string;
  initial: { ai: boolean; map: boolean };
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [aiOn, setAiOn] = useState(initial.ai);
  const [mapOn, setMapOn] = useState(initial.map);
  const [focus, setFocus] = useState<Focus>(NO_FOCUS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  // The ★ that were put and are not in what the server sent yet. They end by themselves when it sends the next view.
  const [overlay, setOverlay] = useState<{ view: ReadyDeliberation; votes: Record<string, string | null> }>({ view, votes: {} });
  const votes = overlay.view === view ? overlay.votes : NO_VOTES;
  const shown = useMemo(() => withVotes(view, votes), [view, votes]);

  const { state, error, refresh } = useSynthesis(tripId, aiOn, factsHash);
  const written = aiOn && state && state.state !== "none" ? (state.state === "ready" ? state.current : state.previous) : null;
  const aiPickId = written?.synthesis.pickDestinationId ?? null;
  const aiOf = (destinationId: string) => {
    const verdict = written?.synthesis.destinations.find((d) => d.destinationId === destinationId);
    return verdict ? { ...verdict, picked: destinationId === aiPickId } : null;
  };

  // The toggles are kept in the address, so a reload or a shared link opens the page the same way
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [name, on] of [["ai", aiOn], ["map", mapOn]] as const) {
      if (on) url.searchParams.set(name, "1");
      else url.searchParams.delete(name);
    }
    window.history.replaceState(window.history.state, "", url);
  }, [aiOn, mapOn]);

  async function setStar(guestId: string, destinationId: string | null) {
    setOverlay((current) => ({ view, votes: { ...(current.view === view ? current.votes : {}), [guestId]: destinationId } }));
    try {
      const response = await fetch(`/api/guests/${guestId}/favorite`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destinationId }),
      });
      if (!response.ok) throw new Error(`Favorite answered ${response.status}`);
      startTransition(() => router.refresh());
    } catch {
      setOverlay((current) => {
        const votes = { ...(current.view === view ? current.votes : NO_VOTES) };
        delete votes[guestId];
        return { view, votes };
      });
      setToast("Couldn’t save that ★, please try again.");
    }
  }

  const open = shown.destinations.find((d) => d.id === openId) ?? null;
  const openAi = open ? aiOf(open.id) : null;
  const detail: AiDetail | null = openAi && { ...openAi };
  const cardAi = (id: string): AiVerdict | null => {
    const verdict = aiOf(id);
    return verdict && { verdict: verdict.verdict, score: verdict.score, summary: verdict.summary, picked: verdict.picked };
  };
  const focusDestination = useCallback((destinationId: string | null) => setFocus({ guestId: null, destinationId }), []);

  return (
    <div className="mx-auto flex max-w-[1580px] flex-col gap-10">
      <div className="lg:w-[82%]">
        <PageTitle
          lead={
            <TogglePill
              checked={aiOn}
              onChange={setAiOn}
              icon={<Sparkles aria-hidden />}
              label="AI"
              tone="violet"
              busy={aiOn && (state === null || state.state === "pending") && !error}
            />
          }
          action={<TogglePill checked={mapOn} onChange={setMapOn} icon={<MapIcon aria-hidden />} label="Map" />}
        >
          Destinations
        </PageTitle>
      </div>

      <VerdictBanner view={shown} onOpen={setOpenId} />

      {aiOn && (
        <AiPanel
          state={state}
          error={error}
          onRefresh={refresh}
          destinations={shown.destinations}
          guests={shown.guests}
          recommendedId={shown.recommendedId}
          onOpen={setOpenId}
        />
      )}

      {mapOn && (
        <TripMap
          map={map}
          guests={shown.guests}
          destinations={shown.destinations}
          focus={focus}
          aiPickId={aiOn ? aiPickId : null}
          onFocus={setFocus}
          onOpen={setOpenId}
        />
      )}

      <GuestMatrix guests={shown.guests} destinations={shown.destinations} focus={focus} onFocus={setFocus} onStar={setStar} onOpen={setOpenId} />

      <section aria-label="Each destination in detail" className="flex flex-col gap-6">
        <h2 className="px-4 text-3xl font-normal text-white">Each destination in detail</h2>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3">
          {shown.destinations.map((dossier, index) => (
            <DestinationCard
              key={dossier.id}
              dossier={dossier}
              guests={shown.guests}
              ai={aiOn ? cardAi(dossier.id) : null}
              dimmed={focus.destinationId !== null && focus.destinationId !== dossier.id}
              index={index}
              onFocus={focusDestination}
              onOpen={setOpenId}
            />
          ))}
        </div>
      </section>

      <DestinationDialog
        tripId={tripId}
        dossier={open}
        guests={shown.guests}
        ai={aiOn ? detail : null}
        validatedSummaryId={open && shown.validated?.destinationId === open.id ? shown.validated.summaryId : null}
        onClose={() => setOpenId(null)}
      />
      {toast && <BudgetToast message={toast} tone="error" onDismiss={dismissToast} />}
    </div>
  );
}
