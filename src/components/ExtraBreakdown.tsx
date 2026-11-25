import { ChevronDown } from "lucide-react";
import { COLOR_TEXT, TIER_LABELS } from "@/lib/colorClasses";
import { OBJECTIVE_LABELS } from "@/lib/deliberationText";
import { money, SOURCE_LABELS } from "@/lib/extraLines";
import { cn } from "@/lib/utils";
import type { ExtraLineView, ExtraSection, ExtraStanding, ExtraView } from "@/server/services/extraView";

type Ready = Extract<ExtraView, { kind: "ready" }>;

/** "≈ 153 €" for an estimate (whole euros: the cents would claim a precision it does not have), "35 €" otherwise */
export const eurText = (eur: number, estimate: boolean) => (estimate ? `≈ ${Math.round(eur)} €` : money(eur));

/** One guest's amount, or for everyone the range when guests pay different amounts */
function perGuestText(line: ExtraLineView) {
  const { minEur, maxEur } = line.perGuest;
  if (Math.abs(maxEur - minEur) < 0.005) return eurText(minEur, line.estimate);
  return line.estimate ? `≈ ${Math.round(minEur)}–${Math.round(maxEur)} €` : `${money(minEur)}–${money(maxEur)}`;
}

function Line({ line, everyone }: { line: ExtraLineView; everyone: boolean }) {
  return (
    <li className="border-t border-[#0d4a35]/10">
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1 py-4 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 sm:grid-cols-[minmax(0,1fr)_7rem_7rem] [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-xl text-[#0d4a35]">
              <ChevronDown aria-hidden className="size-5 shrink-0 stroke-[1.6] transition-transform duration-300 group-open:rotate-180" />
              {line.label}
            </span>
            <span className="mt-1 block pl-7 text-base text-black/60">
              {line.summary}
              {everyone && line.partial && <span className="text-black/45"> · {line.byGuest.map((guest) => guest.name).join(", ")}</span>}
            </span>
          </span>
          <span className="text-right text-xl whitespace-nowrap text-black">{perGuestText(line)}</span>
          {everyone && <span className="hidden text-right text-xl whitespace-nowrap text-black/70 sm:block">{eurText(line.groupEur, line.estimate)}</span>}
        </summary>
        <div className="mb-4 ml-7 rounded-[16px] bg-[#f1f7f4] px-5 py-4 text-base text-black/80">
          <p>
            <span className="text-black/50">How: </span>
            {line.formula}
          </p>
          {everyone && line.byGuest.length > 1 && line.perGuest.maxEur - line.perGuest.minEur >= 0.005 && (
            <p className="mt-1">
              <span className="text-black/50">Each: </span>
              {line.byGuest.map((guest) => `${guest.name} ${eurText(guest.eur, line.estimate)}`).join(" · ")}
            </p>
          )}
          {line.rows.length > 0 && (
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-[minmax(0,auto)_1fr]">
              {line.rows.map((row, index) => (
                <div key={`${row.label}-${index}`} className="contents">
                  <dt className="text-black/55">{row.label}</dt>
                  <dd className="flex flex-wrap items-baseline gap-x-3">
                    {row.href ? (
                      <a href={row.href} target="_blank" rel="noreferrer" className="text-[#1a5fb4] underline">
                        {row.value}
                      </a>
                    ) : (
                      <span>{row.value}</span>
                    )}
                    {row.source && <span className="rounded-full bg-white px-2.5 py-0.5 text-sm text-[#0d4a35]/75">{SOURCE_LABELS[row.source]}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </details>
    </li>
  );
}

function Section({ section, title, everyone }: { section: ExtraSection; title: string; everyone: boolean }) {
  if (section.lines.length === 0) return null;
  const estimate = section.lines.some((line) => line.estimate);
  return (
    <section aria-label={title} className="mt-6 first:mt-0">
      <h3 className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 pb-2 text-base tracking-wide text-[#0d4a35]/60 uppercase sm:grid-cols-[minmax(0,1fr)_7rem_7rem]">
        <span>{title}</span>
        <span className="text-right normal-case">{everyone ? "per guest" : "theirs"}</span>
        {everyone && <span className="hidden text-right normal-case sm:block">group</span>}
      </h3>
      <ul>
        {section.lines.map((line) => (
          <Line key={line.id} line={line} everyone={everyone} />
        ))}
      </ul>
      <p className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 border-t border-[#0d4a35]/25 pt-3 text-lg text-[#0d4a35] sm:grid-cols-[minmax(0,1fr)_7rem_7rem]">
        <span>{title.split(" · ")[0]}</span>
        <span className="text-right whitespace-nowrap">
          {eurText(section.perGuestEur, estimate)}
          {everyone && <span className="sr-only"> on average per guest</span>}
        </span>
        {everyone && <span className="hidden text-right whitespace-nowrap sm:block">{eurText(section.groupEur, estimate)}</span>}
      </p>
    </section>
  );
}

/** The Mandatory, then the Plus of the objective, then the Extra in all: line by line, each opening its detail. */
export function ExtraLines({ view }: { view: Ready }) {
  const extra = view.extra!;
  const everyone = view.guestId === null;
  const [mandatory, plus] = extra.sections;
  return (
    <div className="rounded-[22px] bg-white p-7 text-[#0d4a35]">
      <Section section={mandatory} title="Mandatory" everyone={everyone} />
      <Section section={plus} title={`Plus · ${OBJECTIVE_LABELS[view.destination.objective]}`} everyone={everyone} />
      <p className="mt-6 grid grid-cols-[1fr_auto] items-baseline gap-x-6 rounded-[16px] bg-[#0d4a35] px-5 py-4 text-2xl text-white sm:grid-cols-[minmax(0,1fr)_7rem_7rem]">
        <span>Extra</span>
        <span className="text-right whitespace-nowrap">{eurText(extra.total.perGuestEur, extra.estimate)}</span>
        {everyone && <span className="hidden text-right whitespace-nowrap sm:block">{eurText(extra.total.groupEur, extra.estimate)}</span>}
      </p>
      {everyone && <p className="mt-3 text-base text-black/50">Per guest: on average, for the totals. Open a line to see how it is worked out and where each price comes from.</p>}
      <p className="mt-2 text-base text-black/50">The Plus is a suggestion for what the trip is for: only the Mandatory can put a guest over budget.</p>
    </div>
  );
}

function StandingRow({ guest, extraCounted }: { guest: ExtraStanding; extraCounted: boolean }) {
  const color = COLOR_TEXT[guest.color];
  const parts = [
    guest.transportEur === null ? null : `transport ${money(guest.transportEur)}`,
    `housing ${money(guest.housingEur)}`,
    extraCounted ? `Mandatory ${eurText(guest.mandatoryEur, true)}` : null,
    extraCounted ? `Plus ${eurText(guest.plusEur, true)}` : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-[#0d4a35]/10 py-3 first:border-t-0">
      <span className="min-w-0">
        <span className="text-xl text-black">{guest.name}</span>
        <span className="block text-base text-black/55">{parts.join(" + ")}</span>
      </span>
      {guest.status === "unreachable" ? (
        <span className="text-xl text-[#d33a2f]">⛔ No way there{guest.costEur !== null && ` (≈ ${Math.round(guest.costEur)} € with another mode)`}</span>
      ) : (
        <span className={cn("text-right text-xl whitespace-nowrap", color)}>
          {guest.costEur === null ? "—" : eurText(guest.costEur, extraCounted)} of {money(guest.maxBudgetEur)}
          <span className="block text-base">
            {TIER_LABELS[guest.tier]}
            {guest.overBudgetEur ? ` · +${Math.round(guest.overBudgetEur)} €` : ""}
          </span>
        </span>
      )}
    </li>
  );
}

/** Each guest's whole trip with the Extra, against their budget */
export function ExtraStandingList({ view }: { view: Ready }) {
  const counted = view.extra?.counted ?? false;
  return (
    <section aria-label="The whole trip" className="rounded-[22px] bg-white p-7 text-[#0d4a35]">
      <h2 className="text-2xl font-normal">{view.guestId ? "Their whole trip" : "Each guest's whole trip"}</h2>
      {!counted && <p className="mt-1 text-base text-black/55">Transport and housing only: the budget does not count the Extra here yet.</p>}
      <ul className="mt-3">
        {view.standing.map((guest) => (
          <StandingRow key={guest.guestId} guest={guest} extraCounted={counted} />
        ))}
      </ul>
    </section>
  );
}
