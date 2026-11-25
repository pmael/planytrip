import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { parseFares } from "@/scrapers/transport/sncf-fares";
import { createTestDb } from "./helpers/db";
import { trainFixture } from "./helpers/trains";

// The route talks to the app's own database and to the network: here, to a test database and to a fake network
const holder = vi.hoisted(() => ({ db: undefined as unknown, deps: undefined as unknown }));
vi.mock("@/db/client", () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock("@/server/services/priceObservations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/priceObservations")>()),
  defaultImportDeps: () => holder.deps,
}));

let db: Db;
let close: () => void;
beforeEach(() => {
  ({ db, close } = createTestDb());
  holder.db = db;
  holder.deps = {
    fareTable: async () => parseFares(trainFixture("sncf-fares.csv")),
    locate: async () => ({ lat: 45, lon: 4 }),
  };
});
afterEach(() => close());

const body = (over: Record<string, unknown> = {}) => ({
  source: "sncf-connect",
  pageUrl: "https://www.sncf-connect.com/app/resultats",
  capturedAt: "2026-10-24T17:40:00.000Z",
  direction: "out",
  origin: "Toulouse",
  destination: "Lyon",
  date: "2026-12-04",
  offers: [{ departTime: "07:37", arriveTime: "11:48", departStation: "Toulouse Matabiau", arriveStation: "Lyon Part Dieu", durationMin: 251, changes: 0, trainType: "TGV INOUI", price2ndEur: 66, price1stEur: 77, seatsAtPrice: [5], rawText: "07:37 ..." }],
  ...over,
});

async function post(payload: unknown, headers: Record<string, string> = {}, raw?: string) {
  const { POST } = await import("@/app/api/price-observations/route");
  const request = new Request("http://localhost:3000/api/price-observations", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "chrome-extension://abcdefghijklmnop", host: "localhost:3000", ...headers },
    body: raw ?? JSON.stringify(payload),
  });
  const response = await POST(request);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("POST /api/price-observations (T7.9)", () => {
  it("stores what the extension sends and says how many prices were kept and matched", async () => {
    const answer = await post(body());
    expect(answer).toEqual({ status: 200, body: { saved: 1, matched: 0, duplicates: 0, skipped: 0 } });
    expect(db.select().from(schema.priceObservations).all()).toHaveLength(1);
    // The same page again is not stored twice
    expect((await post(body())).body).toMatchObject({ saved: 0, duplicates: 1 });
  });

  describe("who may ask", () => {
    it("refuses a web page: only a browser extension's origin is accepted", async () => {
      for (const origin of ["https://www.sncf-connect.com", "http://localhost:3000", "https://evil.example"]) {
        const answer = await post(body(), { origin });
        expect(answer.status).toBe(403);
        expect(answer.body.error).toMatch(/seule l'extension/);
      }
    });

    it("refuses a request with no origin at all (a script, a curl)", async () => {
      const { POST } = await import("@/app/api/price-observations/route");
      const response = await POST(new Request("http://localhost:3000/api/price-observations", { method: "POST", headers: { host: "localhost:3000" }, body: JSON.stringify(body()) }));
      expect(response.status).toBe(403);
    });

    it("refuses an address that is not this machine's, which is how a web page can be made to reach a local server", async () => {
      expect((await post(body(), { host: "attacker.example" })).status).toBe(403);
      expect((await post(body(), { host: "192.168.1.20:3000" })).status).toBe(403);
      expect((await post(body(), { host: "127.0.0.1:3000" })).status).toBe(200);
    });

    it("stores nothing for a refused request", async () => {
      await post(body(), { origin: "https://evil.example" });
      expect(db.select().from(schema.priceObservations).all()).toHaveLength(0);
    });
  });

  describe("what the page did not give, said in French (the extension shows it)", () => {
    it("asks for the date", async () => {
      const answer = await post(body({ date: undefined }));
      expect(answer.status).toBe(400);
      expect(answer.body.error).toBe("La date du trajet n'a pas été reconnue sur la page");
    });

    it("asks for the route", async () => {
      expect((await post(body({ origin: undefined }))).body.error).toBe("Le trajet n'a pas été reconnu sur la page (départ)");
      expect((await post(body({ destination: "  " }))).body.error).toBe("Le trajet n'a pas été reconnu sur la page (arrivée)");
    });

    it("asks for at least one train", async () => {
      expect((await post(body({ offers: [] }))).body.error).toBe("Aucun train n'a été reconnu sur la page");
      expect((await post(body({ offers: undefined }))).body.error).toBe("Aucun train n'a été reconnu sur la page");
    });

    it("refuses a time that is not one, a source it does not know and a capture date that is not a date", async () => {
      expect((await post(body({ offers: [{ ...body().offers[0], departTime: "7h37" }] }))).body.error).toBe("L'heure d'un train n'a pas été reconnue");
      expect((await post(body({ source: "trainline" }))).body.error).toBe("La source des prix n'est pas connue");
      expect((await post(body({ capturedAt: "yesterday" }))).body.error).toBe("La date de la capture est invalide");
    });

    it("says which fields were wrong, for whoever reads the answer", async () => {
      const answer = await post(body({ date: "soon" }));
      expect(answer.body.issues).toEqual([{ path: "date", message: "La date du trajet n'a pas été reconnue sur la page" }]);
    });

    it("refuses what is not JSON", async () => {
      const answer = await post(null, {}, "not json");
      expect(answer).toEqual({ status: 400, body: { error: "Le contenu envoyé n'est pas du JSON" } });
    });

    it("refuses a train that has already left, and keeps nothing of it", async () => {
      const answer = await post(body({ date: "2026-10-20" }));
      expect(answer.status).toBe(400);
      expect(answer.body.error).toMatch(/déjà passé/);
      expect(db.select().from(schema.priceObservations).all()).toHaveLength(0);
    });

    it("keeps no more trains than a page has", async () => {
      const offers = Array.from({ length: 201 }, () => body().offers[0]);
      expect((await post(body({ offers }))).body.error).toBe("Trop de trains dans un seul import");
    });
  });
});

describe("the sellers whose pages the extension reads (phase 4 of price-model.md)", () => {
  it.each(["sncf-connect", "eurostar", "iryo"])("takes a page read on %s, and keeps which one it was", async (source) => {
    const answer = await post(body({ source, capturedAt: "2026-10-26T12:00:00.000Z", date: "2026-10-30" }));
    expect(answer).toEqual({ status: 200, body: { saved: 1, matched: 0, duplicates: 0, skipped: 0 } });
    expect(db.select().from(schema.priceObservations).all().map((o) => o.source)).toEqual([source]);
  });

  it("takes the same train read on two sellers' pages as two sets of prices", async () => {
    await post(body({ source: "eurostar", capturedAt: "2026-10-26T12:00:00.000Z", date: "2026-10-30" }));
    expect((await post(body({ source: "iryo", capturedAt: "2026-10-26T12:00:00.000Z", date: "2026-10-30" }))).body).toMatchObject({ saved: 1, duplicates: 0 });
  });

  it("is refused for what it is, whichever seller sent it: the answer names the extension, not a seller", async () => {
    const answer = await post(body({ source: "iryo" }), { origin: "https://iryo.eu" });
    expect(answer.status).toBe(403);
    expect(answer.body.error).toBe("Requête refusée : seule l'extension Trip Manager, depuis cette machine, peut envoyer des prix");
  });
});
