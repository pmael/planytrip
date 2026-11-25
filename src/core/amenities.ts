// What a stay's amenities say for the Extra (use-cases.md R10, R11): whether the guests can cook, park for free, swim,
// relax in a spa or a sauna, and have a view. Airbnb and Google Hotels name amenities in their own words ("Free parking
// on premises", "Shared outdoor pool", "Hot tub"); they are recognised by those words. Pure.

export type AmenityFlags = {
  kitchen: boolean;
  freeParking: boolean;
  pool: boolean;
  spa: boolean;
  /** A sauna, a hot tub, a hammam or a steam room */
  sauna: boolean;
  view: boolean;
};

/** A kitchen, or what one cooks with: Airbnb may list "Kitchen" as missing in a flat with cooking basics and a stove */
const KITCHEN = /\bkitchen|cooking basics|\bstove\b|\boven\b|cooktop|\bhob\b/i;
const FREE_PARKING = /\bfree\b[^,]*\bparking\b/i;
const POOL = /\bpool\b/i;
const NOT_A_POOL = /pool table|pool toys/i;
const SPA = /\bspa\b|wellness/i;
const SAUNA = /sauna|hot tub|jacuzzi|hammam|steam room|whirlpool/i;
/** "Sea view", "City skyline view", "Mountain view"; a courtyard is not a view */
const VIEW = /\bviews?\b/i;
const NOT_A_VIEW = /courtyard/i;

/** The flags of a list of amenities, each named as the site names it. Only amenities the place has: Airbnb's "not included" ones are left out before. */
export function amenityFlags(amenities: readonly string[]): AmenityFlags {
  const has = (pattern: RegExp, unless?: RegExp) => amenities.some((amenity) => pattern.test(amenity) && !unless?.test(amenity));
  return {
    kitchen: has(KITCHEN),
    freeParking: has(FREE_PARKING),
    pool: has(POOL, NOT_A_POOL),
    spa: has(SPA),
    sauna: has(SAUNA),
    view: has(VIEW, NOT_A_VIEW),
  };
}
