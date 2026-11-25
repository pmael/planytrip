"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { computeFraction } from "@/lib/computeProgress";
import type { ComputeProgress } from "@/server/services/compute";
import { cn } from "@/lib/utils";
import { tripPath } from "@/lib/trip";
import { ProgressBar } from "./ProgressBar";
import { PlaneLoader } from "./PlaneLoader";
import { ProgressNotices, ProgressSteps, TimeLeft } from "./ProgressSteps";

/** The check mark and the particles stay this long before the dashboard opens */
const DONE_MS = 2600;
/** Longer when there is a notice to read, such as "not rated by the AI" (the dashboard says it again) */
const NOTICE_MS = 6000;
const LEAVE_MS = 700;
/** The spinner is shown at least this long, so that a computation that was already done does not flash by */
const MIN_LOAD_MS = 1800;
/** Where the bar was when this step began, and how much of the way to the end it covers */
const BAR_FROM = 0.75;
const POLL_MS = 800;

type Phase = "loading" | "done" | "leaving" | "failed";

/** What went wrong, and where to go to fix it. */
type Problem = { message: string; fix: { label: string; href: string } | null };

const FIXES: Record<string, { label: string; href: string }> = {
  no_guests: { label: "Back to the guests", href: "guests" },
  no_common_dates: { label: "Back to the guests", href: "guests" },
  no_destinations: { label: "Back to the destinations", href: "destinations" },
};

const PARTICLES = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2;
  const distance = i % 2 ? 190 : 250;
  return { dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance };
});

export function ComputingScreen() {
  const router = useRouter();
  const { tripId } = useParams<{ tripId: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState<ComputeProgress | null>(null);
  // How far along it is. It only goes up: the bar never steps back when the searches are planned
  const [fraction, setFraction] = useState(0);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [attempt, setAttempt] = useState(0);
  const dashboard = tripPath(tripId);

  // Start the computation, then follow it until the trip is ready (or it gives up)
  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fail = (message: string, fix: Problem["fix"] = null) => {
      if (cancelled) return;
      setProblem({ message, fix });
      setPhase("failed");
    };

    async function follow() {
      try {
        const response = await fetch(`/api/trips/${tripId}/progress`);
        if (!response.ok) throw new Error(`Progress answered ${response.status}`);
        const current: ComputeProgress = await response.json();
        if (cancelled) return;
        setProgress(current);
        setFraction((before) => Math.max(before, computeFraction(current)));

        if (current.status === "ready") {
          // Give the spinner its moment even when everything was already there
          timer = setTimeout(() => !cancelled && setPhase("done"), Math.max(0, MIN_LOAD_MS - (Date.now() - started)));
        } else if (current.status === "draft") {
          fail(current.error ?? "Something went wrong while working out your trip.");
        } else {
          timer = setTimeout(follow, POLL_MS);
        }
      } catch {
        fail("Couldn't reach the server, please try again.");
      }
    }

    (async () => {
      try {
        const response = await fetch(`/api/trips/${tripId}/compute`, { method: "POST" });
        if (response.status === 409) {
          const body: { reason?: string; message?: string } = await response.json();
          return fail(body.message ?? "There is nothing to compute yet.", FIXES[body.reason ?? ""] ?? null);
        }
        if (!response.ok) throw new Error(`Compute answered ${response.status}`);
        await follow();
      } catch {
        fail("Couldn't start working out your trip, please try again.");
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tripId, attempt]);

  // Once it is done: let the celebration play, then open the dashboard. Keyed on "finished", not on
  // the phase, because this effect moves the phase on: its timers must survive that change.
  const finished = phase === "done" || phase === "leaving";
  const hasNotices = (progress?.notices.length ?? 0) > 0;
  useEffect(() => {
    if (!finished) return;
    router.prefetch(dashboard);
    const stay = hasNotices ? NOTICE_MS : DONE_MS;
    const timers = [setTimeout(() => setPhase("leaving"), stay), setTimeout(() => router.push(dashboard), stay + LEAVE_MS)];
    return () => timers.forEach(clearTimeout);
  }, [finished, hasNotices, router, dashboard]);

  // What the screen says while it works: the step being worked on
  const failedSteps = progress?.steps.filter((step) => step.state === "failed") ?? [];
  const caption = finished
    ? failedSteps.length > 0
      ? `All set, though "${failedSteps.map((step) => step.label.toLowerCase()).join('", "')}" didn't work. Opening your dashboard…`
      : "All set, opening your dashboard…"
    : "Getting started…";

  const failed = phase === "failed";

  return (
    <main className="flex flex-1 flex-col px-[5%] pb-[8vh] pt-[18vh]">
      <div
        className={cn(
          "flex flex-col items-center",
          phase === "leaving" && "animate-[screen-out_0.7s_ease-in_both]",
        )}
      >
        <h1 className="text-center text-4xl font-normal text-white sm:text-5xl">Great we are computing</h1>

        <div className="relative mt-10 size-[310px]">
          {finished && (
            <>
              {[0, 0.28].map((delay) => (
                <span
                  key={delay}
                  aria-hidden
                  className="absolute inset-0 animate-[ripple_1.3s_ease-out_both] rounded-full border-2 border-emerald-300/70"
                  style={{ animationDelay: `${delay}s` }}
                />
              ))}
              {PARTICLES.map((particle, i) => (
                <span
                  key={i}
                  aria-hidden
                  className={cn(
                    "absolute top-1/2 left-1/2 -mt-1.5 -ml-1.5 size-3 animate-[particle_1s_ease-out_both] rounded-full",
                    i % 3 === 0 ? "bg-white" : "bg-[#2ec48f]",
                  )}
                  style={
                    {
                      "--dx": `${particle.dx}px`,
                      "--dy": `${particle.dy}px`,
                      animationDelay: "0.2s",
                    } as CSSProperties
                  }
                />
              ))}
            </>
          )}

          <div
            role="status"
            aria-label={finished ? "Computation finished" : failed ? "Computation failed" : "Computing"}
            className={cn(
              "relative flex size-full items-center justify-center rounded-full border transition-[background-color,border-color,box-shadow] duration-700",
              // The plane flies straight on the page; the circle is only there for the check mark or the failure
              finished || failed ? "border-white/20 shadow-[0_0_40px_rgb(46_196_143/0.25)]" : "border-transparent",
              finished ? "animate-[pop_0.7s_ease-out_both] bg-[#5c7d70]" : failed && "bg-[#7d5256]",
            )}
          >
            <span
              className={cn(
                "absolute flex w-[min(380px,88vw)] items-center justify-center transition-[opacity,scale] duration-500",
                (finished || failed) && "scale-75 opacity-0",
              )}
            >
              <PlaneLoader width={380} tone="glow" name decorative />
            </span>

            {failed && <TriangleAlert aria-hidden className="absolute size-[40%] animate-[pop_0.5s_ease-out_both] text-white" strokeWidth={1.4} />}

            {finished && (
              <svg viewBox="0 0 100 100" className="absolute size-[40%] text-white" aria-hidden>
                <path
                  d="M24 53 L43 72 L77 31"
                  pathLength={1}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={1}
                  className="animate-[check-draw_0.55s_ease-out_0.25s_both]"
                />
              </svg>
            )}
          </div>
        </div>

        {failed ? (
          <div role="alert" className="mt-8 flex animate-[fade-up_0.5s_ease-out_both] flex-col items-center gap-6 text-center">
            <p className="max-w-[640px] text-xl text-rose-100">{problem?.message}</p>
            <div className="flex gap-4">
              {problem?.fix && (
                <Link
                  href={`/trips/${tripId}/setup/${problem.fix.href}`}
                  className="rounded-full border border-white/25 bg-white/15 px-8 py-3 text-lg text-white transition-colors hover:bg-white/25"
                >
                  {problem.fix.label}
                </Link>
              )}
              <button
                type="button"
                onClick={() => {
                  setProblem(null);
                  setProgress(null);
                  setFraction(0);
                  setPhase("loading");
                  setAttempt((n) => n + 1);
                }}
                className="cursor-pointer rounded-full border border-emerald-200/40 bg-[#6f9f72] px-8 py-3 text-lg text-white transition-colors hover:bg-[#7db380]"
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-8 flex min-h-[200px] w-full flex-col items-center gap-5">
            {progress && progress.steps.length > 0 && !finished ? <TimeLeft seconds={progress.secondsLeft} /> : null}
            {progress && progress.steps.length > 0 ? <ProgressSteps steps={progress.steps} /> : null}
            {progress && <ProgressNotices notices={progress.notices} />}
            {(finished || !progress || progress.steps.length === 0) && (
              <p key={finished ? "done" : "start"} className="animate-[fade-up_0.5s_ease-out_both] text-center text-xl text-white/65">
                {caption}
              </p>
            )}
          </div>
        )}
      </div>

      {/* The padding keeps it clear of the content when that is taller than the screen (notices) */}
      <div className="mt-auto pt-10">
        <ProgressBar live value={finished ? 1 : BAR_FROM + (1 - BAR_FROM) * fraction} done={finished} />
      </div>
    </main>
  );
}
