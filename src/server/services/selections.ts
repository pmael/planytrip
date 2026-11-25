// The ❤: a guest's transport choice, or the group's accommodation (use-cases.md A-S7, B-S8, B-S9).
import { and, eq } from "drizzle-orm";
import { budgetDelta } from "@/core/pricing";
import type { Scenario } from "@/core/scenario";
import type { BudgetDelta, Selection } from "@/core/types";
import { toSelection } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { FieldError, NotFoundError } from "../errors";
import type { SelectionClear, SelectionInput } from "../schemas";
import { loadTripScenarios } from "./scenarios";

/** Nothing changes: every guest costs what they cost now. */
function unchanged(scenario: Scenario): BudgetDelta {
  const perGuest = scenario.guests.flatMap((guest) =>
    guest.costEur === null ? [] : [{ guestId: guest.guestId, before: guest.costEur, after: guest.costEur, tier: guest.tier }],
  );
  return { perGuest, totalBefore: scenario.totalEur, totalAfter: scenario.totalEur, warnings: [] };
}

function scenarioOf(db: Db, tripId: string, destinationId: string): Scenario {
  const loaded = loadTripScenarios(db, tripId)!;
  return loaded.scenarios.find((scenario) => scenario.destinationId === destinationId)!;
}

function destinationOf(db: Db, destinationId: string) {
  const [destination] = db.select().from(schema.destinations).where(eq(schema.destinations.id, destinationId)).all();
  if (!destination) throw new NotFoundError("Destination not found");
  return destination;
}

/**
 * Puts a ❤ on an option. The accommodation's ❤ is the group's and unique per destination, a new
 * one replaces the old; a transport ❤ belongs to one guest and does not change the others' costs.
 * Returns the ❤ and what it does to everyone's budget: `warnings` names the guests it pushes
 * over ("Jessy +70 €").
 */
export function setSelection(
  db: Db,
  destinationId: string,
  input: SelectionInput,
): { selection: Selection; budget: BudgetDelta } {
  const destination = destinationOf(db, destinationId);

  if (input.kind === "stay") {
    const [stay] = db.select().from(schema.stayOptions).where(eq(schema.stayOptions.id, input.optionId)).all();
    if (!stay || stay.destinationId !== destinationId) {
      throw new FieldError("optionId", "That accommodation is not offered at this destination");
    }
  } else {
    const [option] = db.select().from(schema.transportOptions).where(eq(schema.transportOptions.id, input.optionId)).all();
    if (!option || option.destinationId !== destinationId) {
      throw new FieldError("optionId", "That option does not lead to this destination");
    }
    const [guest] = db.select().from(schema.guests).where(eq(schema.guests.id, input.guestId!)).all();
    if (!guest || guest.tripId !== destination.tripId) throw new FieldError("guestId", "That guest is not part of this trip");
    if (guest.originKey !== option.originKey) throw new FieldError("optionId", "That option does not leave from where the guest lives");
  }

  // What it does is worked out from the situation before the ❤ and the one after, the Extra included (T8.9)
  const before = scenarioOf(db, destination.tripId, destinationId);

  const row = db.transaction((tx) => {
    tx.delete(schema.selections)
      .where(
        input.kind === "stay"
          ? and(eq(schema.selections.destinationId, destinationId), eq(schema.selections.kind, "stay"))
          : and(
              eq(schema.selections.destinationId, destinationId),
              eq(schema.selections.kind, "transport"),
              eq(schema.selections.guestId, input.guestId!),
            ),
      )
      .run();
    return tx
      .insert(schema.selections)
      .values({
        tripId: destination.tripId,
        destinationId,
        kind: input.kind,
        guestId: input.kind === "transport" ? input.guestId : null,
        transportOptionId: input.kind === "transport" ? input.optionId : null,
        stayOptionId: input.kind === "stay" ? input.optionId : null,
        reason: input.reason ?? null,
      })
      .returning()
      .all()[0];
  });

  return { selection: toSelection(row), budget: budgetDelta(before, scenarioOf(db, destination.tripId, destinationId)) };
}

/**
 * Takes a ❤ off: everything goes back to the default pick. Returns what that does to everyone's
 * budget. Removing a ❤ that is not there changes nothing.
 */
export function clearSelection(db: Db, destinationId: string, input: SelectionClear): { budget: BudgetDelta } {
  const destination = destinationOf(db, destinationId);
  const where =
    input.kind === "stay"
      ? and(eq(schema.selections.destinationId, destinationId), eq(schema.selections.kind, "stay"))
      : and(
          eq(schema.selections.destinationId, destinationId),
          eq(schema.selections.kind, "transport"),
          eq(schema.selections.guestId, input.guestId!),
        );

  const before = scenarioOf(db, destination.tripId, destinationId);
  if (db.delete(schema.selections).where(where).returning().all().length === 0) return { budget: unchanged(before) };

  return { budget: budgetDelta(before, scenarioOf(db, destination.tripId, destinationId)) };
}
