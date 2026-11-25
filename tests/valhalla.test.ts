import { describe, expect, it, vi } from "vitest";
import { createValhalla, RouteTooLongError, ValhallaUnavailableError } from "@/geo/valhalla";

const madrid = { lat: 40.4168, lon: -3.7038 };
const annecy = { lat: 46.0517, lon: 6.4533 };

const answer = (body: unknown, init?: ResponseInit) =>
  vi.fn(async () => Response.json(body, init)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

const trip = (length: number, time: number, hasToll: boolean, maneuvers: { length: number; toll?: boolean }[]) => ({
  trip: { summary: { length, time, has_toll: hasToll }, legs: [{ maneuvers }] },
});

const route = (fetchMock: typeof fetch, extra: { baseUrl?: string } = {}) =>
  createValhalla({ fetch: fetchMock, minIntervalMs: 0, ...extra });

describe("valhallaRoute", () => {
  it("gives the distance, the time and the km driven on toll roads", async () => {
    const body = trip(1381, 48_360, true, [
      { length: 12 },
      { length: 400, toll: true },
      { length: 300 },
      { length: 239, toll: true },
      { length: 430, toll: false },
    ]);
    expect(await route(answer(body))(madrid, annecy)).toEqual({
      distanceKm: 1381, durationMin: 806, tollKm: 639, hasToll: true,
    });
  });

  it("has no toll km for a free road", async () => {
    expect(await route(answer(trip(620, 21_840, false, [{ length: 620 }])))(madrid, annecy)).toMatchObject({
      tollKm: 0, hasToll: false, distanceKm: 620, durationMin: 364,
    });
  });

  it("posts the two points in kilometres, asking not to mind tolls", async () => {
    const fetchMock = answer(trip(1, 60, false, []));
    await route(fetchMock)(madrid, annecy);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://valhalla1.openstreetmap.de/route");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      locations: [{ lat: 40.4168, lon: -3.7038 }, { lat: 46.0517, lon: 6.4533 }],
      costing: "auto",
      costing_options: { auto: { use_tolls: 1 } },
      directions_options: { units: "kilometers" },
    });
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/trip-manager/);
  });

  it("asks to avoid tolls when told to", async () => {
    const fetchMock = answer(trip(1, 60, false, []));
    await route(fetchMock)(madrid, annecy, { avoidTolls: true });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).costing_options.auto.use_tolls).toBe(0);
  });

  it("can use another server", async () => {
    const fetchMock = answer(trip(1, 60, false, []));
    await route(fetchMock, { baseUrl: "http://localhost:8002/" })(madrid, annecy);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("http://localhost:8002/route");
  });
});

describe("when there is no road", () => {
  it("is null when no path joins the two points (442)", async () => {
    const body = { error_code: 442, error: "No path could be found for input" };
    expect(await route(answer(body, { status: 400 }))(madrid, annecy)).toBeNull();
  });

  it("is null when there is no road near a point (171)", async () => {
    const body = { error_code: 171, error: "No suitable edges near location" };
    expect(await route(answer(body, { status: 400 }))(madrid, annecy)).toBeNull();
  });
});

describe("when the routing service cannot help", () => {
  it("throws RouteTooLongError, a kind of unavailable, for a drive over the server's limit (154)", async () => {
    const body = { error_code: 154, error: "Path distance exceeds the max distance limit: 1500000 meters" };
    const error = await route(answer(body, { status: 400 }))(madrid, annecy).catch((e) => e);
    expect(error).toBeInstanceOf(RouteTooLongError);
    expect(error).toBeInstanceOf(ValhallaUnavailableError);
  });

  it("throws ValhallaUnavailableError on an error status", async () => {
    await expect(route(answer({}, { status: 503 }))(madrid, annecy)).rejects.toBeInstanceOf(ValhallaUnavailableError);
  });

  it("throws ValhallaUnavailableError when the network fails", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(route(failing)(madrid, annecy)).rejects.toBeInstanceOf(ValhallaUnavailableError);
  });

  it("throws, saying why, on an error code it does not know", async () => {
    const error = await route(answer({ error_code: 999, error: "Strange" }, { status: 400 }))(madrid, annecy).catch((e) => e);
    expect(error).toBeInstanceOf(ValhallaUnavailableError);
    expect(error).not.toBeInstanceOf(RouteTooLongError);
    expect(error.message).toMatch(/999 Strange/);
  });

  it("throws on an answer that is not a route", async () => {
    await expect(route(answer({ hello: "world" }))(madrid, annecy)).rejects.toBeInstanceOf(ValhallaUnavailableError);
  });
});
