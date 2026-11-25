// Reading the hotels Google Hotels lists (task.md T7.4). The page is read in the browser into plain
// fields (google-hotels-chrome.ts); this turns them into hotels. Google writes the facts in labels meant
// for screen readers ("4.3 out of 5 stars from 3,038 reviews", "€333 total"), which are steady.
import { ScrapeChangedError } from "../errors";

/** What the browser read off one result, as written on the page. */
export type RawHotelCard = {
  name: string;
  /** "Prices starting from €83, Occidental Atenea Mar" */
  priceLabel: string | null;
  /** "4.3 out of 5 stars from 3,038 reviews, Occidental Atenea Mar" */
  ratingLabel: string | null;
  /** Left null when the page does not label it: the same words are in `text` */
  amenitiesLabel: string | null;
  /** The text of the result, to find the total price and tell a rental from a hotel */
  text: string;
  /** Google's own id for the place, from the link of the result */
  entityId: string | null;
  photos: string[];
  /** Where it is, from the page's own data (hotelPositions), matched by name; absent on cards read before T8.2 */
  position?: Position | null;
};

export type Position = { lat: number; lon: number };

export type Hotel = {
  name: string;
  /** What the stay costs for the party the search was for, taxes and fees included, whole euros */
  totalEur: number;
  /** Out of 5 */
  rating: number | null;
  reviewCount: number | null;
  stars: number | null;
  /** Every amenity the result names, as Google words it */
  amenities: string[];
  entityId: string | null;
  photos: string[];
  lat: number | null;
  lon: number | null;
};

const number = (text: string) => Number(text.replace(/,/g, ""));

/** "€333 total" → 333. Google writes the total for the dates next to the price per night. */
function totalOf(text: string): number | null {
  const match = /€\s?([\d,]+(?:\.\d+)?)\s*total/i.exec(text);
  return match ? Math.round(number(match[1])) : null;
}

/** "Amenities for Occidental Atenea Mar, a 4-star hotel.: Breakfast ($), Free Wi-Fi, ..." as the page words it. */
const AMENITIES = /Amenities for ([^:]*?):\s*(.*?)(?:,?\s*\d-star hotel|View (?:prices|details)|$)/;

/** A result that is a rental (apartment, house) rather than a hotel: Airbnb covers those. */
const isRental = (card: RawHotelCard) => /vacation rental/i.test(card.text) || /^(?:apartment|house|villa|cabin|condo|cottage|bungalow|chalet)\b/i.test(AMENITIES.exec(card.amenitiesLabel ?? card.text)?.[2] ?? "");

function hotelOf(card: RawHotelCard): Hotel | null {
  if (!card.name || isRental(card)) return null;
  const totalEur = totalOf(card.text);
  if (totalEur === null || totalEur <= 0) return null;

  const rating = card.ratingLabel ? /^([\d.]+) out of 5/.exec(card.ratingLabel) : null;
  const reviews = card.ratingLabel ? /from ([\d,]+) reviews?/.exec(card.ratingLabel) : null;
  const words = card.amenitiesLabel ?? card.text;
  const amenities = AMENITIES.exec(words)?.[2] ?? "";
  return {
    name: card.name.replace(/\s+/g, " ").trim(),
    totalEur,
    rating: rating ? Number(rating[1]) : null,
    reviewCount: reviews ? number(reviews[1]) : null,
    stars: Number(/(\d)-star hotel/.exec(words)?.[1]) || null,
    amenities: amenities
      .split(",")
      .map((item) => item.trim().replace(/\s*\(\$+\)$/, ""))
      .filter(Boolean),
    entityId: card.entityId,
    photos: card.photos,
    lat: card.position?.lat ?? null,
    lon: card.position?.lon ?? null,
  };
}

/**
 * The hotels of a list of results, in the order Google gives them. A result that is a rental, or whose
 * price cannot be read, is left out. A page that has results but none that look like a result at all is
 * an error: the page changed.
 */
export function parseHotels(cards: RawHotelCard[]): Hotel[] {
  if (cards.length > 0 && cards.every((card) => card.name === undefined || card.text === undefined)) {
    throw new ScrapeChangedError("Google Hotels answered, but its results are not in a form the scraper knows");
  }
  return cards.flatMap((card) => hotelOf(card) ?? []);
}

/**
 * Where each hotel of a results page is, by name, from the data the page carries in its scripts (task.md T8.2). Each
 * hotel's record starts with its name and its position: `[null,"Hotel SB | Plaça Europa",[[41.359122,2.132418],...`.
 * Checked on Barcelona (2026-11-14) against where the hotels are. The first position of a name is kept.
 */
export function hotelPositions(scripts: string): Map<string, Position> {
  const positions = new Map<string, Position>();
  for (const match of scripts.matchAll(/\[null,("(?:[^"\\]|\\.)*"),\[\[(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)\]/g)) {
    let name: string;
    try {
      name = JSON.parse(match[1]) as string;
    } catch {
      continue;
    }
    const lat = Number(match[2]);
    const lon = Number(match[3]);
    if (!positions.has(name) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) positions.set(name, { lat, lon });
  }
  return positions;
}

/** The position of a card's hotel among those of the page: by its exact name, else by its name without accents, case or punctuation. */
export function positionFor(name: string, positions: Map<string, Position>): Position | null {
  const exact = positions.get(name) ?? positions.get(name.replace(/\s+/g, " ").trim());
  if (exact) return exact;
  const key = looseName(name);
  for (const [other, position] of positions) if (looseName(other) === key) return position;
  return null;
}

const looseName = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
