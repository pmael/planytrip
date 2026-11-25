import { describe, expect, it, vi } from "vitest";
import { trains } from "@/config";
import { ScrapeBlockedError, ScrapeChangedError, ScrapeError, ScrapeUnavailableError } from "@/scrapers/errors";
import { createHttp, userAgentFor } from "@/scrapers/http";
import { createTransitous } from "@/scrapers/transport/transitous";
import { localIso, parsePlan } from "@/scrapers/transport/transitous-parse";
import { trainJson } from "./helpers/trains";

describe("parsePlan (T7.8: what Transitous answers, captured on 2026-10-24 for 4 December)", () => {
  it("keeps the trains of an itinerary and drops the walk to and from the station", () => {
    const [direct] = parsePlan(trainJson("transitous-toulouse-lyon.json"));
    expect(direct.legs).toHaveLength(1);
    expect(direct.legs[0]).toMatchObject({
      train: "TGV INOUI 6871",
      operator: "SNCF VOYAGEURS",
      mode: "HIGHSPEED_RAIL",
      from: { name: "Toulouse Matabiau" },
      to: { name: "Lyon Part Dieu" },
    });
  });

  it("writes the times as the station's clock shows them: 06:37 UTC is 07:37 in Toulouse (and the SNCF Connect page said 07:37)", () => {
    const [direct] = parsePlan(trainJson("transitous-toulouse-lyon.json"));
    expect(direct).toMatchObject({ departAt: "2026-12-04T07:37", arriveAt: "2026-12-04T11:48", durationMin: 251 });
  });

  it("keeps every train of a journey with a change, in order", () => {
    const [viaMontpellier] = parsePlan(trainJson("transitous-paris-toulouse.json"));
    expect(viaMontpellier.legs.map((leg) => leg.train)).toEqual(["TGV INOUI 12331", "IC 4758"]);
    expect(viaMontpellier.legs.map((leg) => leg.mode)).toEqual(["HIGHSPEED_RAIL", "LONG_DISTANCE"]);
    expect(viaMontpellier).toMatchObject({ departAt: "2026-12-04T06:42", arriveAt: "2026-12-04T13:13", durationMin: 391 });
  });

  it("reads the other countries the same way", () => {
    const [first] = parsePlan(trainJson("transitous-milano-roma.json"));
    expect(first.legs[0]).toMatchObject({ operator: "TRENITALIA", from: { name: "MILANO CENTRALE" }, to: { name: "ROMA TERMINI" } });
    expect(first).toMatchObject({ departAt: "2026-12-04T06:35", arriveAt: "2026-12-04T09:34" });
  });

  it("counts a train that comes up twice once", () => {
    const answer = trainJson("transitous-toulouse-lyon.json");
    answer.itineraries.push(answer.itineraries[0]);
    expect(parsePlan(answer)).toHaveLength(2);
  });

  it("gives an empty list when there is no train, and an error when the answer is not an answer", () => {
    expect(parsePlan({ itineraries: [] })).toEqual([]);
    expect(parsePlan({ itineraries: [{ legs: [] }] })).toEqual([]);
    expect(() => parsePlan({ error: "nope" })).toThrow(ScrapeChangedError);
    expect(() => parsePlan("<html>")).toThrow(ScrapeChangedError);
  });
});

describe("localIso", () => {
  it("follows daylight saving time", () => {
    expect(localIso("2026-12-04T06:37:00Z", "Europe/Paris")).toBe("2026-12-04T07:37");
    expect(localIso("2026-07-04T06:37:00Z", "Europe/Paris")).toBe("2026-07-04T08:37");
    expect(localIso("2026-12-04T23:30:00Z", "Europe/Paris")).toBe("2026-12-05T00:30");
  });

  it("keeps midnight as 00 and not 24", () => {
    expect(localIso("2026-12-04T23:05:00Z", "Europe/Paris")).toBe("2026-12-05T00:05");
  });

  it("falls back to UTC for a time zone it does not know, and refuses a time that is not one", () => {
    expect(localIso("2026-12-04T06:37:00Z", undefined)).toBe("2026-12-04T06:37");
    expect(localIso("2026-12-04T06:37:00Z", "Nowhere/Land")).toBe("2026-12-04T06:37");
    expect(() => localIso("soon", "Europe/Paris")).toThrow(ScrapeChangedError);
  });
});

describe("createTransitous", () => {
  const fakeHttp = (answer: unknown = trainJson("transitous-toulouse-lyon.json")) => {
    const getJson = vi.fn<(url: string) => Promise<unknown>>(async () => answer);
    return { http: { getJson, postJson: vi.fn() }, getJson };
  };
  const toulouse = { lat: 43.6047, lon: 1.4442 };
  const lyon = { lat: 45.764, lon: 4.8357 };

  it("asks for the trains of the whole day, from one place to the other, with the way to the station on foot or by car", async () => {
    const { http, getJson } = fakeHttp();
    await createTransitous({ http }).journeys(toulouse, lyon, "2026-12-04");

    const url = new URL(getJson.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://api.transitous.org/api/v6/plan");
    const p = url.searchParams;
    expect(p.get("fromPlace")).toBe("43.6047,1.4442");
    expect(p.get("toPlace")).toBe("45.764,4.8357");
    expect(p.get("time")).toBe("2026-12-04T04:00:00Z");
    expect(p.get("transitModes")).toBe("HIGHSPEED_RAIL,LONG_DISTANCE,NIGHT_RAIL,REGIONAL_RAIL");
    expect(p.get("preTransitModes")).toBe("WALK,CAR");
    expect(Number(p.get("searchWindow"))).toBe(trains.transitous.searchWindowSeconds);
    expect(p.get("detailedLegs")).toBe("false");
  });

  it("gives only the journeys that leave on that day (the search may run on into the next)", async () => {
    const answer = trainJson("transitous-toulouse-lyon.json");
    // The second one leaves the next morning
    answer.itineraries[1].legs.forEach((leg: { startTime: string; endTime: string }) => {
      leg.startTime = leg.startTime.replace("2026-12-04", "2026-12-05");
      leg.endTime = leg.endTime.replace("2026-12-04", "2026-12-05");
    });
    const { http } = fakeHttp(answer);
    const found = await createTransitous({ http }).journeys(toulouse, lyon, "2026-12-04");
    expect(found.map((j) => j.departAt)).toEqual(["2026-12-04T07:37"]);
  });
});

describe("createHttp", () => {
  const options = { source: "Transitous", userAgent: "planytrip/1.0", pauseMs: { min: 0, max: 0 }, timeoutMs: 1000 };
  const answering = (response: Response | Error) => vi.fn<typeof fetch>(async () => (response instanceof Error ? Promise.reject(response) : response));
  const get = (response: Response | Error) => createHttp({ ...options, fetchImpl: answering(response) }).getJson("https://example.test/x");

  it("gives back the JSON, saying who is asking", async () => {
    const fetchImpl = answering(Response.json({ ok: 1 }));
    await expect(createHttp({ ...options, fetchImpl }).getJson("https://example.test/x")).resolves.toEqual({ ok: 1 });
    expect(new Headers(fetchImpl.mock.calls[0][1]!.headers).get("user-agent")).toBe("planytrip/1.0");
  });

  it("posts JSON", async () => {
    const fetchImpl = answering(Response.json({ ok: 1 }));
    await createHttp({ ...options, fetchImpl }).postJson("https://example.test/x", { a: 1 });
    const init = fetchImpl.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("stops at a wall: refused, told to slow down, or answered with a web page instead of data", async () => {
    await expect(get(new Response("no", { status: 403 }))).rejects.toBeInstanceOf(ScrapeBlockedError);
    await expect(get(new Response("slow down", { status: 429 }))).rejects.toBeInstanceOf(ScrapeBlockedError);
    await expect(get(new Response("<!doctype html><title>Access temporarily restricted</title>", { status: 200 }))).rejects.toBeInstanceOf(ScrapeBlockedError);
  });

  it("can be tried again after an outage, but not after a request it did not accept", async () => {
    const outage = (await get(new Response("", { status: 503 })).catch((e) => e)) as ScrapeError;
    expect(outage).toBeInstanceOf(ScrapeError);
    expect(outage.retryable).toBe(true);
    const refused = (await get(new Response("", { status: 400 })).catch((e) => e)) as ScrapeError;
    expect(refused).toBeInstanceOf(ScrapeUnavailableError);
    expect(((await get(new Error("ECONNRESET")).catch((e) => e)) as ScrapeError).retryable).toBe(true);
    expect(((await get(new Response("plain words", { status: 200 })).catch((e) => e)) as ScrapeError).message).toMatch(/not JSON/);
  });
});

describe("userAgentFor", () => {
  it("names the app, and gives a way to reach its owner when there is one (Transitous asks for it)", () => {
    expect(userAgentFor(null)).toBe("planytrip/1.0 (personal use, low volume)");
    expect(userAgentFor("me@example.org")).toBe("planytrip/1.0 (personal use, low volume; me@example.org)");
  });
});
