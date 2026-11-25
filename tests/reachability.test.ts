import { describe, expect, it } from "vitest";
import {
  cellFor,
  fallbackMode,
  isPlaneReachable,
  isVerifiedUnreachable,
  NO_AIRPORT,
  NO_ROAD_ROUTE,
  OSRM_UNAVAILABLE,
  reachabilityMatrix,
} from "@/core/reachability";
import type { Destination, Guest, GuestModes, RouteCheck, TransportMode } from "@/core/types";
import { loadScenario } from "./helpers/scenario";

describe("isPlaneReachable (R1)", () => {
  it("needs an airport at each end", () => {
    expect(isPlaneReachable({ airports: ["MAD"] }, { airports: ["BCN"] })).toBe(true);
    expect(isPlaneReachable({ airports: [] }, { airports: ["BCN"] })).toBe(false);
    expect(isPlaneReachable({ airports: ["MAD"] }, { airports: [] })).toBe(false);
    expect(isPlaneReachable({ airports: [] }, { airports: [] })).toBe(false);
  });
});

describe("the reference scenario (use-cases.md A.1 step 4)", () => {
  const s = loadScenario();
  const matrix = reachabilityMatrix(s.guests, s.guestModes, Object.values(s.destinations), s.checks);
  const cell = (guest: Guest, key: keyof typeof s.destinations) => cellFor(matrix, guest.id, s.destinations[key].id)!;

  it("has one cell per guest and destination", () => {
    expect(matrix.cells).toHaveLength(9);
  });

  it("blocks Martin from La Réunion by car, and offers the plane in one click", () => {
    expect(cell(s.martin, "la-reunion")).toMatchObject({
      status: "blocked",
      reason: NO_ROAD_ROUTE,
      fallback: "plane",
      warning: null,
    });
  });

  it("lets Martin drive to Barcelona", () => {
    expect(cell(s.martin, "barcelona")).toMatchObject({ status: "ok", warning: null, fallback: null });
    expect(cell(s.martin, "barcelona").modes[0]).toMatchObject({ mode: "car", state: "reachable", distanceKm: 620 });
  });

  it("warns Martin that Mont-Saxonnex is 13 h of driving, so an overnight stop will be suggested", () => {
    expect(cell(s.martin, "mont-saxonnex")).toMatchObject({
      status: "warning",
      warning: { kind: "long_drive", mode: "car", hours: 13 },
    });
  });

  it("lets Chloé and Jessy fly everywhere", () => {
    for (const guest of [s.chloe, s.jessy]) {
      for (const key of ["barcelona", "la-reunion", "mont-saxonnex"] as const) {
        expect(cell(guest, key).status).toBe("ok");
      }
    }
  });

  it("makes Martin's La Réunion reachable once he also accepts the plane (A.5)", () => {
    const withPlane: GuestModes = { ...s.guestModes, [s.martin.id]: ["car", "plane"] };
    const result = reachabilityMatrix(s.guests, withPlane, Object.values(s.destinations), s.checks);
    const reunion = cellFor(result, s.martin.id, s.destinations["la-reunion"].id)!;
    expect(reunion.status).toBe("ok");
    expect(reunion.modes.map((m) => [m.mode, m.state])).toEqual([["car", "unreachable"], ["plane", "reachable"]]);
    expect(reunion.fallback).toBeNull();
  });
});

// Small hand-made cases
const guest = { id: "g", originKey: "madrid", preferredMode: "car" } as Guest;
const destination = { id: "d" } as Destination;
const check = (mode: TransportMode, rest: Partial<RouteCheck> = {}): RouteCheck => ({
  id: mode, destinationId: "d", originKey: "madrid", mode, reachable: true, reason: null,
  distanceKm: null, durationMin: null, checkedAt: "", ...rest,
});
const matrixOf = (accepted: TransportMode[], checks: RouteCheck[]) =>
  reachabilityMatrix([guest], { g: accepted }, [destination], checks).cells[0];

describe("a cell's status", () => {
  it("is unverified when nothing was checked yet", () => {
    expect(matrixOf(["car"], [])).toMatchObject({ status: "unverified", modes: [{ state: "unchecked" }] });
  });

  it("is unverified, not blocked, when the routing service was down", () => {
    const cell = matrixOf(["car"], [check("car", { reachable: false, reason: OSRM_UNAVAILABLE })]);
    expect(cell).toMatchObject({ status: "unverified", modes: [{ state: "unverified" }], fallback: null });
  });

  it("is blocked when every accepted mode is checked and none gets there", () => {
    const cell = matrixOf(["plane"], [check("plane", { reachable: false, reason: NO_AIRPORT })]);
    expect(cell).toMatchObject({ status: "blocked", reason: NO_AIRPORT });
  });

  it("is ok as soon as one accepted mode gets there", () => {
    const cell = matrixOf(["car", "plane"], [check("car", { reachable: false, reason: NO_ROAD_ROUTE }), check("plane")]);
    expect(cell.status).toBe("ok");
  });

  it("is unverified when a mode failed to verify and the other is blocked", () => {
    const cell = matrixOf(["car", "plane"], [check("car", { reachable: false, reason: OSRM_UNAVAILABLE }), check("plane", { reachable: false, reason: NO_AIRPORT })]);
    expect(cell.status).toBe("unverified");
  });
});

describe("the long drive warning", () => {
  it("appears above 10 hours of driving and not at 10", () => {
    expect(matrixOf(["car"], [check("car", { durationMin: 601 })]).status).toBe("warning");
    expect(matrixOf(["car"], [check("car", { durationMin: 600 })]).status).toBe("ok");
  });

  it("does not appear when the guest can also take another mode", () => {
    expect(matrixOf(["car", "plane"], [check("car", { durationMin: 800 }), check("plane")]).status).toBe("ok");
  });

  it("rounds the hours to a tenth", () => {
    expect(matrixOf(["car"], [check("car", { durationMin: 800 })]).warning?.hours).toBe(13.3);
  });
});

describe("fallbackMode", () => {
  const plane = check("plane");
  const train = check("train");
  const car = check("car", { reachable: false, reason: NO_ROAD_ROUTE });

  it("offers a mode the guest did not accept, that gets there", () => {
    expect(fallbackMode(guest, ["car"], destination, [car, plane])).toBe("plane");
  });

  it("prefers the plane, then the train, then the bus, when prices are unknown", () => {
    expect(fallbackMode(guest, ["car"], destination, [train, plane])).toBe("plane");
    expect(fallbackMode(guest, ["car", "plane"], destination, [train, check("bus")])).toBe("train");
    expect(fallbackMode(guest, ["car", "plane", "train"], destination, [check("bus")])).toBe("bus");
  });

  it("takes the cheapest mode when prices are known", () => {
    const option = (mode: TransportMode, priceEur: number) =>
      ({ destinationId: "d", originKey: "madrid", mode, priceEur, priceUnit: "per_person", lastMileEur: 0 }) as never;
    expect(fallbackMode(guest, ["car"], destination, [plane, train], [option("plane", 300), option("train", 120)])).toBe("train");
  });

  it("never offers an accepted mode, an unreachable one or one that was not verified", () => {
    expect(fallbackMode(guest, ["car"], destination, [car])).toBeNull();
    expect(fallbackMode(guest, ["car"], destination, [check("plane", { reachable: false, reason: NO_AIRPORT })])).toBeNull();
    expect(fallbackMode(guest, ["car"], destination, [check("plane", { reachable: false, reason: OSRM_UNAVAILABLE })])).toBeNull();
    expect(fallbackMode(guest, ["plane"], destination, [plane])).toBeNull();
  });

  it("only looks at the guest's own departure place", () => {
    expect(fallbackMode(guest, ["car"], destination, [check("plane", { originKey: "paris" })])).toBeNull();
  });
});

describe("isVerifiedUnreachable", () => {
  it("is true for a real negative and false for a pass or for a service outage", () => {
    expect(isVerifiedUnreachable({ reachable: false, reason: NO_ROAD_ROUTE })).toBe(true);
    expect(isVerifiedUnreachable({ reachable: true, reason: null })).toBe(false);
    expect(isVerifiedUnreachable({ reachable: false, reason: OSRM_UNAVAILABLE })).toBe(false);
  });
});
