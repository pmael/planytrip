// The loading animation's motion (lib/planeLoader.ts): fluid, so nothing jumps from one picture to the next, not even
// when the loop starts again, and everything stays where it should.
import { describe, expect, it } from "vitest";
import { BOX, INTRO_MS, LOOP_MS, loaderPose, NAME_LETTERS, ROAD_WIDTH, stillPose, type LoaderPose } from "@/lib/planeLoader";

/** Every number of a pose, and how much each may change in a 60th of a second */
const numbersOf = (pose: LoaderPose): [string, number, number][] => [
  ["box left", pose.box.x, 22],
  ["box right", pose.box.x + pose.box.width, 22],
  ["box top", pose.box.y, 6],
  ["box drawn", pose.box.drawn, 0.09],
  ["plane x", pose.plane.x, 22],
  ["plane y", pose.plane.y, 6],
  ["plane rotation", pose.plane.rotation, 3],
  ...pose.dots.map((size, i): [string, number, number] => [`dot ${i}`, size, 0.5]),
  ...pose.letters.flatMap(({ opacity, rise, shine }, i): [string, number, number][] => [
    [`letter ${i}`, opacity, 0.6],
    // What is seen of it: a letter that is not there can go back to where it starts from
    [`letter ${i} rise`, rise * opacity, 5],
    [`letter ${i} shine`, shine, 0.2],
  ]),
];

describe.each([["the icon", false, LOOP_MS.icon], ["the name", true, LOOP_MS.name]] as const)("the loader closing on %s", (_, name, loop) => {
  const end = INTRO_MS + 2 * loop + 200;

  it("never jumps: at 60 pictures a second everything moves by small steps, through the start of the next loop too", () => {
    for (let ms = 0; ms < end; ms += 1000 / 60) {
      const before = numbersOf(loaderPose(ms, name));
      numbersOf(loaderPose(ms + 1000 / 60, name)).forEach(([what, value, most], i) => {
        expect(Math.abs(value - before[i][1]), `${what} at ${Math.round(ms)} ms`).toBeLessThanOrEqual(most);
      });
    }
  });

  it("keeps the plane in its box, and the box on the road", () => {
    for (let ms = 0; ms < end; ms += 7) {
      const { box, plane } = loaderPose(ms, name);
      expect(box.x).toBeGreaterThanOrEqual(-1e-9);
      expect(box.x + box.width).toBeLessThanOrEqual(ROAD_WIDTH + 1e-9);
      expect(box.width).toBeGreaterThanOrEqual(BOX - 1e-9);
      expect(plane.x).toBeGreaterThanOrEqual(box.x - 1e-9);
      expect(plane.x + BOX).toBeLessThanOrEqual(box.x + box.width + 1e-9);
    }
  });

  it("lays the dots, then eats them from the first to the last", () => {
    const eatenAt = loaderPose(0, name).dots.map((_dot, i) => {
      let seen = false;
      for (let ms = INTRO_MS; ms < INTRO_MS + loop; ms += 5) {
        const size = loaderPose(ms, name).dots[i];
        if (size > 0.8) seen = true;
        if (seen && size < 0.01) return ms;
      }
      return Infinity;
    });
    expect(eatenAt.every(Number.isFinite)).toBe(true);
    expect([...eatenAt].sort((a, b) => a - b)).toEqual(eatenAt);
  });
});

describe("the loader's beginning and rest", () => {
  it("starts from nothing and draws the icon", () => {
    expect(loaderPose(0)).toMatchObject({ box: { drawn: 0 }, plane: { wings: 0, belly: 0, edge: 0 } });
    expect(loaderPose(INTRO_MS)).toMatchObject({ box: { drawn: 1, width: BOX }, plane: { wings: 1, belly: 1, edge: 1 } });
  });

  it("shows the whole name, and stands still on it with reduced motion", () => {
    const { box, letters } = stillPose(true);
    expect(box).toMatchObject({ x: 0, y: 0, width: BOX });
    expect(letters).toHaveLength(NAME_LETTERS.length);
    expect(letters.every(({ opacity, rise }) => opacity === 1 && rise === 0)).toBe(true);
    expect(stillPose().box.width).toBe(BOX);
  });
});
