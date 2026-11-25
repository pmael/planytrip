// Whether a stay's price already has the tourist tax in it (use-cases.md R10, extra.md §5.3), as far as its own page
// says. Pure.
//
// What was found on real pages (2026-11-14):
// - Airbnb collects the tax itself for some listings (every Paris one seen, one Barcelona one in four): its price details
//   then have a "Taxes" line, and the total the app keeps already counts it. It is decided listing by listing.
// - For the others (two Barcelona listings) it does not, and the page still says "Prices include all taxes and fees":
//   that sentence only covers what Airbnb collects, so it proves nothing. The host writes it in the description
//   instead: "The TOURIST TAX will be paid at check-in (it is not included in the apartment booking)", often with the rate.
// - Google Hotels' policy is that a total includes every mandatory charge, city and tourism taxes too, even those paid
//   at the hotel: https://support.google.com/hotelprices/answer/6064432

/** How the answer was found */
export type StayTaxBasis = "airbnb-collects" | "host-says-not-included" | "host-gives-rate" | "host-says-included" | "google-policy";

export type StayTaxFinding = {
  /** null: the page does not say; the place decides (task.md T8.5) */
  included: boolean | null;
  /** What Airbnb collects for the whole stay and the whole group, when it does */
  amountEur: number | null;
  /** The rate the host writes, per person per night */
  perPersonNightEur: number | null;
  /** "up to a maximum of 7 nights" */
  maxNights: number | null;
  basis: StayTaxBasis | null;
  /** The words it was read from, to show and to check */
  evidence: string | null;
};

export const UNKNOWN_TAX: StayTaxFinding = { included: null, amountEur: null, perPersonNightEur: null, maxNights: null, basis: null, evidence: null };

export const GOOGLE_HOTELS_TAX: StayTaxFinding = {
  ...UNKNOWN_TAX,
  included: true,
  basis: "google-policy",
  evidence: "Google Hotels' totals include city and tourist taxes, even those paid at the hotel (its taxes and fees policy)",
};

/** A tourist tax by any of its names; not "tax identification number" or "VAT" */
const TAX_WORDS =
  /touris(?:t|tic|m)\s+tax|city\s+tax|occupancy\s+tax|stay\s+tax|taxe\s+de\s+s[ée]jour|tasa\s+tur[íi]stica|impuesto\s+(?:tur[íi]stico|sobre\s+estancias)|taxa\s+tur[íi]stica|imposto\s+de\s+estadia|tassa\s+di\s+soggiorno|kurtaxe|ecotax/i;

const NOT_INCLUDED =
  /not\s+(?:be\s+)?included|in\s+addition\s+to|on\s+top\s+of|additional(?:ly)?|(?:to|must|will|shall)\s+be\s+(?:charged|collected)|(?:required|have|need|obliged)\s+to\s+(?:charge|collect)|(?:we|i|host)\s+(?:must|will|shall)\s+(?:charge|collect)|at\s+the\s+start\s+of\s+(?:your|the)\s+stay|n[o']t\s+part\s+of|excluded|exclusive\s+of|separately|paid\s+(?:by\s+hand\s+)?(?:at|on|upon|in|by|directly|locally|to\s+the\s+host)|(?:to|must|will|shall|has\s+to|needs\s+to)\s+be\s+paid|pay(?:able)?\s+(?:at|on|upon)|at\s+check-?in|on\s+arrival|upon\s+arrival|in\s+cash|no\s+incluid|non\s+(?:inclus|compris)|à\s+r[ée]gler|à\s+payer|sur\s+place|se\s+paga|a\s+pagar|en\s+efectivo/i;

const INCLUDED = /\bincluded\b|\bincludes\b|incluid[ao]s?|\binclus[e]?\b|compris[e]?/i;

/** "€10.45 per person per night", "€ 9,50 per day / per adult", "2,50 € par nuit et par personne" */
const RATE = /(?:€\s?(\d{1,2}(?:[.,]\d{1,2})?)|(\d{1,2}(?:[.,]\d{1,2})?)\s?(?:€|eur(?:os?)?\b))\s*(?:\(?\s*)?(?:per|a|\/|par|por|each|pro)\s*(?:person|adult|guest|pax|night|day|nuit|personne|noche|persona|d[íi]a|nacht)/gi;

const MAX_NIGHTS = /(?:maximum|max\.?|up\s+to|limit(?:ed)?\s+(?:of|to)|(?:only\s+(?:to\s+)?)?the\s+first|hasta|jusqu'?à)\s+(?:a\s+maximum\s+of\s+)?(?:of\s+)?(\d{1,2})\s+(?:consecutive\s+)?(?:nights|days|noches|nuits)/i;

const plain = (html: string) =>
  html
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/[  ﻿]/g, " ");

/** Under a heading: at most this many lines, and none past the next heading */
const LINES_UNDER_A_HEADING = 3;

function followingLines(lines: string[], heading: number): string[] {
  const under: string[] = [];
  for (const line of lines.slice(heading + 1, heading + 1 + LINES_UNDER_A_HEADING)) {
    if (/:\s*$/.test(line)) break;
    under.push(line);
  }
  return under;
}

/**
 * What the host writes about the tourist tax, in the listing's description and rules (HTML or text); null when they
 * say nothing about it. A host who says it is paid at check-in, in cash, charged on top, or not included: not included;
 * likewise a host who gives its rate per person without saying it is included. A host who only says it is included:
 * included.
 */
export function hostTaxStatement(texts: readonly string[]): StayTaxFinding | null {
  const lines = texts.flatMap((text) => plain(text).split(/\n+/)).map((line) => line.trim()).filter(Boolean);
  let mentioned: string | null = null;
  let notIncluded: string | null = null;
  let included: string | null = null;
  const rates: number[] = [];
  let maxNights: number | null = null;

  lines.forEach((line, index) => {
    if (!TAX_WORDS.test(line)) return;
    // A heading ("Tourist Tax in Barcelona:") is about the lines under it, up to the next heading
    const context = /:\s*$/.test(line) ? [line, ...followingLines(lines, index)].join(" ") : line;
    mentioned ??= context;
    if (NOT_INCLUDED.test(context)) notIncluded ??= context;
    else if (INCLUDED.test(context)) included ??= context;
    for (const match of context.matchAll(RATE)) rates.push(Number((match[1] ?? match[2]).replace(",", ".")));
    maxNights ??= Number(MAX_NIGHTS.exec(context)?.[1]) || null;
  });
  if (mentioned === null) return null;

  // A host who gives the rate per person charges it themselves: nobody quotes the rate of a tax Airbnb collects
  const rated = notIncluded === null && included === null && rates.length > 0;
  const evidence = (notIncluded ?? included ?? mentioned) as string;
  return {
    included: notIncluded !== null || rated ? false : included !== null ? true : null,
    amountEur: null,
    perPersonNightEur: rates.length > 0 ? Math.max(...rates) : null,
    maxNights,
    basis: notIncluded !== null ? "host-says-not-included" : rated ? "host-gives-rate" : included !== null ? "host-says-included" : null,
    evidence: evidence.length > 240 ? `${evidence.slice(0, 237)}...` : evidence,
  };
}

/**
 * An Airbnb stay's tax: a "Taxes" line in Airbnb's own price details means Airbnb collects it and the total has it;
 * otherwise what the host writes; otherwise nothing is known.
 */
export function airbnbTax(collectedEur: number | null, host: StayTaxFinding | null): StayTaxFinding {
  if (collectedEur !== null && collectedEur > 0) {
    return { ...UNKNOWN_TAX, included: true, amountEur: collectedEur, basis: "airbnb-collects", evidence: `Airbnb's price details: Taxes €${collectedEur}` };
  }
  return host ?? UNKNOWN_TAX;
}
