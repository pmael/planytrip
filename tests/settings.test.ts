import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkClaude, ClaudeUnavailableError, type ClaudeRunner } from "@/ai/claude";
import type { Db } from "@/db/types";
import { startCompute } from "@/server/services/compute";
import { getDeliberationView } from "@/server/services/deliberation";
import { getSettingsView } from "@/server/services/settings";
import { updateTrip } from "@/server/services/trips";
import { createTestDb } from "./helpers/db";
import { enterScenario, fixtureAdapters, runUntilIdle } from "./helpers/compute";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

describe("getSettingsView", () => {
  it("is null for an unknown trip", () => {
    expect(getSettingsView(db, "nope")).toBeNull();
  });

  it("describes a trip that was not computed: no options, never worked out", async () => {
    const { tripId } = await enterScenario(db);
    expect(getSettingsView(db, tripId)).toMatchObject({
      tripId, status: "draft", nights: null, windowNights: 10, lastWorkedOutAt: null,
      counts: { guests: 3, destinations: 3, transportOptions: 0, stays: 0 },
    });
  });

  it("counts what was found and says when it was worked out", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters());
    const view = getSettingsView(db, tripId)!;
    expect(view.status).toBe("ready");
    expect(view.counts.transportOptions).toBeGreaterThan(0);
    expect(view.counts.stays).toBe(4);
    expect(Date.parse(view.lastWorkedOutAt!)).not.toBeNaN();
  });

  it("follows a rename and a shorter trip", async () => {
    const { tripId } = await enterScenario(db);
    updateTrip(db, tripId, { name: "Summer 2027", nights: 7 });
    expect(getSettingsView(db, tripId)).toMatchObject({ name: "Summer 2027", nights: 7, windowNights: 10 });
  });
});

describe("the guests as the Guests page needs them", () => {
  it("carry where they live and the mode they prefer", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters());
    const view = getDeliberationView(db, tripId);
    if (view?.kind !== "ready") throw new Error("not ready");
    expect(view.guests.map((g) => [g.name, g.homeLabel, g.preferredMode])).toEqual([
      ["Martin", expect.stringContaining("Madrid"), "car"],
      ["Chloé", expect.stringContaining("Paris"), "plane"],
      ["Jessy", expect.stringContaining("Madrid"), "plane"],
    ]);
  });
});

describe("checkClaude", () => {
  const answers = (map: Record<string, string | Error>): ClaudeRunner => async (args) => {
    const answer = map[args[0]];
    if (answer instanceof Error) throw answer;
    return answer ?? "";
  };

  it("reports a CLI that is installed and signed in with the subscription", async () => {
    const run = answers({ "--version": "2.1.302 (Claude Code)\n", auth: '{"loggedIn": true, "authMethod": "claude.ai"}' });
    await expect(checkClaude({ run })).resolves.toEqual({ installed: true, version: "2.1.302", loggedIn: true, account: "claude.ai" });
  });

  it("reports a CLI that is not installed", async () => {
    const run = answers({ "--version": new ClaudeUnavailableError("not found") });
    await expect(checkClaude({ run })).resolves.toEqual({ installed: false, version: null, loggedIn: null, account: null });
  });

  it("reports a CLI that is installed but logged out, even when it exits with an error saying so", async () => {
    const run = answers({ "--version": "2.1.302 (Claude Code)", auth: new Error('claude exited with an error: {"loggedIn": false}') });
    await expect(checkClaude({ run })).resolves.toMatchObject({ installed: true, loggedIn: false });
  });

  it("does not guess when the login status cannot be read", async () => {
    const run = answers({ "--version": "2.1.302 (Claude Code)", auth: "not json" });
    await expect(checkClaude({ run })).resolves.toMatchObject({ installed: true, version: "2.1.302", loggedIn: null });
  });
});
