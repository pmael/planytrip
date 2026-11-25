import { describe, expect, it, vi } from "vitest";
import { createGeocoder, GeocoderUnavailableError } from "@/geo/geocode";

// What Photon answers for "Madr", trimmed to the fields we read
const feature = (name: string, country: string, countrycode: string | undefined, type: string, lon: number, lat: number) => ({
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { name, country, countrycode, type },
});
const photonMadr = {
  features: [
    feature("Madré", "France", "FR", "city", -0.38, 48.477),
    feature("Madrid", "Spain", "ES", "city", -3.704, 40.417),
    feature("Madrid", "Spain", "ES", "state", -3.7, 40.5),
    feature("Calle de Madrid", "Spain", "ES", "street", -3.7, 40.4),
    feature("Madridejos", "Spain", "ES", "city", -3.5, 39.47),
    feature("Madrigal", "Spain", undefined, "village", -5, 40),
  ],
};

const respond = (body: unknown, init?: ResponseInit) =>
  vi.fn(async () => Response.json(body, init)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("createGeocoder", () => {
  it("suggests Madrid, with MAD as its airport, for 'Madr'", async () => {
    const geocode = createGeocoder({ fetch: respond(photonMadr), minIntervalMs: 0 });
    const places = await geocode("Madr");
    const madrid = places.find((place) => place.label === "Madrid, Spain");
    expect(madrid).toEqual({ label: "Madrid, Spain", countryCode: "ES", lat: 40.417, lon: -3.704, airports: ["MAD"] });
  });

  it("keeps only places: no street, no place without a country code", async () => {
    const geocode = createGeocoder({ fetch: respond(photonMadr), minIntervalMs: 0 });
    expect((await geocode("Madr")).map((place) => place.label)).toEqual([
      "Madré, France",
      "Madrid, Spain",
      "Madridejos, Spain",
    ]);
  });

  it("keeps one result when a town also comes back as a state", async () => {
    const geocode = createGeocoder({ fetch: respond(photonMadr), minIntervalMs: 0 });
    const labels = (await geocode("Madr")).map((place) => place.label);
    expect(labels.filter((label) => label === "Madrid, Spain")).toHaveLength(1);
  });

  it("returns at most 5 places", async () => {
    const many = { features: Array.from({ length: 10 }, (_, i) => feature(`Town ${i}`, "Spain", "ES", "town", i, 40)) };
    const geocode = createGeocoder({ fetch: respond(many), minIntervalMs: 0 });
    expect(await geocode("Town")).toHaveLength(5);
  });

  it("returns an empty list when nothing matches", async () => {
    expect(await createGeocoder({ fetch: respond({ features: [] }), minIntervalMs: 0 })("zzzz")).toEqual([]);
    expect(await createGeocoder({ fetch: respond({}), minIntervalMs: 0 })("zzzz")).toEqual([]);
  });

  it("asks Photon for English place names and identifies itself", async () => {
    const fetchMock = respond({ features: [] });
    await createGeocoder({ fetch: fetchMock, minIntervalMs: 0 })("Mont-Saxonnex");
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe("https://photon.komoot.io/api/");
    expect(url.searchParams.get("q")).toBe("Mont-Saxonnex");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("osm_tag")).toBe("place");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/trip-manager/);
  });

  describe("when the service is down", () => {
    it("throws GeocoderUnavailableError on an error status", async () => {
      const geocode = createGeocoder({ fetch: respond({}, { status: 503 }), minIntervalMs: 0 });
      await expect(geocode("Madrid")).rejects.toBeInstanceOf(GeocoderUnavailableError);
    });

    it("throws GeocoderUnavailableError when the network fails", async () => {
      const failing = vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;
      await expect(createGeocoder({ fetch: failing, minIntervalMs: 0 })("Madrid")).rejects.toBeInstanceOf(
        GeocoderUnavailableError,
      );
    });

    it("recovers for the next call", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("nope", { status: 500 }))
        .mockResolvedValueOnce(Response.json({ features: [] })) as unknown as typeof fetch;
      const geocode = createGeocoder({ fetch: fetchMock, minIntervalMs: 0 });
      await expect(geocode("a")).rejects.toThrow();
      await expect(geocode("b")).resolves.toEqual([]);
    });
  });

  it("spaces requests out, even when they are made at the same time", async () => {
    const times: number[] = [];
    const fetchMock = vi.fn(async () => {
      times.push(Date.now());
      return Response.json({ features: [] });
    }) as unknown as typeof fetch;
    const geocode = createGeocoder({ fetch: fetchMock, minIntervalMs: 60 });
    await Promise.all([geocode("a"), geocode("b"), geocode("c")]);
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(55);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(55);
  });
});
