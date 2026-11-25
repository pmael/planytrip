// How a length of time is written for someone who waits: rounded, so that it does not flicker and does not promise more
// than an estimate can.

/** "a few seconds", "40 s", "1 min 30", "6 min", "1 h 10" */
export function estimateText(seconds: number): string {
  if (seconds < 8) return "a few seconds";
  if (seconds < 55) return `${Math.max(10, Math.round(seconds / 10) * 10)} s`;
  const halves = Math.max(2, Math.round(seconds / 30));
  if (halves < 10) return `${Math.floor(halves / 2)} min${halves % 2 ? " 30" : ""}`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** How long something took: "4 s", "1 min 12 s" */
export function tookText(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 1) return "instant";
  if (whole < 60) return `${whole} s`;
  return `${Math.floor(whole / 60)} min${whole % 60 ? ` ${whole % 60} s` : ""}`;
}
