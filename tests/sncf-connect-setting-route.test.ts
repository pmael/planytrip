import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route writes the app's own data/settings.json and looks at the real Chrome: here, a file in a temporary folder and a fake Chrome
const holder = vi.hoisted(() => ({ file: "", chromeReady: false }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/server/appSettings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/appSettings")>();
  return {
    readAppSettings: () => real.readAppSettings({ file: holder.file }),
    writeAppSettings: (change: Parameters<typeof real.writeAppSettings>[0]) => real.writeAppSettings(change, { file: holder.file }),
  };
});
vi.mock("@/server/chromeDebugging", () => ({ chromeDebuggingOn: () => holder.chromeReady }));

const { GET, PUT } = await import("@/app/api/settings/sncf-connect/route");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "trip-settings-route-"));
  holder.file = path.join(dir, "settings.json");
  holder.chromeReady = false;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (body: unknown, headers: Record<string, string> = {}) =>
  PUT(new Request("http://localhost:3000/api/settings/sncf-connect", { method: "PUT", headers: { "content-type": "application/json", host: "localhost:3000", ...headers }, body: JSON.stringify(body) }));

describe("/api/settings/sncf-connect", () => {
  it("is off until turned on, and says whether Chrome is ready", async () => {
    expect(await (await GET()).json()).toEqual({ enabled: false, chromeReady: false });
    holder.chromeReady = true;
    expect(await (await GET()).json()).toEqual({ enabled: false, chromeReady: true });
  });

  it("turns it on and off, and remembers it", async () => {
    const on = await put({ enabled: true });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ enabled: true, chromeReady: false });
    expect(await (await GET()).json()).toMatchObject({ enabled: true });

    await put({ enabled: false });
    expect(await (await GET()).json()).toMatchObject({ enabled: false });
  });

  it("refuses a body that is not a yes or no", async () => {
    expect((await put({ enabled: "yes" })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect(await (await GET()).json()).toMatchObject({ enabled: false });
  });

  it("refuses another site, which could otherwise turn it on behind the person's back", async () => {
    const response = await put({ enabled: true }, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(await (await GET()).json()).toMatchObject({ enabled: false });
    expect((await put({ enabled: true }, { origin: "http://localhost:3000" })).status).toBe(200);
  });
});
