// Names of stations, as the timetables, SNCF's fare file and SNCF Connect's pages write them: "Paris Gare de Lyon Hall 1 - 2",
// "PARIS GARE DE LYON", "Lyon-Part-Dieu". Two names are the same station when their keys say so.

/**
 * Words that a page and a timetable spell differently for the same place (Eurostar's page says "Londres St Pancras Int'l" in French, the
 * timetable "London St Pancras International"). Applied to the upper-cased name with its punctuation turned into spaces ("INT'L" is "INT L").
 */
const SPELLINGS: [RegExp, string][] = [
  [/\b(INT L|INTL)\b/g, "INTERNATIONAL"],
  [/\bLONDRES\b/g, "LONDON"],
];

/** "PARIS GARE DE LYON Hall 1 - 2", "Paris Gare de Lyon", "Lyon-Part-Dieu" → "PARIS GARE DE LYON", "PARIS GARE DE LYON", "LYON PART DIEU" */
export function stationKey(name: string): string {
  return SPELLINGS.reduce(
    (key, [spelling, word]) => key.replace(spelling, word),
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " "),
  )
    .replace(/\bHALL\b.*$/, "")
    .replace(/(\s\d+)+\s*$/, "")
    .trim();
}

/**
 * The same station, or one that is the other's city ("Lyon" for "Lyon Part Dieu"): the page may say the city, the timetable
 * the station. Neither name may be empty. "Lyon Part Dieu" and "Lyon Perrache" are not the same.
 */
export function sameStation(a: string, b: string): boolean {
  const [ka, kb] = [stationKey(a), stationKey(b)];
  if (!ka || !kb) return false;
  return ka === kb || ` ${ka} `.includes(` ${kb} `) || ` ${kb} `.includes(` ${ka} `);
}
