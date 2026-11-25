"use client";

import { Check, CircleAlert, CircleCheck, Sparkles, TrainFront } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import type { ClaudeStatus } from "@/ai/claude";
import { tripPath } from "@/lib/trip";
import { cn } from "@/lib/utils";
import type { SettingsView } from "@/server/services/settings";
import { inputClass } from "./GuestEditDialog";
import { PageTitle } from "./PageTitle";
import { RecomputeButton } from "./RecomputeButton";
import { Section } from "./Section";
import { TogglePill } from "./TogglePill";

/** "just now", "3 min ago", "2 h ago", "4 d ago" */
function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

const pillButton =
  "flex h-[54px] cursor-pointer items-center gap-2.5 rounded-full border border-white/25 bg-white/[0.14] px-6 text-xl text-white outline-none transition-[background-color,transform] hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-emerald-300/60 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-5 [&_svg]:stroke-[1.6]";

/** The trip's name and how many nights it lasts. */
function TripSection({ view, onChangedLength }: { view: SettingsView; onChangedLength: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState(view.name);
  const [whole, setWhole] = useState(view.nights === null);
  const [nights, setNights] = useState(String(view.nights ?? view.windowNights ?? 7));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const longest = view.windowNights ?? 1;
  const wanted = whole ? null : Number(nights);
  const dirty = name.trim() !== view.name || wanted !== view.nights;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return setError("The trip needs a name");
    if (wanted !== null && (!Number.isInteger(wanted) || wanted < 1 || wanted > longest)) return setError(`Choose between 1 and ${longest} nights`);

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/trips/${view.tripId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), nights: wanted }),
      });
      if (!response.ok) throw new Error(`Trip answered ${response.status}`);
      if (wanted !== view.nights) onChangedLength();
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setError("Couldn’t save, please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-6" onChange={() => setSaved(false)}>
      <label className="flex flex-col gap-2">
        <span className="px-3 text-lg text-white/70">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="off" />
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className="px-3 text-lg text-white/70">How long you stay</legend>
        <label className="flex cursor-pointer items-center gap-4 px-3 text-xl">
          <input type="radio" name="length" checked={whole} onChange={() => setWhole(true)} className="size-5 accent-[#2ec48f]" />
          The whole time everyone is free{view.windowNights !== null && ` (${view.windowNights} nights)`}
        </label>
        <label className="flex cursor-pointer flex-wrap items-center gap-4 px-3 text-xl">
          <input type="radio" name="length" checked={!whole} onChange={() => setWhole(false)} disabled={view.windowNights === null} className="size-5 accent-[#2ec48f]" />
          Shorter:
          <input
            type="number"
            min={1}
            max={longest}
            value={nights}
            onChange={(e) => setNights(e.target.value)}
            onFocus={() => setWhole(false)}
            aria-label="Number of nights"
            className={cn(inputClass, "h-[50px] w-[110px] px-4 text-center")}
          />
          nights, from the first day
        </label>
      </fieldset>

      {error && (
        <p role="alert" className="text-lg text-rose-200">
          {error}
        </p>
      )}
      <div className="flex items-center gap-4">
        <button type="submit" disabled={!dirty || saving} className={pillButton}>
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && (
          <span role="status" className="flex animate-[fade-up_0.4s_ease-out_both] items-center gap-2 text-lg text-emerald-200">
            <Check aria-hidden className="size-5" />
            Saved
          </span>
        )}
      </div>
    </form>
  );
}

/** Whether Claude can be used from here, without calling it. */
function AiSection() {
  const [status, setStatus] = useState<(ClaudeStatus & { mode?: "local" | "docker" }) | "error" | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    fetch("/api/ai/status")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("status"))))
      .then((next: ClaudeStatus & { mode?: "local" | "docker" }) => live && setStatus(next))
      .catch(() => live && setStatus("error"));
    return () => {
      live = false;
    };
  }, [round]);

  const ready = typeof status === "object" && status !== null && status.installed && status.loggedIn === true;
  const inDocker = typeof status === "object" && status !== null && status.mode === "docker";
  const message =
    status === null
      ? "Checking…"
      : status === "error"
        ? "Couldn’t check: is the app still running?"
        : !status.installed
          ? inDocker
            ? "Claude can’t run in Docker yet: Docker, its image or the token is missing."
            : "Claude Code isn’t installed here."
          : status.loggedIn === false
            ? inDocker
              ? "Claude runs in Docker but isn’t signed in."
              : "Claude Code is installed but not logged in."
            : status.loggedIn === null
              ? "Claude Code is installed; couldn’t tell whether it is logged in."
              : `Ready${inDocker ? " (in Docker)" : ""} · Claude Code ${status.version ?? ""}${status.account ? ` · signed in with ${status.account}` : ""}`;
  const hint =
    typeof status === "object" && status !== null && (!status.installed || status.loggedIn === false)
      ? inDocker
        ? "Start Docker Desktop and run `npm run claude:image`, then run `claude setup-token` and put CLAUDE_CODE_OAUTH_TOKEN=… in .env.local."
        : status.installed
          ? "Run `claude` once in a terminal and log in."
          : "Install it with `npm i -g @anthropic-ai/claude-code`, then run `claude` once to log in."
      : null;

  return (
    <div className="flex flex-col gap-5">
      <p className={cn("flex items-start gap-3 text-xl", ready ? "text-emerald-100" : "text-white/85")}>
        {status === null ? (
          <Sparkles aria-hidden className="mt-0.5 size-6 shrink-0 animate-pulse stroke-[1.5]" />
        ) : ready ? (
          <CircleCheck aria-hidden className="mt-0.5 size-6 shrink-0 stroke-[1.5] text-[#2ec48f]" />
        ) : (
          <CircleAlert aria-hidden className="mt-0.5 size-6 shrink-0 stroke-[1.5] text-amber-200" />
        )}
        <span>
          {message}
          {hint && <span className="mt-1 block text-lg text-white/65">{hint}</span>}
        </span>
      </p>
      <p className="text-lg text-white/60">
        The AI only runs when you turn it on in Destinations. It uses your Claude subscription, no API key, and the rest of the app works without it.
      </p>
      <div>
        <button
          type="button"
          onClick={() => {
            setStatus(null);
            setRound((n) => n + 1);
          }}
          className={pillButton}
        >
          Check again
        </button>
      </div>
    </div>
  );
}

type SncfConnectState = { enabled: boolean; chromeReady: boolean };

/** The switch that reads SNCF Connect's own prices through the person's Chrome (off by default), and whether Chrome is ready for it. */
function SncfConnectSwitch() {
  const [state, setState] = useState<SncfConnectState | "error" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/settings/sncf-connect")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("status"))))
      .then((next: SncfConnectState) => live && setState(next))
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, []);

  async function change(enabled: boolean) {
    if (saving || state === null || state === "error") return;
    setSaving(true);
    try {
      const response = await fetch("/api/settings/sncf-connect", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error(`Settings answered ${response.status}`);
      setState((await response.json()) as SncfConnectState);
    } catch {
      setState("error");
    } finally {
      setSaving(false);
    }
  }

  const on = typeof state === "object" && state !== null && state.enabled;
  const warn = typeof state === "object" && state !== null && state.enabled && !state.chromeReady;
  const message =
    state === null
      ? "Checking…"
      : state === "error"
        ? "Couldn’t read or save this setting: is the app still running?"
        : !state.enabled
          ? "Off: French trains keep the estimate from SNCF’s published fares."
          : state.chromeReady
            ? "On, and Chrome is ready: from the next search, SNCF trains get the price SNCF Connect shows."
            : "On, but Chrome’s remote debugging is off: the published fares are used until it is on.";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <TogglePill checked={on} onChange={change} busy={saving} icon={<TrainFront aria-hidden />} label="SNCF Connect prices" />
      </div>
      <p role="status" className={cn("flex items-start gap-3 text-lg", warn ? "text-amber-100" : on ? "text-emerald-100" : "text-white/80")}>
        {warn ? <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-200" /> : on ? <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-[#2ec48f]" /> : null}
        {message}
      </p>
      <p className="text-base text-white/60">
        It reads SNCF Connect through the Chrome already open on this Mac, so it only works while the app runs here, not in Docker or on a server. Fares already found stay as they are: recompute to use it.
      </p>
    </div>
  );
}

/**
 * The trip's settings: its name and length, when its fares were last worked out (and a way to work
 * them out again), whether the AI can be used, and the way back into the setup steps.
 */
export function SettingsPage({ view }: { view: SettingsView }) {
  const [lengthChanged, setLengthChanged] = useState(false);
  const { counts } = view;

  return (
    <div className="mx-auto flex max-w-[1580px] flex-col gap-10">
      <div className="lg:w-[82%]">
        <PageTitle>Settings</PageTitle>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-2">
        <Section index={0} title="Your trip" hint="Its name, and how long you would stay.">
          <TripSection view={view} onChangedLength={() => setLengthChanged(true)} />
        </Section>

        <Section index={1} title="Fares and stays" hint="Worked out once and kept: they don't change by themselves.">
          <dl className="grid grid-cols-2 gap-4 text-xl sm:grid-cols-4">
            {(
              [
                ["Guests", counts.guests],
                ["Destinations", counts.destinations],
                ["Fares found", counts.transportOptions],
                ["Stays found", counts.stays],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-[20px] bg-white/[0.08] p-4 text-center">
                <dd className="text-3xl">{value}</dd>
                <dt className="mt-1 text-base text-white/60">{label}</dt>
              </div>
            ))}
          </dl>
          <p className="text-xl text-white/85">
            {view.lastWorkedOutAt ? `Last worked out ${timeAgo(view.lastWorkedOutAt)}.` : "Not worked out yet."}
            {view.status === "computing" && " It is being worked out now."}
          </p>
          {lengthChanged && (
            <p role="status" className="rounded-[18px] bg-amber-300/15 px-5 py-3 text-lg text-amber-50">
              The trip length changed: the stays were searched for the old dates. Recompute to take it into account.
            </p>
          )}
          <p className="text-lg text-white/60">
            Recompute after changing dates, the ways of travelling, the guests or the destinations. It searches everything again and takes a few seconds.
          </p>
          <RecomputeButton tripId={view.tripId}>Recompute everything</RecomputeButton>
        </Section>

        <Section index={2} title="The AI" hint="Claude, through the `claude` command on this Mac.">
          <AiSection />
        </Section>

        <Section index={3} title="Setup" hint="Change who is going, where, and how. Then recompute.">
          <div className="flex flex-wrap gap-3">
            {[
              ["Guests", "/setup/guests"],
              ["Destinations", "/setup/destinations"],
              ["Ways of travelling", "/setup/transports"],
            ].map(([label, path]) => (
              <Link key={path} href={tripPath(view.tripId, path)} className={pillButton}>
                {label}
              </Link>
            ))}
            <Link href="/" className={cn(pillButton, "border-white/15 bg-transparent text-white/75")}>
              Start a new trip
            </Link>
          </div>
        </Section>

        <Section index={4} title="Where trains come from" hint="Timetables are real; a price is real only when its source says so.">
          <p className="text-lg text-white/75">
            Train timetables across Europe come from{" "}
            <a href="https://transitous.org/sources/" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-white">
              Transitous
            </a>
            , built on the operators’ own open data. Fares are RegioJet’s and Trenitalia’s own where they sell the train. For French high-speed trains the card shows an estimate from SNCF’s{" "}
            <a href="https://www.data.gouv.fr/datasets/tarifs-tgv-inoui-et-ouigo" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-white">
              published fare ranges
            </a>
            , and for any other train one worked out from the distance: both are marked “Estimated”. Turned on below, SNCF trains get the real price SNCF Connect shows instead.
          </p>
          <SncfConnectSwitch />
          <div className="flex flex-wrap gap-3">
            <Link href={tripPath(view.tripId, "/settings/price-accuracy")} className={pillButton}>
              Fiabilité des prix
            </Link>
          </div>
          <p className="text-lg text-white/75">
            What is around each place to stay (supermarkets, bars, sights, hiking paths, natural parks) comes from{" "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-white">
              © OpenStreetMap contributors
            </a>
            , asked through the Overpass API once a month per place. Local prices are the AI’s; without it they are each country’s average, from{" "}
            <a href="https://ec.europa.eu/eurostat/web/purchasing-power-parities" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-white">
              Eurostat’s price levels
            </a>
            . Fuel, for car trips and a Nature trip’s cars, is each EU country’s pump price in the European Commission’s{" "}
            <a href="https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-white">
              Weekly Oil Bulletin
            </a>
            , read once a week; a Nature trip’s rental car is DiscoverCars’ published average at the airport, read once a month.
          </p>
        </Section>
      </div>
    </div>
  );
}
