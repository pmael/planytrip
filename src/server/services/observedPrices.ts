// Prices seen on the person's own SNCF Connect page, laid over the options' prices when they are read (task.md T7.9,
// price-model.md P1.4). Nothing is stored on the option: an observation is fresh for a day, then the estimate is what shows
// again, and the observation stays for the accuracy page and the model.
import { gte, inArray } from "drizzle-orm";
import { priceObservations as settings } from "@/config";
import { optionRaw, sameTrain, type OptionWay } from "@/core/priceObservations";
import type { PriceKind, TransportOption } from "@/core/types";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { observedText } from "@/lib/priceText";

type Observation = typeof schema.priceObservations.$inferSelect;

/**
 * The options, with the price of a train replaced by what the person saw on SNCF Connect in the last day, one way at a time:
 * the way there and the way back are each priced by what was seen for it, else by what the search estimated. The price is
 * "observed" when nothing left in it is an estimate, "estimated" while one way still is (and the note says which).
 */
export function withObservedPrices(db: Db, options: TransportOption[], now: Date = new Date()): TransportOption[] {
  if (!options.some((option) => option.mode === "train")) return options;

  const since = new Date(now.getTime() - settings.freshMs).toISOString();
  const fresh = db.select().from(schema.priceObservations).where(gte(schema.priceObservations.capturedAt, since)).all().sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  if (fresh.length === 0) return options;

  // Only an option with a way on a day something was seen on can be concerned
  const days = new Set(fresh.map((observation) => observation.travelDate));
  const concerned = options.filter((option) => option.mode === "train" && [option.outDepartAt, option.backDepartAt].some((at) => at && days.has(at.slice(0, 10))));
  if (concerned.length === 0) return options;
  const raws = new Map(
    db
      .select({ id: schema.transportOptions.id, rawJson: schema.transportOptions.rawJson })
      .from(schema.transportOptions)
      .where(inArray(schema.transportOptions.id, concerned.map((option) => option.id)))
      .all()
      .map((row) => [row.id, optionRaw(row.rawJson)] as const),
  );

  /** What was seen for this train, the latest first */
  const seenFor = (way: OptionWay, side: "out" | "back"): Observation | undefined =>
    fresh.find(
      (observation) =>
        (observation.direction === null || observation.direction === side) &&
        sameTrain({ travelDate: observation.travelDate, departTime: observation.departTime, departStation: observation.departStation, arriveStation: observation.arriveStation }, way, settings.matchMinutes),
    );

  return options.map((option) => {
    const raw = raws.get(option.id);
    // The two ways are priced apart: an option that did not keep them cannot be split
    if (!raw?.out || !raw.back) return option;
    const out = seenFor(raw.out.way, "out");
    const back = seenFor(raw.back.way, "back");
    if (!out && !back) return option;

    const kinds: PriceKind[] = [out ? "observed" : raw.out.price.kind, back ? "observed" : raw.back.price.kind];
    const priceKind: PriceKind = kinds.includes("estimated") ? "estimated" : "observed";

    const notes: string[] = [];
    if (out && back) {
      const older = out.capturedAt < back.capturedAt ? out : back;
      notes.push(observedText(older.source, older.capturedAt, now));
    } else if (out || back) {
      const seen = (out ?? back)!;
      notes.push(`${out ? "Aller" : "Retour"} ${observedText(seen.source, seen.capturedAt, now)}`);
    }
    // The way nobody saw keeps the words of its own estimate (when both were seen there is none)
    const unseen = out && !back ? raw.back.price : back && !out ? raw.out.price : null;
    if (unseen && unseen.kind === "estimated" && unseen.note) notes.push(unseen.note);

    return {
      ...option,
      priceEur: Math.round((out?.price2ndEur ?? raw.out.price.priceEur) + (back?.price2ndEur ?? raw.back.price.priceEur)),
      priceKind,
      priceNote: notes.join(" · "),
    };
  });
}
