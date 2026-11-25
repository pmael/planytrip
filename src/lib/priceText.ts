// How the pages write down prices seen on the seller's own page (task.md T7.9). In French, as price-model.md words them.

const SOURCES: Record<string, string> = { "sncf-connect": "SNCF Connect", eurostar: "Eurostar", iryo: "Iryo" };

/** "à l'instant", "il y a 12 min", "il y a 2 h", "il y a 3 j" */
export function agoText(capturedAt: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(capturedAt)) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `il y a ${hours} h` : `il y a ${Math.floor(hours / 24)} j`;
}

/** "vu sur SNCF Connect il y a 2 h" */
export const observedText = (source: string, capturedAt: string, now: Date = new Date()) => `vu sur ${SOURCES[source] ?? source} ${agoText(capturedAt, now)}`;
