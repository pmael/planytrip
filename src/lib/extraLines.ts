// Each line of the Extra in words (extra.md §9, task.md T8.10): what it counts, how its amount is worked out, and the
// prices and facts behind it with where each comes from. Pure: built from the plan's own facts (core/extras.ts), so the
// words always say what the amounts are.
import { car, extras as settings } from "@/config";
import { EXTRA_LINE_IDS, MANDATORY_LINES, type ExtraInput, type ExtraLineId, type ExtraPlan, type LocalPrice, type PlannedTransfer, type PriceSource } from "@/core/extras";
import type { TransportMode } from "@/core/types";

/** Where a figure comes from: a local price (the AI, the rules, open data, a site's published average), the stay's own page, the app's tax table, a map, a journey planner, or one of the app's rules */
export type DetailSource = PriceSource | "page" | "config" | "openstreetmap" | "transitous" | "rule";

export const SOURCE_LABELS: Record<DetailSource, string> = {
  ai: "AI estimate",
  rules: "country price level",
  "open-data": "official data",
  published: "published average",
  page: "the listing",
  config: "official rate",
  openstreetmap: "OpenStreetMap",
  transitous: "Transitous",
  rule: "the app's rule",
};

/** `href`: where a person can check the figure themselves (a published average's page) */
export type DetailRow = { label: string; value: string; source: DetailSource | null; href?: string };

export type LineDetail = {
  id: ExtraLineId;
  label: string;
  /** What is counted, in a sentence */
  summary: string;
  /** How the amount is worked out */
  formula: string;
  rows: DetailRow[];
  /** Rests on an estimate (a price from the AI or the rules, a taxi worked out from the distance): shown with ≈ */
  estimate: boolean;
};

/** "7 €", "15.60 €" */
export const money = (eur: number) => (Math.abs(eur - Math.round(eur)) < 0.005 ? `${Math.round(eur)} €` : `${eur.toFixed(2)} €`);
const kms = (km: number) => `${Math.round(km * 10) / 10} km`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "A", "A and B", "A, B and C" */
const listed = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const clock = (at: string) => at.slice(11, 16);
/** An estimate, or an average that is not the price of these dates: shown with ≈ */
const isEstimate = (source: DetailSource | null) => source === "ai" || source === "rules" || source === "published";
const hubWord = (mode: TransportMode | undefined) => (mode === "train" || mode === "bus" ? "station" : "airport");

/** The line's name: some depend on how the guests travel or on the objective */
export function lineLabel(id: ExtraLineId, input: ExtraInput, guestId: string | null = null): string {
  switch (id) {
    case "food":
      return "Food";
    case "transfer": {
      const modes = input.guests.filter((guest) => (guestId === null || guest.guestId === guestId) && guest.there).map((guest) => hubWord(guest.mode));
      const words = new Set(modes);
      return words.size === 1 ? `${[...words][0] === "station" ? "Station" : "Airport"} ↔ stay` : "Arrival ↔ stay";
    }
    case "parking":
      return "Parking";
    case "tourist-tax":
      return "Tourist tax";
    case "nights-out":
      return "Nights out";
    case "pre-drinks":
      return "Pre-drinks";
    case "night-transport":
      return "Getting there and back at night";
    case "activities":
      return input.objective === "nature" ? "Hikes and visits" : "Visits";
    case "relax":
      return "Spa";
    case "local-transport":
      return "Public transport";
    case "car-rental":
      return "Rental car";
    case "fuel":
      return "Fuel";
  }
}

/** One way to or from the stay, in a line: "Bus, 45 min: 7 €", "Taxi shared by Chloé and Jessy (45 km): 47 € each" */
function legText(leg: PlannedTransfer, nameOf: (guestId: string) => string): string {
  if (leg.by === "transit") return `Public transport, ${leg.durationMin} min: ${money(leg.eurEach)}`;
  const others = leg.riders.filter((rider) => rider !== leg.guestId);
  if (others.length === 0) return `Taxi alone, ${kms(leg.km)}: ${money(leg.eurEach)}`;
  const taxis = leg.taxis > 1 ? `${leg.taxis} taxis` : "a taxi";
  return `${taxis[0].toUpperCase()}${taxis.slice(1)} shared with ${listed(others.map(nameOf))}, ${kms(leg.km)}: ${money(leg.fareEur * leg.taxis)} ÷ ${leg.riders.length} = ${money(leg.eurEach)}`;
}

/**
 * A line's detail, for one guest (`guestId`) or for everyone. `nameOf` gives a guest's name. Amounts are worked out by
 * core/extras.ts; this only says how.
 */
export function lineDetail(id: ExtraLineId, input: ExtraInput, plan: ExtraPlan, guestId: string | null, nameOf: (guestId: string) => string): LineDetail {
  const { prices, stay, nights } = input;
  const label = lineLabel(id, input, guestId);
  const price = (name: string, value: LocalPrice): DetailRow => ({ label: name, value: value.note ? `${money(value.eur)} (${value.note})` : money(value.eur), source: value.source, ...(value.url ? { href: value.url } : {}) });
  const done = (summary: string, formula: string, rows: DetailRow[], estimate = rows.some((row) => isEstimate(row.source))): LineDetail => ({ id, label, summary, formula, rows, estimate });

  switch (id) {
    case "food": {
      const meals = plan.restaurantMeals + plan.groceryMeals;
      const highBudget = input.budgetLevel === "high";
      const parts = [`${input.objective} ${settings.restaurantSharePct[input.objective]} %`];
      const levelPts = settings.budgetLevelSharePts[input.budgetLevel];
      if (levelPts !== 0) parts.push(`${input.budgetLevel} budget ${levelPts > 0 ? "+" : "−"}${Math.abs(levelPts)} points`);
      if (stay.supermarketKm !== null && stay.supermarketKm > settings.supermarketCloseKm) parts.push(`supermarket over ${settings.supermarketCloseKm} km +${settings.farSupermarketSharePts} points`);
      if (!stay.kitchen) parts.push(`no kitchen: at least ${settings.noKitchenMinSharePct} %`);
      const rows: DetailRow[] = [
        price(highBudget ? "A mid-range restaurant meal" : "A simple restaurant meal", highBudget ? prices.midMeal : prices.cheapMeal),
        price("Groceries for a day (3 meals)", prices.groceriesPerDay),
        { label: "Meals eaten out", value: `${plan.restaurantSharePct} % (${parts.join(", ")})`, source: "rule" },
      ];
      if (stay.supermarketKm !== null) rows.push({ label: "Nearest supermarket", value: kms(stay.supermarketKm), source: "openstreetmap" });
      return done(
        `${plural(meals, "meal")}: ${plan.restaurantMeals} in restaurants, ${plan.groceryMeals} from the supermarket${stay.kitchen ? "" : " (the stay has no kitchen)"}`,
        `${plan.restaurantMeals} × ${money(plan.mealEur)} + ${plan.groceryMeals} × ${money(prices.groceriesPerDay.eur)} ÷ 3`,
        rows,
      );
    }

    case "transfer": {
      // Guest by guest, in the trip's order, there then back
      const order = (id: string) => input.guests.findIndex((guest) => guest.guestId === id);
      const legs = plan.transfers
        .filter((leg) => guestId === null || leg.guestId === guestId)
        .sort((a, b) => order(a.guestId) - order(b.guestId) || (a.way === b.way ? 0 : a.way === "there" ? -1 : 1));
      const guestOf = (id: string) => input.guests.find((guest) => guest.guestId === id);
      const rows: DetailRow[] = legs.map((leg) => ({
        label: `${guestId === null ? `${nameOf(leg.guestId)} · ` : ""}${leg.way === "there" ? "From" : "Back to"} ${leg.hub} at ${clock(leg.at)}`,
        value: legText(leg, nameOf),
        source: leg.by === "transit" ? "transitous" : prices.taxiPerKm.source,
      }));
      if (legs.some((leg) => leg.by === "taxi")) rows.push(price("Taxi: start", prices.taxiStart), price("Taxi: per km", prices.taxiPerKm));
      const word = hubWord(guestOf(legs[0]?.guestId ?? "")?.mode);
      const summary =
        guestId === null
          ? `Between the ${word} and the stay, both ways, at each guest's own hours: public transport when it takes at most ${settings.transfer.maxTransitMin} min between ${settings.transfer.transitHours.from} and ${settings.transfer.transitHours.to}, else a taxi shared by those arriving within ${settings.transfer.shareWithinMin} min`
          : `Between the ${word} and the stay, both ways, at ${nameOf(guestId)}'s own hours`;
      const own = legs.map((leg) => money(leg.eurEach));
      return done(summary, guestId === null ? "Each guest: there + back" : `${own.join(" + ")}`, rows, legs.some((leg) => leg.by === "taxi") || isEstimate(prices.transitTicket.source));
    }

    case "parking":
      return done(`Parking the car for the whole stay: the stay has no free parking`, `${plural(nights, "night")} × ${money(prices.parkingPerDay.eur)}`, [price("Parking for a day", prices.parkingPerDay)]);

    case "tourist-tax": {
      const tax = stay.touristTax!;
      const counted = Math.min(nights, tax.maxNights ?? Number.POSITIVE_INFINITY);
      // A tax in the price may come without its rate: nothing to show then
      const rows: DetailRow[] = tax.perNightEur > 0 ? [{ label: "Rate per person and night", value: money(tax.perNightEur), source: tax.source }] : [];
      if (tax.maxNights !== null) rows.push({ label: "Nights taxed at most", value: String(tax.maxNights), source: tax.source });
      if (tax.included) return done("Already in the stay's price: nothing more to pay", "0 €", rows, false);
      return done(
        `${money(tax.perNightEur)} a night per person${tax.maxNights !== null && nights > tax.maxNights ? `, for ${tax.maxNights} nights at most` : ""}, paid on top of the stay's price`,
        `${plural(counted, "night")} × ${money(tax.perNightEur)}`,
        rows,
      );
    }

    case "nights-out": {
      const drinks = settings.partying.drinksPerNight;
      return done(
        `${plural(plan.nightsOut, "night")} out, one every ${settings.partying.nightsPerNightOut} nights: a club and ${drinks} drinks each time`,
        `${plan.nightsOut} × (${money(prices.clubEntry.eur)} + ${drinks} × ${money(prices.drink.eur)})`,
        [price("Club entry", prices.clubEntry), price("A drink", prices.drink), { label: "Drinks a night", value: String(drinks), source: "rule" }],
      );
    }

    case "pre-drinks":
      return done(`Drinks from the supermarket before each night out, shared`, `${plan.nightsOut} × ${money(prices.preDrinks.eur)}`, [price("Each one's share a night", prices.preDrinks)]);

    case "night-transport": {
      const back = plan.nightBack;
      const rows: DetailRow[] = [price("A ticket there", prices.transitTicket)];
      let how = "";
      if (back?.by === "transit") {
        rows.push({ label: `Back at ${settings.partying.nightTransportAt}`, value: `A night bus: ${money(back.eurEach)}`, source: "transitous" });
        how = "the night bus back";
      } else if (back) {
        rows.push(
          { label: `Back at ${settings.partying.nightTransportAt}`, value: `Taxi, ${kms(back.km)}${back.taxis > 0 ? `, ${plural(back.taxis, "taxi")} for the group` : ""}: ${money(back.eurEach)} each`, source: prices.taxiPerKm.source },
          price("Taxi: start", prices.taxiStart),
          price("Taxi: per km", prices.taxiPerKm),
        );
        how = "a taxi back, shared";
      }
      return done(
        `Each night out: public transport to the bars, ${how} at ${settings.partying.nightTransportAt}`,
        `${plan.nightsOut} × (${money(prices.transitTicket.eur)} + ${money(back?.eurEach ?? 0)})`,
        rows,
        back?.by === "taxi" || isEstimate(prices.transitTicket.source),
      );
    }

    case "activities": {
      const rows: DetailRow[] = plan.activities.map((activity, index) => {
        const way = plan.activityWays[index];
        const reach = input.objective === "nature" ? ` · ${way === "on-foot" ? "on foot" : way === "transit" ? "by public transport" : "by car"}, ${kms(activity.roadKmFromStay)}` : "";
        return { label: activity.name, value: `${activity.priceEur > 0 ? money(activity.priceEur) : "free"}${reach}`, source: activity.source };
      });
      const summary =
        input.objective === "nature"
          ? `${plural(plan.hikeDays, "day")} out of ${nights} hiking or visiting, the most worthwhile first: their fees`
          : `The ${plural(plan.activities.length, "most worthwhile visit")}: their tickets`;
      const paid = plan.activities.filter((activity) => activity.priceEur > 0);
      return done(summary, paid.length > 0 ? paid.map((activity) => money(activity.priceEur)).join(" + ") : "0 €", rows);
    }

    case "relax": {
      const spa = plan.activities[0];
      return done(`One spa session: the stay has no spa`, spa ? money(spa.priceEur) : "0 €", spa ? [{ label: spa.name, value: money(spa.priceEur), source: spa.source }] : []);
    }

    case "local-transport": {
      if (input.objective === "nature") {
        const byTransit = plan.activities.filter((_, index) => plan.activityWays[index] === "transit");
        return done(
          `Public transport to the hikes too far to walk to and close enough by bus or train`,
          byTransit.map((activity) => money(activity.transit?.fareEur ?? 0)).join(" + ") || "0 €",
          byTransit.map((activity) => ({ label: activity.name, value: `${activity.transit?.durationMin ?? "?"} min, there and back ${money(activity.transit?.fareEur ?? 0)}`, source: "transitous" as const })),
          isEstimate(prices.transitTicket.source),
        );
      }
      if (input.objective === "none") {
        const tickets = settings.none.transitTicketsPerNight * nights;
        return done(`${settings.none.transitTicketsPerNight} tickets a night to get around`, `${tickets} × ${money(prices.transitTicket.eur)}`, [price("A ticket", prices.transitTicket)]);
      }
      const why =
        input.objective === "culture"
          ? `A day pass a day: the historic centre is ${stay.historicCentreKm !== null ? kms(stay.historicCentreKm) : "too far"} away, more than ${settings.culture.walkableKm} km`
          : `${plural(plan.dayPasses, "day pass", "day passes")} to get around, one every ${settings.chill.nightsPerDayPass} nights`;
      const rows: DetailRow[] = [price("A day pass", prices.transitDayPass)];
      if (input.objective === "culture" && stay.historicCentreKm !== null) rows.push({ label: "To the historic centre", value: kms(stay.historicCentreKm), source: "openstreetmap" });
      return done(why, `${plan.dayPasses} × ${money(prices.transitDayPass.eur)}`, rows);
    }

    case "car-rental": {
      const hub = plan.transfers[0]?.hub ?? input.guests.find((guest) => guest.there)?.there?.hub ?? "the airport";
      return done(
        `${plural(plan.rentalCars, "car")} rented for the whole stay at ${hub}, shared by ${listed(plan.renters.map(nameOf))}: it is their way to the stay too`,
        `${plan.rentalCars} × ${plural(nights, "day")} × ${money(prices.carRentalPerDay.eur)} ÷ ${plan.renters.length}`,
        [price("A car for a day", prices.carRentalPerDay)],
      );
    }

    case "fuel": {
      const renter = guestId !== null && plan.renters.includes(guestId);
      return done(
        `${plural(plan.carsNeeded, "car")} driving ${kms(plan.hikeKm)} to the hikes and back, shared by everyone${renter ? `, and the rented car's drive between the airport and the stay` : ""}`,
        `${plan.carsNeeded} × ${kms(plan.hikeKm)} × ${car.consumptionLPer100Km} L/100 km × ${money(prices.fuelPerL.eur)} ÷ ${input.guests.length}${renter ? " + the drive to and from the airport" : ""}`,
        [price("Fuel, a litre", prices.fuelPerL), { label: "A car's consumption", value: `${car.consumptionLPer100Km} L/100 km`, source: "rule" }],
      );
    }
  }
}

/** A line with its detail and its amounts: for one guest, or for everyone (the Extra page, the summary) */
export type ExtraLineView = LineDetail & {
  /** What one guest pays: theirs in their view; for everyone, the least and the most a guest who has it pays */
  perGuest: { minEur: number; maxEur: number };
  groupEur: number;
  /** Each guest who has it, with their amount */
  byGuest: { guestId: string; name: string; eur: number }[];
  /** For everyone: not every guest has this line (the transfer of those who come by car, a car's parking) */
  partial: boolean;
};

export type ExtraSection = {
  kind: "mandatory" | "plus";
  lines: ExtraLineView[];
  /** The guest's, in their view; for everyone, the average per guest */
  perGuestEur: number;
  groupEur: number;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** The Mandatory and the Plus line by line, in the plan's order, for everyone or for `viewer` only */
export function extraSections(input: ExtraInput, plan: ExtraPlan, viewer: string | null, nameOf: (guestId: string) => string): ExtraSection[] {
  const guests = plan.guests.filter((guest) => viewer === null || guest.guestId === viewer);
  const ids = EXTRA_LINE_IDS.filter((id) => guests.some((guest) => guest.lines.some((line) => line.id === id)));
  const lineOf = (id: ExtraLineId): ExtraLineView => {
    const byGuest = guests.flatMap((guest) => guest.lines.filter((line) => line.id === id).map((line) => ({ guestId: guest.guestId, name: nameOf(guest.guestId), eur: line.eur })));
    const amounts = byGuest.map((entry) => entry.eur);
    return {
      ...lineDetail(id, input, plan, viewer, nameOf),
      perGuest: { minEur: Math.min(...amounts), maxEur: Math.max(...amounts) },
      groupEur: sum(amounts),
      byGuest,
      partial: byGuest.length < guests.length,
    };
  };
  return (["mandatory", "plus"] as const).map((kind): ExtraSection => {
    const lines = ids.filter((id) => MANDATORY_LINES.includes(id) === (kind === "mandatory")).map(lineOf);
    const groupEur = sum(guests.map((guest) => (kind === "mandatory" ? guest.mandatoryEur : guest.plusEur)));
    return { kind, lines, groupEur, perGuestEur: groupEur / Math.max(1, guests.length) };
  });
}
