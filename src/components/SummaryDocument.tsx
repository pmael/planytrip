import { ArrowRight, BedDouble, BusFront, CarFront, ExternalLink, Plane, Star, TramFront, TriangleAlert } from "lucide-react";
import { formatDuration } from "@/core/comfort";
import type { Color, TransportMode } from "@/core/types";
import { COLOR_TEXT, TIER_LABELS } from "@/lib/colorClasses";
import { colorOf } from "@/core/colors";
import { BUDGET_LEVEL_LABELS, countryName, OBJECTIVE_LABELS } from "@/lib/deliberationText";
import { SOURCE_LABELS, type DetailSource } from "@/lib/extraLines";
import { formatDateRange, formatDayMonth, formatEur } from "@/lib/form";
import { MODE_LABELS } from "@/lib/reachabilityText";
import { providerLabel, VARIANT_LABELS } from "@/lib/transportText";
import { cn } from "@/lib/utils";
import type { SummaryView } from "@/server/services/summaries";
import { eurText } from "./ExtraBreakdown";
import { plainReason } from "./RatingChip";

const MODE_ICONS: Record<TransportMode, typeof Plane> = { plane: Plane, train: TramFront, bus: BusFront, car: CarFront };
const COMFORT_WORD = { green: "Comfortable", yellow: "Acceptable", red: "Uncomfortable" } as const;
const PROVIDER_WORD = { airbnb: "Airbnb", booking: "Hotel" } as const;

type Transport = NonNullable<SummaryView["snapshot"]["guests"][number]["transport"]>;
type Extra = NonNullable<SummaryView["snapshot"]["extra"]>;
type ExtraLine = Extra["sections"][number]["lines"][number];

const PRICES_WORDS = { ai: "local prices estimated by the AI", rules: "local prices from the country's price level, not by the AI", "eu-average": "EU average prices" } as const;
const sourceWord = (source: string | null) => (source && source in SOURCE_LABELS ? SOURCE_LABELS[source as DetailSource] : source);

/** What one guest pays for a line: one amount, or the range when guests pay different amounts */
function perGuestText(line: ExtraLine) {
  const amounts = line.byGuest.map((guest) => guest.eur);
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  if (high - low < 0.005) return eurText(low, line.estimate);
  return line.estimate ? `≈ ${Math.round(low)}–${Math.round(high)} €` : `${eurText(low, false)}–${eurText(high, false)}`;
}

/**
 * What the trip cost once there when it was validated (task.md T8.13), as the Extra page showed it for everyone: each
 * line with what it counts, how, and the prices behind it, so the paper says it all; then the advice.
 */
function ExtraOnceThere({ extra, objective, guestCount }: { extra: Extra; objective: keyof typeof OBJECTIVE_LABELS; guestCount: number }) {
  const estimate = extra.sections.some((section) => section.lines.some((line) => line.estimate));
  const minus = (eur: number) => `−${Math.round(eur)} €`;
  return (
    <>
      <Heading>Once there: the Extra</Heading>
      <p className="mb-3 text-base text-black/60">
        Worked out for &ldquo;{extra.stayTitle}&rdquo;, with {PRICES_WORDS[extra.pricesSource]}.
        {!extra.counted && " It was not counted in the totals above: the destination's local prices were not known yet."} The Plus is a suggestion for what the trip is for: only the Mandatory could put a guest over budget.
      </p>
      <table className="w-full text-left text-lg">
        <thead className="text-base text-black/50">
          <tr>
            <th className="py-2 font-normal">What</th>
            <th className="py-2 text-right font-normal">Per guest</th>
            <th className="py-2 pl-4 text-right font-normal">Group</th>
          </tr>
        </thead>
        {extra.sections
          .filter((section) => section.lines.length > 0)
          .map((section) => (
            <tbody key={section.kind}>
              <tr>
                <th colSpan={3} className="pt-4 pb-1 text-left text-base font-normal tracking-wide text-[#0d4a35]/70 uppercase">
                  {section.kind === "mandatory" ? "Mandatory" : `Plus · ${OBJECTIVE_LABELS[objective]}`}
                </th>
              </tr>
              {section.lines.map((line) => {
                const differs = line.byGuest.length > 1 && new Set(line.byGuest.map((guest) => Math.round(guest.eur * 100))).size > 1;
                return (
                  <tr key={line.id} className="border-t border-black/10 break-inside-avoid align-top">
                    <td className="py-3 pr-4">
                      <span className="text-[#0d4a35]">{line.label}</span>
                      <span className="block text-base text-black/65">
                        {line.summary}
                        {line.byGuest.length < guestCount && ` (${line.byGuest.map((guest) => guest.name).join(", ")})`}
                      </span>
                      <span className="mt-1 block text-sm text-black/50">
                        {/* A line of nothing (a tax already in the stay's price) says so in its summary */}
                        {line.groupEur > 0 && line.formula}
                        {line.rows.map((row, index) => (
                          <span key={`${row.label}-${index}`}>
                            {line.groupEur > 0 || index > 0 ? " · " : ""}
                            {row.label}: {row.href ? <a href={row.href} className="text-[#1a5fb4] underline">{row.value}</a> : row.value}
                            {row.source && ` (${sourceWord(row.source)})`}
                          </span>
                        ))}
                      </span>
                      {differs && <span className="block text-sm text-black/60">Each: {line.byGuest.map((guest) => `${guest.name} ${eurText(guest.eur, line.estimate)}`).join(" · ")}</span>}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">{perGuestText(line)}</td>
                    <td className="py-3 pl-4 text-right whitespace-nowrap text-black/70">{eurText(line.groupEur, line.estimate)}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-black/25">
                <td className="py-2 text-[#0d4a35]">{section.kind === "mandatory" ? "Mandatory" : "Plus"}</td>
                <td className="py-2 text-right whitespace-nowrap">{eurText(section.perGuestEur, estimate)}</td>
                <td className="py-2 pl-4 text-right whitespace-nowrap">{eurText(section.groupEur, estimate)}</td>
              </tr>
            </tbody>
          ))}
        <tfoot>
          <tr className="border-t-2 border-black/20 text-xl text-[#0d4a35]">
            <td className="py-3">Extra</td>
            <td className="py-3 text-right whitespace-nowrap">{eurText(extra.totalEur / Math.max(1, guestCount), estimate)}</td>
            <td className="py-3 pl-4 text-right whitespace-nowrap">{eurText(extra.totalEur, estimate)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-2 text-sm text-black/50">Per guest: what one guest pays for a line (a range where guests pay different amounts), and the average per guest for the totals.</p>

      {extra.advice && (extra.advice.group.length > 0 || extra.advice.guests.length > 0) && (
        <section aria-label="Advice" className="mt-6 break-inside-avoid rounded-[18px] border border-[#0d4a35]/15 p-5 text-lg">
          <p className="text-[#0d4a35]">
            Advice{" "}
            <span className="text-base text-black/55">
              · {extra.advice.source === "ai" ? "written by the AI, the euros are the app's" : "rule-based, not written by the AI"}
              {extra.advice.stale && " · written before the last change to the trip"}
            </span>
          </p>
          {extra.advice.group.length > 0 && (
            <ul className="mt-2">
              {extra.advice.group.map((line) => {
                const savings = Object.values(line.savingEachEur).map(Math.round);
                return (
                  <li key={line.text} className="flex flex-wrap justify-between gap-x-4">
                    <span>Everyone: {line.text}</span>
                    <span className="whitespace-nowrap text-[#1f9d74]">{Math.min(...savings) === Math.max(...savings) ? `${minus(savings[0] ?? 0)} each` : `−${Math.min(...savings)} to ${Math.max(...savings)} € each`}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {extra.advice.guests.map((guest) => (
            <div key={guest.guestId} className="mt-3">
              <p className="text-base text-black/60">{guest.name}</p>
              <ul>
                {guest.lines.map((line) => (
                  <li key={line.text} className="flex flex-wrap justify-between gap-x-4">
                    <span>{line.text}</span>
                    <span className="whitespace-nowrap text-[#1f9d74]">{minus(line.savingEur)}</span>
                  </li>
                ))}
              </ul>
              <p className={cn("text-base", guest.fits ? "text-[#1f9d74]" : "text-[#b7791f]")}>
                {guest.fits ? `With this, ≈ ${Math.round(guest.afterEur)} € of ${guest.budgetEur} €.` : `Still ≈ ${Math.round(guest.afterEur)} € of ${guest.budgetEur} €: it does not fit, even with these.`}
              </p>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

const clock = (iso: string) => iso.slice(11, 16);
const dayOf = (iso: string) => iso.slice(0, 10);
const daysLater = (from: string, to: string) => Math.round((Date.parse(`${dayOf(to)}T00:00:00Z`) - Date.parse(`${dayOf(from)}T00:00:00Z`)) / 86_400_000);

/** One way of the trip in a line: "26/08 · 06:45 → 08:00 (1 h 15)", or the length of the drive for a car. */
function legText(departAt: string | null, arriveAt: string | null, durationMin: number | null, fallbackDay: string | null): string {
  const length = durationMin === null ? "" : formatDuration(durationMin);
  if (departAt && arriveAt) {
    const later = daysLater(departAt, arriveAt);
    return `${formatDayMonth(dayOf(departAt))} · ${clock(departAt)} → ${clock(arriveAt)}${later > 0 ? ` (+${later})` : ""}${length ? ` · ${length}` : ""}`;
  }
  return `${fallbackDay ? `${formatDayMonth(fallbackDay)} · ` : ""}leave when you like${length ? ` · ${length} of driving` : ""}`;
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-12 mb-4 border-b border-[#0d4a35]/20 pb-2 text-2xl font-normal text-[#0d4a35] print:mt-8">{children}</h2>;
}

function Offer({ url }: { url: string | null }) {
  return url ? (
    <a href={url} className="inline-flex items-center gap-1.5 text-[#1a5fb4] underline break-all">
      <ExternalLink aria-hidden className="size-4 shrink-0" />
      {url}
    </a>
  ) : (
    <span className="text-black/45">No link for this offer</span>
  );
}

/** `lastMileCounted`: a summary validated before the Extra, whose transport has the way from the airport in its cost */
function GetThere({ guestName, transport, from, to, lastMileCounted }: { guestName: string; transport: Transport; from: string | null; to: string | null; lastMileCounted: boolean }) {
  const Icon = MODE_ICONS[transport.mode];
  const variant = VARIANT_LABELS[transport.variant];
  const comfort = colorOf("comfort", transport.comfortLevel);
  return (
    <li className="break-inside-avoid rounded-[18px] border border-[#0d4a35]/15 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-3 text-xl text-[#0d4a35]">
          <Icon aria-hidden className="size-6 stroke-[1.5]" />
          {guestName}
          <span className="text-black/60">
            · {MODE_LABELS[transport.mode]}
            {transport.mode === "car" ? (variant ? ` (${variant.toLowerCase()})` : "") : ` with ${providerLabel(transport.provider)}`}
          </span>
        </p>
        <p className="text-xl">{formatEur(transport.costEur)}</p>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-base text-black/80">
        <dt className="text-black/50">Out</dt>
        <dd>{legText(transport.outDepartAt, transport.outArriveAt, transport.outDurationMin, from)}</dd>
        <dt className="text-black/50">Back</dt>
        <dd>{legText(transport.backDepartAt, transport.backArriveAt, transport.backDurationMin, to)}</dd>
        {transport.mode !== "car" && transport.stops !== null && (
          <>
            <dt className="text-black/50">Stops</dt>
            <dd>{transport.stops === 0 ? "Direct" : transport.stops}</dd>
          </>
        )}
        <dt className="text-black/50">Comfort</dt>
        <dd className={COLOR_TEXT[comfort]}>
          {COMFORT_WORD[transport.comfortLevel]}
          {transport.comfortReasons.length > 0 && <span className="text-black/60"> · {transport.comfortReasons.join(", ")}</span>}
        </dd>
        <dt className="text-black/50">Fare</dt>
        <dd>
          {transport.priceKind === "estimated" && "about "}
          {formatEur(transport.priceEur)} {transport.priceUnit === "per_vehicle" ? "for the car, shared" : "per person"}
          {transport.priceKind === "estimated" && <span className="text-black/60"> (estimated{transport.priceNote ? `: ${transport.priceNote}` : ""})</span>}
          {transport.priceKind === "observed" && transport.priceNote && <span className="text-black/60"> ({transport.priceNote})</span>}
          {lastMileCounted && transport.lastMileEur > 0 && ` + ${formatEur(transport.lastMileEur)} to get from the ${transport.mode === "train" ? "station" : "airport"}`}
        </dd>
        <dt className="text-black/50">Offer</dt>
        <dd>
          <Offer url={transport.url} />
        </dd>
      </dl>
      {transport.source === "fallback" && (
        <p className="mt-3 text-base text-[#d33a2f]">This is not a way they accept: it is counted as an assumption, as no accepted way gets there.</p>
      )}
      {transport.source === "selected" && <p className="mt-3 text-base text-black/55">Chosen by {guestName} (❤).</p>}
    </li>
  );
}

/**
 * The summary of a validated destination, as it was frozen (use-cases.md C-S7): what each guest pays,
 * how each gets there and where they stay, with the links to the offers. A paper-like page that
 * prints as it reads. Prices that have moved since are flagged at the top.
 */
export function SummaryDocument({ summary }: { summary: SummaryView }) {
  const { snapshot, priceChanges } = summary;
  const { destination, dates, totals, ranking, guests, housing } = snapshot;
  // Validated with the Extra (task.md T8.9): its column, and the way from the airport is in it, not in the transport
  const withExtra = guests.some((guest) => guest.mandatoryEur != null);
  const totalColor = COLOR_TEXT[colorOf("budget", totals.tier)];
  const validatedOn = new Date(summary.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <article aria-label={`Summary: ${destination.shortLabel}`} className="mx-auto w-full max-w-[980px] rounded-[28px] bg-white p-12 text-[#1a2b24] shadow-[0_10px_50px_rgb(0_0_0/0.35)] print:max-w-none print:rounded-none print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-lg text-black/55">Trip summary · {snapshot.tripName}</p>
          <h1 className="mt-1 text-6xl font-normal text-[#0d4a35]">{destination.shortLabel}</h1>
          <p className="mt-2 text-xl text-black/70">
            {countryName(destination.countryCode)}
            {destination.airports.length > 0 && ` · ${destination.airports.join(", ")}`}
            {" · "}
            {OBJECTIVE_LABELS[destination.objective]}, {BUDGET_LEVEL_LABELS[destination.budgetLevel].toLowerCase()}
          </p>
          <p className="mt-1 text-xl">
            {dates ? (
              <>
                {formatDateRange(dates.from, dates.to)} · {dates.nights} {dates.nights === 1 ? "night" : "nights"}
              </>
            ) : (
              <span className="text-[#d33a2f]">No dates work for everyone</span>
            )}
          </p>
        </div>
        <div className="rounded-[22px] bg-[#f1f7f4] px-8 py-5 text-center">
          <p className="text-lg text-black/60">Total for the group</p>
          <p className={cn("text-5xl", totalColor)}>
            {formatEur(totals.totalEur)}
            {totals.includesFallback && <span title="Counts a way of getting there that a guest did not choose">*</span>}
          </p>
          <p className="mt-1 text-lg text-black/70">{formatEur(totals.perGuestEur)} per guest</p>
        </div>
      </header>
      <p className="mt-4 text-base text-black/50">Validated on {validatedOn}. The prices below are the ones it was decided on.</p>

      {priceChanges.length > 0 && (
        <section role="status" aria-label="Prices have changed" className="mt-6 rounded-[18px] border border-amber-500/40 bg-amber-50 p-5 text-amber-950 break-inside-avoid">
          <p className="flex items-center gap-3 text-xl">
            <TriangleAlert aria-hidden className="size-6 shrink-0 stroke-[1.6]" />
            Some prices have changed since this was validated
          </p>
          <ul className="mt-3 flex flex-col gap-1 text-lg">
            {priceChanges.map((change) => (
              <li key={`${change.kind}-${change.label}`}>
                {change.label}: {formatEur(change.wasEur)}{" "}
                <ArrowRight aria-hidden className="mx-1 inline size-4" />
                {change.nowEur === null ? "no longer offered" : formatEur(change.nowEur)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!ranking.eligible && (
        <section aria-label="Not everyone is covered" className="mt-6 rounded-[18px] border border-[#d33a2f]/40 bg-[#d33a2f]/5 p-5 text-lg text-[#8f1f17] break-inside-avoid">
          This destination did not work for everyone when it was validated:{" "}
          {ranking.blockers.map((blocker) => (blocker.kind === "over" ? `${blocker.name} is ${Math.round(blocker.overBudgetEur)} € over budget` : `${blocker.name} cannot get there by a way they accept`)).join("; ")}.
        </section>
      )}

      <Heading>What each guest pays</Heading>
      <table className="w-full text-left text-lg">
        <thead className="text-base text-black/50">
          <tr>
            <th className="py-2 font-normal">Guest</th>
            <th className="py-2 text-right font-normal">Transport</th>
            <th className="py-2 text-right font-normal">Housing</th>
            {withExtra && <th className="py-2 text-right font-normal">Extra</th>}
            <th className="py-2 text-right font-normal">Total</th>
            <th className="py-2 pl-6 font-normal">Of their budget</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((guest) => {
            const color: Color = colorOf("budget", guest.status === "unreachable" ? "over" : guest.tier);
            return (
              <tr key={guest.id} className="border-t border-black/10 break-inside-avoid">
                <td className="py-3">
                  <span className="flex items-center gap-2">
                    {guest.name}
                    {guest.starred && <Star aria-label="★ for this destination" className="size-4 fill-[#e5c35a] text-[#c9a84c]" />}
                  </span>
                  <span className="block text-base text-black/50">from {guest.home.split(",")[0]}</span>
                </td>
                <td className="py-3 text-right">{guest.transport ? formatEur(guest.transport.costEur) : "—"}</td>
                <td className="py-3 text-right">{formatEur(guest.housingShareEur)}</td>
                {withExtra && <td className="py-3 text-right">{guest.mandatoryEur == null ? "—" : formatEur(guest.mandatoryEur + (guest.plusEur ?? 0))}</td>}
                <td className={cn("py-3 text-right text-xl", COLOR_TEXT[color])}>{guest.costEur === null ? "—" : formatEur(guest.costEur)}</td>
                <td className={cn("py-3 pl-6", COLOR_TEXT[color])}>
                  {guest.status === "unreachable"
                    ? "No way there"
                    : `${guest.costEur === null ? "—" : `${Math.round((guest.costEur / guest.maxBudgetEur) * 100)} %`} of ${formatEur(guest.maxBudgetEur)} · ${TIER_LABELS[guest.tier]}${guest.overBudgetEur ? ` (+${Math.round(guest.overBudgetEur)} €)` : ""}`}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black/20">
            <td className="py-3" colSpan={withExtra ? 4 : 3}>
              The group
            </td>
            <td className={cn("py-3 text-right text-xl", totalColor)}>{formatEur(totals.totalEur)}</td>
            <td className="py-3 pl-6 text-black/60">{formatEur(totals.perGuestEur)} each</td>
          </tr>
        </tfoot>
      </table>

      <Heading>Getting there</Heading>
      <ul className="flex flex-col gap-4">
        {guests.map((guest) =>
          guest.transport ? (
            <GetThere key={guest.id} guestName={guest.name} transport={guest.transport} from={dates?.from ?? null} to={dates?.to ?? null} lastMileCounted={guest.mandatoryEur == null} />
          ) : (
            <li key={guest.id} className="rounded-[18px] border border-[#d33a2f]/30 p-5 text-lg text-[#d33a2f]">
              {guest.name}: no way of getting there was found.
            </li>
          ),
        )}
      </ul>

      <Heading>Where you stay</Heading>
      {housing ? (
        <div className="break-inside-avoid rounded-[18px] border border-[#0d4a35]/15 p-5">
          <p className="flex flex-wrap items-center justify-between gap-2 text-xl text-[#0d4a35]">
            <span className="flex items-center gap-3">
              <BedDouble aria-hidden className="size-6 stroke-[1.5]" />
              {housing.title}
            </span>
            <span className="text-black">{formatEur(housing.totalEur)}</span>
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-base text-black/80">
            <dt className="text-black/50">Source</dt>
            <dd>
              {PROVIDER_WORD[housing.provider]}
              {housing.chosenByGroup ? " · the group's ❤" : " · the cheapest that fits the group"}
            </dd>
            <dt className="text-black/50">Stay</dt>
            <dd>
              {formatDateRange(housing.checkIn, housing.checkOut)} · {housing.nights} {housing.nights === 1 ? "night" : "nights"}
            </dd>
            <dt className="text-black/50">Rooms</dt>
            <dd>
              {[housing.rooms !== null && `${housing.rooms} ${housing.rooms === 1 ? "room" : "rooms"}`, housing.beds !== null && `${housing.beds} ${housing.beds === 1 ? "bed" : "beds"}`, `sleeps ${housing.capacity}`].filter(Boolean).join(" · ")}
              {housing.rating !== null && ` · rated ${housing.rating}/5`}
            </dd>
            <dt className="text-black/50">Cost</dt>
            <dd>
              {formatEur(housing.totalEur)} in all, {formatEur(housing.perGuestEur)} per guest
            </dd>
            <dt className="text-black/50">Offer</dt>
            <dd>
              <Offer url={housing.url} />
            </dd>
          </dl>
          {housing.analysis && (
            <p className="mt-3 text-base text-black/70">
              <span className="text-black/50">
                {housing.analysis.ratedBy === "rules" ? "Rule-based score" : "The AI\u2019s view"} ({housing.analysis.fitScore}/100):{" "}
              </span>
              {housing.analysis.ratedBy === "rules" ? plainReason(housing.analysis.summary) : housing.analysis.summary}
            </p>
          )}
        </div>
      ) : (
        <p className="text-lg text-[#d33a2f]">No accommodation was found for this destination.</p>
      )}

      {snapshot.extra && <ExtraOnceThere extra={snapshot.extra} objective={destination.objective} guestCount={guests.length} />}

      <footer className="mt-12 border-t border-black/10 pt-4 text-sm text-black/45">
        Amounts are in euros; a figure with a * counts a way of getting there that a guest did not choose{snapshot.extra ? ", and ≈ marks an estimate" : ""}. Prices are as found on the day it was validated and may have changed since.
      </footer>
    </article>
  );
}
