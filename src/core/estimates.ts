// How long a computation's steps will take (the progress screen): learnt from how long the same kind of work took on
// this computer, with typical figures (config.estimates) until there is enough of it. Pure.
//
// The worker runs one job at a time, so a job's own time goes from the end of the one before it (or from when it was
// queued, if the worker was free) to its end. Work that was already done for the same thing is told apart: the AI is not
// asked again for what has not changed, what is around a stay is kept a month, and that takes no time.
import { estimates as settings } from "@/config";

/** A job that is over, as the queue keeps it (ISO times) */
export type FinishedJob = { kind: string; subject: string; createdAt: string; finishedAt: string; ok: boolean; attempts: number };

/** What was learnt: how long each kind took the last times, oldest first, and what was already worked on */
export type Experience = { first: Map<string, number[]>; again: Map<string, number[]>; seen: Set<string> };

const seenKey = (kind: string, subject: string) => `${kind}|${subject}`;

/** `jobs` in the order they finished */
export function experienceOf(jobs: FinishedJob[]): Experience {
  const experience: Experience = { first: new Map(), again: new Map(), seen: new Set() };
  let before = 0;
  for (const job of jobs) {
    const end = Date.parse(job.finishedAt);
    const seconds = (end - Math.max(Date.parse(job.createdAt), before)) / 1000;
    before = end;
    if (!job.ok) continue;
    const again = experience.seen.has(seenKey(job.kind, job.subject));
    experience.seen.add(seenKey(job.kind, job.subject));
    // One that was tried again waited in between, and a worker that was stopped did too: neither is the work's time
    if (job.attempts > 1 || seconds < 0 || seconds > settings.notWorkAfterSeconds) continue;
    const times = again ? experience.again : experience.first;
    times.set(job.kind, [...(times.get(job.kind) ?? []), seconds].slice(-settings.remembered));
  }
  return experience;
}

/** The mean without the odd very long one: what the times of several jobs add up to */
function usual(times: number[]): number {
  const kept = [...times].sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(times.length * 0.9)));
  return kept.reduce((sum, time) => sum + time, 0) / kept.length;
}

/** How long a job of this kind usually takes, in seconds; `current`: how long the same ones took in this computation */
export function usualSeconds(experience: Experience, kind: string, subject: string, current: number[] = []): number {
  const again = experience.seen.has(seenKey(kind, subject));
  const times = (again ? experience.again : experience.first).get(kind) ?? [];
  const kept = again && (settings.keptKinds as readonly string[]).includes(kind);
  const typical = kept ? settings.keptSeconds : settings.typicalSeconds[kind as keyof typeof settings.typicalSeconds] ?? settings.otherSeconds;
  const learnt = times.length >= settings.enough || (again && times.length > 0) ? usual(times) : typical;
  // What this computation shows (a slow site today, a fast one) counts as much as a few past ones
  if (again || current.length === 0) return learnt;
  return (learnt * settings.pastWeight + current.reduce((sum, time) => sum + time, 0)) / (settings.pastWeight + current.length);
}

/** What is left of a job that has run for `elapsed` seconds and usually takes `usually`: never nothing, it is not over */
export function remainingSeconds(usually: number, elapsed: number): number {
  return Math.max(usually - elapsed, usually * 0.15, 1);
}

/** Much longer than it usually takes: worth saying, so that it does not look stuck */
export const isSlow = (usually: number, elapsed: number) => elapsed > Math.max(settings.slowAfterSeconds, usually * settings.slowFactor);
