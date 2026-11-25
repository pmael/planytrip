export const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2026-08-26" → "26 aug", without going through Date so no timezone can shift the day. */
function formatDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day} ${MONTHS[Number(month) - 1]}`;
}

/** "26 aug - 14 sep", or just the one date given, or an empty string. */
export function formatDateRange(from: string, to: string): string {
  if (from && to) return `${formatDay(from)} - ${formatDay(to)}`;
  return from || to ? formatDay(from || to) : "";
}

/** "2026-08-26" → "26/08" */
export function formatDayMonth(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

/**
 * An amount in euros as the dashboard writes it: "1800 €" when it is a whole number of euros,
 * "~ 2166.3 €" when it has been rounded (use-cases.md C-S3: rounding happens at display time).
 */
export function formatEur(value: number): string {
  return Math.abs(value - Math.round(value)) < 0.005 ? `${Math.round(value)} €` : `~ ${value.toFixed(1)} €`;
}

/** "400€", "21.1€": rounded to a tenth, without a trailing ".0". For tight spaces such as a card's figures. */
export function formatEurShort(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}€`;
}
