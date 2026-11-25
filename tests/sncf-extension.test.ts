import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { PriceObservationsBodySchema } from "@/server/schemas";

const folder = path.join(process.cwd(), "extension/sncf-import");
const read = (file: string) => readFileSync(path.join(folder, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));

/** Each site the extension reads: the pages it runs on, and the files it loads there (its parser, then how its page is read, then the shared button) */
const SITES = [
  { name: "SNCF Connect", matches: ["https://www.sncf-connect.com/*"], js: ["sncf-parser.js", "site-sncf.js", "content.js"], source: "sncf-connect" },
  { name: "Eurostar", matches: ["https://www.eurostar.com/search/*"], js: ["eurostar-parser.js", "site-eurostar.js", "content.js"], source: "eurostar" },
  { name: "Iryo", matches: ["https://iryo.eu/*/booking/*"], js: ["iryo-parser.js", "site-iryo.js", "content.js"], source: "iryo" },
];
const scripts = [...new Set(SITES.flatMap((site) => site.js))];

describe("the extension's manifest (T7.9, price-model.md phase 4)", () => {
  it("runs on the results pages of SNCF Connect, Eurostar and Iryo only, and may call nothing but the local app", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.content_scripts.map((group: { matches: string[] }) => group.matches)).toEqual(SITES.map((site) => site.matches));
    expect(manifest.host_permissions).toEqual(["http://localhost:3000/*"]);
    // No tabs, no cookies, no scripting, no storage: it reads the page it is on when asked, and that is all
    expect(manifest.permissions).toBeUndefined();
  });

  it("loads on each site the files that exist, the parser before the page's reader before the button", () => {
    expect(manifest.content_scripts.map((group: { js: string[] }) => group.js)).toEqual(SITES.map((site) => site.js));
    for (const file of [...scripts, manifest.background.service_worker]) expect(existsSync(path.join(folder, file))).toBe(true);
  });

  it("only reads a page once it has loaded", () => {
    for (const group of manifest.content_scripts) expect(group.run_at).toBe("document_idle");
  });
});

describe("what the content scripts do not do", () => {
  const content = read("content.js");

  it("make no request, open no page, navigate nowhere and click nothing on the page", () => {
    for (const file of scripts) {
      const source = read(file);
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
      expect(source, file).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket/);
      expect(source, file).not.toMatch(/window\.open|location\.(href|assign|replace)\s*[=(]/);
      expect(source, file).not.toMatch(/\.click\s*\(|dispatchEvent/);
    }
  });

  it("do not read their own preview as results: it lists lines such as '07:37 → 11:48 · … · 66 €', which look exactly like cards", () => {
    // Every site: the previous preview is removed before the page is read
    expect(content).toMatch(/getElementById\('tm-preview'\)\?\.remove\(\)/);
    // SNCF Connect's reader finds rows by what they look like when it cannot find them by their markers
    expect(read("site-sncf.js")).toMatch(/closest\('#tm-preview, #tm-button'\)/);
  });

  it("only send a message to the extension's own background, when asked", () => {
    expect(content.match(/chrome\.runtime\.sendMessage/g)).toHaveLength(1);
    expect(content).toMatch(/send\.onclick/);
    for (const file of scripts.filter((f) => f !== "content.js")) expect(read(file), file).not.toMatch(/chrome\./);
  });

  it("say which seller a page is from, in the words the app takes", () => {
    for (const site of SITES) {
      const reader = site.js[1];
      expect(read(reader), reader).toContain(`source: '${site.source}'`);
      expect(PriceObservationsBodySchema.shape.source.safeParse(site.source).success, site.source).toBe(true);
    }
  });

  it("do nothing on a page that no site file claimed", () => {
    expect(content).toMatch(/const site = globalThis\.TripManagerSite;\s*if \(!site\) return;/);
  });
});

describe("the background worker", () => {
  type Listener = (message: unknown, sender: { id?: string }, respond: (answer: unknown) => void) => boolean | undefined;

  function load(fetchImpl: typeof fetch) {
    let listener: Listener | undefined;
    const chrome = { runtime: { id: "my-extension-id", onMessage: { addListener: (l: Listener) => (listener = l) } } };
    vm.runInNewContext(read("background.js"), { chrome, fetch: fetchImpl, String });
    return listener!;
  }
  const answer = (listener: Listener, message: unknown, sender = { id: "my-extension-id" }) =>
    new Promise<unknown>((resolve) => {
      const handled = listener(message, sender, resolve);
      if (handled !== true) resolve("not handled");
    });
  const payload = { source: "sncf-connect", offers: [] };

  it("posts the payload to the local app, as JSON, and gives back the status and the body", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ saved: 4, matched: 2 }));
    const response = await answer(load(fetchImpl as never), { type: "trip-manager:import", payload });

    expect(response).toEqual({ ok: true, status: 200, body: { saved: 4, matched: 2 } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/price-observations");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  });

  it("passes on a refusal with the app's words", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "Aucun train reconnu" }, { status: 400 }));
    expect(await answer(load(fetchImpl as never), { type: "trip-manager:import", payload })).toEqual({ ok: false, status: 400, body: { error: "Aucun train reconnu" } });
  });

  it("copes with an answer that is not JSON, and with an app that is not running", async () => {
    const html = vi.fn(async () => new Response("<html>", { status: 502 }));
    expect(await answer(load(html as never), { type: "trip-manager:import", payload })).toEqual({ ok: false, status: 502, body: null });

    const down = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await answer(load(down as never), { type: "trip-manager:import", payload })).toEqual({ ok: false, error: "Failed to fetch" });
  });

  it("ignores any other message, and any sender that is not this extension", async () => {
    const fetchImpl = vi.fn(async () => Response.json({}));
    const listener = load(fetchImpl as never);
    expect(await answer(listener, { type: "something-else", payload })).toBe("not handled");
    expect(await answer(listener, { type: "trip-manager:import", payload }, { id: "another-extension" })).toBe("not handled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
