import { describe, expect, it } from "vitest";
import { NO_AIRPORT, NO_ROAD_ROUTE, type ReachabilityCell } from "@/core/reachability";
import { describeCell } from "@/lib/reachabilityText";

const cell = (over: Partial<ReachabilityCell>): ReachabilityCell => ({
  guestId: "g", destinationId: "d", status: "ok", modes: [], warning: null, reason: null, fallback: null, ...over,
});
const mode = (m: "plane" | "car" | "train" | "bus", state: "reachable" | "unreachable" | "unverified" | "unchecked", extra = {}) => ({
  mode: m, state, reason: null, distanceKm: null, durationMin: null, ...extra,
});

describe("describeCell", () => {
  it("says how a guest gets there, with the distance and time of a drive", () => {
    expect(describeCell(cell({ modes: [mode("car", "reachable", { distanceKm: 618, durationMin: 413 })] }))).toEqual({
      tone: "ok", title: "By car", detail: "618 km · 6 h 53", offer: null,
    });
  });

  it("lists every accepted mode that gets there", () => {
    const text = describeCell(cell({ modes: [mode("car", "unreachable"), mode("plane", "reachable"), mode("train", "reachable")] }));
    expect(text).toMatchObject({ title: "By plane or train", detail: null });
  });

  it("warns about a long drive and the overnight stop", () => {
    expect(describeCell(cell({ status: "warning", warning: { kind: "long_drive", mode: "car", hours: 14.7 } }))).toEqual({
      tone: "warning", title: "About 15 h of driving", detail: "An overnight stop will be suggested", offer: null,
    });
  });

  it("blocks with the reason, and offers the fallback mode", () => {
    expect(describeCell(cell({ status: "blocked", reason: NO_ROAD_ROUTE, fallback: "plane" }))).toEqual({
      tone: "blocked", title: "No road route", detail: null, offer: "plane",
    });
  });

  it("says so when no mode gets there", () => {
    expect(describeCell(cell({ status: "blocked", reason: NO_AIRPORT }))).toEqual({
      tone: "blocked", title: "No airport nearby", detail: "No other mode gets there", offer: null,
    });
    expect(describeCell(cell({ status: "blocked", reason: "something_new" })).title).toBe("Can't get there");
  });

  it("tells a routing outage from a check not made yet", () => {
    expect(describeCell(cell({ status: "unverified", modes: [mode("car", "unverified")] })).detail).toBe("The routing service is unavailable");
    expect(describeCell(cell({ status: "unverified", modes: [mode("car", "unchecked")] })).detail).toBe("Checking…");
  });
});
