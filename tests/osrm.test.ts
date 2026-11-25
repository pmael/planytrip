import { describe, expect, it, vi } from "vitest";
import { createOsrm, OsrmUnavailableError } from "@/geo/osrm";

const madrid = { lat: 40.4168, lon: -3.7038 };
const barcelona = { lat: 41.3874, lon: 2.1686 };
const reunion = { lat: -21.1309, lon: 55.5266 };

const answer = (body: unknown, init?: ResponseInit) =>
  vi.fn(async () => Response.json(body, init)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

const ok = (distance: number, duration: number, snaps = [10, 25]) => ({
  code: "Ok",
  routes: [{ distance, duration }],
  waypoints: snaps.map((d) => ({ distance: d })),
});

const route = (fetchMock: typeof fetch, extra: { baseUrl?: string } = {}) =>
  createOsrm({ fetch: fetchMock, minIntervalMs: 0, ...extra });

describe("osrmRoute", () => {
  it("gives the distance in km and the time in minutes", async () => {
    const found = await route(answer(ok(618_000, 24_660)))(madrid, barcelona);
    expect(found).toEqual({ distanceKm: 618, durationMin: 411 });
  });

  it("asks for lon,lat pairs, in order, without the geometry", async () => {
    const fetchMock = answer(ok(1, 1));
    await route(fetchMock)(madrid, barcelona);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.pathname).toBe("/route/v1/driving/-3.7038,40.4168;2.1686,41.3874");
    expect(url.searchParams.get("overview")).toBe("false");
    expect(url.searchParams.has("exclude")).toBe(false);
  });

  it("identifies itself", async () => {
    const fetchMock = answer(ok(1, 1));
    await route(fetchMock)(madrid, barcelona);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/trip-manager/);
  });

  it("can use another server", async () => {
    const fetchMock = answer(ok(1, 1));
    await route(fetchMock, { baseUrl: "http://localhost:5000/" })(madrid, barcelona);
    expect((fetchMock.mock.calls[0] as [URL])[0].origin).toBe("http://localhost:5000");
  });

  it("asks to avoid tolls when told to", async () => {
    const fetchMock = answer(ok(1, 1));
    await route(fetchMock)(madrid, barcelona, { excludeToll: true });
    expect((fetchMock.mock.calls[0] as [URL])[0].searchParams.get("exclude")).toBe("toll");
  });
});

describe("when there is no road", () => {
  it("is null when OSRM says there is no route", async () => {
    expect(await route(answer({ code: "NoRoute", message: "Impossible route" }, { status: 400 }))(madrid, reunion)).toBeNull();
  });

  it("is null when there is no road near a point", async () => {
    expect(await route(answer({ code: "NoSegment" }, { status: 400 }))(madrid, reunion)).toBeNull();
  });

  it("is null when a point had to be moved thousands of km to reach a road (an island)", async () => {
    // What the public server really does for La Réunion: it snaps the island to southern India
    const found = await route(answer(ok(12_023_955, 30_267_000, [12, 5_000_000])))(madrid, reunion);
    expect(found).toBeNull();
  });

  it("is null when the departure point is the one moved too far", async () => {
    expect(await route(answer(ok(1000, 600, [40_000, 20])))(reunion, madrid)).toBeNull();
  });

  it("accepts a point moved a few km to the nearest road (a mountain village)", async () => {
    const found = await route(answer(ok(1_376_000, 52_560, [4_800, 900])))(madrid, barcelona);
    expect(found).toEqual({ distanceKm: 1376, durationMin: 876 });
  });
});

describe("when the routing service cannot help", () => {
  it("throws OsrmUnavailableError on an error status", async () => {
    await expect(route(answer({}, { status: 503 }))(madrid, barcelona)).rejects.toBeInstanceOf(OsrmUnavailableError);
  });

  it("throws OsrmUnavailableError when the network fails", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(route(failing)(madrid, barcelona)).rejects.toBeInstanceOf(OsrmUnavailableError);
  });

  it("throws OsrmUnavailableError, saying why, when the server refuses the request (the demo rejects exclude=toll)", async () => {
    const refusing = answer({ code: "InvalidValue", message: "Exclude flag combination is not supported." }, { status: 400 });
    const error = await route(refusing)(madrid, barcelona, { excludeToll: true }).catch((e) => e);
    expect(error).toBeInstanceOf(OsrmUnavailableError);
    expect(error.message).toMatch(/InvalidValue/);
  });

  it("throws on a body that is not an answer at all", async () => {
    await expect(route(answer({ hello: "world" }))(madrid, barcelona)).rejects.toBeInstanceOf(OsrmUnavailableError);
  });

  it("recovers for the next call", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(Response.json(ok(1000, 600))) as unknown as typeof fetch;
    const osrm = route(fetchMock);
    await expect(osrm(madrid, barcelona)).rejects.toThrow();
    await expect(osrm(madrid, barcelona)).resolves.toEqual({ distanceKm: 1, durationMin: 10 });
  });
});
