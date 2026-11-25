// Who runs a train, as the card says it: the timetables name the operator in many ways ("SNCF VOYAGEURS",
// "RENFE OPERADORA", "Schweizerische Bundesbahnen SBB"). Known ones get a short name; the others keep theirs.
import type { TrainJourney } from "./train-types";

const KNOWN: { pattern: RegExp; slug: string; label: string }[] = [
  { pattern: /sncf/i, slug: "sncf", label: "SNCF" },
  { pattern: /trenitalia/i, slug: "trenitalia", label: "Trenitalia" },
  { pattern: /italo|nuovo trasporto/i, slug: "italo", label: "Italo" },
  { pattern: /ouigo\s*espa/i, slug: "ouigo-espana", label: "Ouigo España" },
  { pattern: /renfe/i, slug: "renfe", label: "Renfe" },
  { pattern: /iryo/i, slug: "iryo", label: "Iryo" },
  { pattern: /sbb|schweizerische bundesbahnen/i, slug: "sbb", label: "SBB" },
  { pattern: /\bdb\b|deutsche bahn/i, slug: "deutsche-bahn", label: "Deutsche Bahn" },
  { pattern: /oebb|öbb/i, slug: "oebb", label: "ÖBB" },
  { pattern: /ceske drahy|české dráhy/i, slug: "ceske-drahy", label: "České dráhy" },
  { pattern: /regiojet|student agency/i, slug: "regiojet", label: "RegioJet" },
  { pattern: /flix/i, slug: "flixbus", label: "FlixBus" },
  { pattern: /eurostar/i, slug: "eurostar", label: "Eurostar" },
  { pattern: /sncb|nmbs/i, slug: "sncb", label: "SNCB" },
  { pattern: /^ns\b|nederlandse spoorwegen/i, slug: "ns", label: "NS" },
  { pattern: /comboios|^cp\b/i, slug: "cp", label: "CP" },
];

/** "alex - Die Länderbahn GmbH DLB" → "alex-die-landerbahn", without the company's legal form */
const slugOf = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(gmbh|ag|sa|spa|s\.?r\.?o|a\.?s|ltd|bv|nv|ab|dlb|kundenservice)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 3)
    .join("-");

/** The operator's short name and the slug stored as the option's provider. */
export function trainOperator(name: string): { slug: string; label: string } {
  const known = KNOWN.find(({ pattern }) => pattern.test(name));
  if (known) return { slug: known.slug, label: known.label };
  return { slug: slugOf(name) || "trains", label: name || "Train" };
}

/** The labels of the known operators, by slug, for the pages. */
export const TRAIN_PROVIDER_LABELS: Record<string, string> = Object.fromEntries(KNOWN.map(({ slug, label }) => [slug, label]));

/**
 * The operator of the longest ride of a journey, regional trains last: the one a person would name when asked "which
 * train?" (the TGV, not the TER that brings you to it).
 */
export function mainOperator(journey: TrainJourney): { slug: string; label: string } {
  const minutes = (leg: TrainJourney["legs"][number]) => Date.parse(`${leg.arriveAt}Z`) - Date.parse(`${leg.departAt}Z`);
  const longest = (legs: TrainJourney["legs"]) => legs.reduce((best, leg) => (minutes(leg) > minutes(best) ? leg : best), legs[0]);
  const fast = journey.legs.filter((leg) => leg.mode !== "REGIONAL_RAIL");
  return trainOperator(longest(fast.length > 0 ? fast : journey.legs).operator);
}
