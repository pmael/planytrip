"use client";

import { Scale, X } from "lucide-react";
import { useCallback, useState } from "react";
import { overBudgetMessage, sendSelection } from "@/lib/selections";
import { cn } from "@/lib/utils";
import type { HousingColumn, StayCard } from "@/server/services/stays";
import { AdvicePanel } from "./AdvicePanel";
import { BudgetToast } from "./BudgetToast";
import { CompareDialog } from "./CompareDialog";
import { glassSurface } from "./GlassCard";
import { StayColumn } from "./StayColumn";
import { StayInfoDialog } from "./StayInfoDialog";

const MAX_COMPARED = 3;

/**
 * The Housing page of one destination (use-cases.md UC-B): the offers by source, each with its ❤
 * (the group's pick, saved as it is made), a comparison of 2 or 3 offers, more details, a link, and
 * the AI's advice, which opens where the other column was. Keyed by destination by its parent, so
 * it starts over for each.
 */
export function HousingPage({
  destinationId,
  columns,
  defaultStayId,
}: {
  destinationId: string;
  columns: HousingColumn[];
  defaultStayId: string | null;
}) {
  const stays = columns.flatMap((column) => column.stays);
  const [heartedId, setHeartedId] = useState<string | null>(() => stays.find((stay) => stay.hearted)?.id ?? null);
  const [comparing, setComparing] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [adviseId, setAdviseId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "warning" | "error" } | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const byId = new Map(stays.map((stay) => [stay.id, stay]));
  const sourceOf = (id: string) => columns.find((column) => column.stays.some((stay) => stay.id === id))?.label ?? "";
  const adviseColumn = adviseId ? columns.findIndex((column) => column.stays.some((stay) => stay.id === adviseId)) : -1;
  const inBudgetId = heartedId ?? defaultStayId;

  async function toggleHeart(stay: StayCard) {
    const removing = heartedId === stay.id;
    const before = heartedId;
    setHeartedId(removing ? null : stay.id);
    try {
      const budget = await sendSelection(
        destinationId,
        removing ? "DELETE" : "PUT",
        removing ? { kind: "stay" } : { kind: "stay", optionId: stay.id },
      );
      setToast(budget.warnings.length > 0 ? { message: overBudgetMessage(budget.warnings), tone: "warning" } : null);
    } catch {
      setHeartedId(before);
      setToast({ message: "Couldn’t save your choice, please try again.", tone: "error" });
    }
  }

  function toggleCompare(stay: StayCard) {
    if (comparing.includes(stay.id)) return setComparing(comparing.filter((id) => id !== stay.id));
    if (comparing.length >= MAX_COMPARED) {
      return setToast({ message: `You can compare up to ${MAX_COMPARED} offers at a time.`, tone: "warning" });
    }
    setComparing([...comparing, stay.id]);
  }

  const toCompare = comparing.flatMap((id) => (byId.has(id) ? [{ stay: byId.get(id)!, source: sourceOf(id) }] : []));

  return (
    <>
      <div className="grid grid-cols-1 gap-x-[88px] gap-y-12 lg:grid-cols-2">
        {columns.map((column, slot) => {
          const covered = adviseColumn === 1 - slot;
          return (
            <div key={column.provider} className="relative">
              <StayColumn
                column={column}
                heartedId={heartedId}
                inBudgetId={inBudgetId}
                comparing={comparing}
                adviseId={adviseId}
                onHeart={toggleHeart}
                onCompare={toggleCompare}
                onInfo={(stay) => setInfoId(stay.id)}
                onAdvise={(stay) => setAdviseId(adviseId === stay.id ? null : stay.id)}
                className={cn(covered && "pointer-events-none scale-[0.96] opacity-40 blur-[6px]")}
              />
              {covered && adviseId && (
                <AdvicePanel key={adviseId} stay={byId.get(adviseId)!} onClose={() => setAdviseId(null)} />
              )}
            </div>
          );
        })}
      </div>

      {comparing.length > 0 && (
        <div
          role="region"
          aria-label="Comparison"
          className={cn(glassSurface, "fixed bottom-8 left-1/2 z-30 flex max-w-[min(820px,92vw)] -translate-x-1/2 animate-[fade-up_0.4s_ease-out_both] items-center gap-4 rounded-full bg-[#4f4f4f]/90 py-3 pr-3 pl-6 text-white shadow-[0_8px_30px_rgb(0_0_0/0.35)]")}
        >
          <Scale aria-hidden className="size-6 shrink-0 stroke-[1.5]" />
          <ul className="flex min-w-0 items-center gap-2 text-lg">
            {comparing.map((id) => (
              <li key={id} className="flex min-w-0 items-center gap-1 rounded-full bg-white/15 py-1 pr-1 pl-4">
                <span className="max-w-[170px] truncate">{byId.get(id)?.title}</span>
                <button
                  type="button"
                  aria-label={`Remove ${byId.get(id)?.title} from the comparison`}
                  onClick={() => setComparing(comparing.filter((other) => other !== id))}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={comparing.length < 2}
            onClick={() => setCompareOpen(true)}
            title={comparing.length < 2 ? "Pick a second offer to compare" : undefined}
            className="h-12 shrink-0 cursor-pointer rounded-full border border-emerald-200/40 bg-[#6f9f72] px-6 text-lg outline-none transition-colors hover:bg-[#7db380] focus-visible:ring-2 focus-visible:ring-emerald-300/60 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Compare {comparing.length}
          </button>
        </div>
      )}

      <CompareDialog stays={toCompare} open={compareOpen && toCompare.length >= 2} onClose={() => setCompareOpen(false)} />
      <StayInfoDialog stay={infoId ? (byId.get(infoId) ?? null) : null} onClose={() => setInfoId(null)} />
      {toast && <BudgetToast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  );
}
