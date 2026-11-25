"use client";

import { useEffect, useId, useRef } from "react";
import { BOX, DOTS, loaderPose, NAME_HEIGHT, NAME_LETTERS, PIVOT, PLANE, ROAD_WIDTH, stillPose, type LoaderPose } from "@/lib/planeLoader";
import { cn } from "@/lib/utils";

/** The line's thickness, and half of it, which the box's outline is drawn inside of */
const STROKE = 5;
const INSET = STROKE / 2;

/** `glow`: bright, for the app's dark screens. `green`: the brand's dark green, for a white surface. */
const TONES = {
  glow: { from: "#2fb486", to: "#74f8c1", plane: ["#36bd8d", "#5fe8b3"], shine: "#f2fff9" },
  green: { from: "#0d4a35", to: "#28b574", plane: ["#11583f", "#28a86d"], shine: "#8ff0c4" },
} as const;

const points = (...of: (readonly [number, number])[]) => of.map(([x, y]) => `${x} ${y}`).join("L");
const { top, left, nose, fold } = PLANE;
/** The plane's lines, in the order they are drawn: from the fold outwards, then the two long edges to the nose */
const LINES = [
  { part: "wings", d: `M${points(fold, top)}` },
  { part: "wings", d: `M${points(fold, left)}` },
  { part: "wings", d: `M${points(fold, nose)}` },
  { part: "belly", d: `M${points(left, nose)}` },
  { part: "edge", d: `M${points(top, nose)}` },
] as const;

/** A line that is `drawn` from its start: 1 is all of it */
const draw = (element: SVGElement | null | undefined, drawn: number) => {
  if (!element) return;
  element.style.opacity = drawn > 0.001 ? "1" : "0";
  element.style.strokeDasharray = drawn >= 1 ? "none" : "1 1";
  element.style.strokeDashoffset = drawn >= 1 ? "0" : String(1 - drawn);
};

/**
 * The PlanyTrip loading animation, for the things that take a while (working a trip out, asking the AI): the box
 * stretches along a dotted road, the plane swoops over it and the box closes again (lib/planeLoader.ts). `width` is the
 * stretched box's, in pixels; `name` leaves "Plany Trip" beside the icon as the box closes, for a big one. It stands
 * still for people who asked for reduced motion, and the browser stops it in a hidden tab.
 */
export function PlaneLoader({
  width = 360,
  tone = "green",
  name = false,
  label = "Loading",
  decorative = false,
  className,
}: {
  width?: number;
  tone?: keyof typeof TONES;
  name?: boolean;
  label?: string;
  /** Hidden from screen readers, for a place that already says it is loading */
  decorative?: boolean;
  className?: string;
}) {
  const id = useId();
  const box = useRef<SVGRectElement>(null);
  const plane = useRef<SVGGElement>(null);
  const lines = useRef<(SVGPathElement | null)[]>([]);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const letters = useRef<(SVGGElement | null)[]>([]);
  const height = name ? NAME_HEIGHT : BOX;
  const colors = TONES[tone];

  // Drawn straight into the SVG, one picture per screen refresh: React has nothing to do in between
  useEffect(() => {
    const paint = (pose: LoaderPose) => {
      box.current?.setAttribute("x", String(pose.box.x + INSET));
      box.current?.setAttribute("y", String(pose.box.y + INSET));
      box.current?.setAttribute("width", String(pose.box.width - STROKE));
      draw(box.current, pose.box.drawn);
      plane.current?.setAttribute("transform", `translate(${pose.plane.x} ${pose.plane.y}) rotate(${pose.plane.rotation} ${PIVOT} ${PIVOT})`);
      LINES.forEach(({ part }, i) => draw(lines.current[i], pose.plane[part]));
      pose.dots.forEach((size, i) => dots.current[i]?.setAttribute("r", String(3.4 * size)));
      pose.letters.forEach(({ opacity, rise, shine }, i) => {
        const letter = letters.current[i];
        if (!letter) return;
        letter.style.opacity = String(opacity);
        letter.setAttribute("transform", `translate(0 ${rise})`);
        (letter.lastElementChild as SVGElement).style.opacity = String(shine);
      });
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let started: number | null = null;
    const step = (now: number) => {
      started ??= now;
      paint(loaderPose(now - started, name));
      frame = requestAnimationFrame(step);
    };
    const play = () => {
      cancelAnimationFrame(frame);
      if (reduced.matches) paint(stillPose(name));
      else frame = requestAnimationFrame(step);
    };
    play();
    reduced.addEventListener("change", play);
    return () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener("change", play);
    };
  }, [name]);

  return (
    <svg
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      viewBox={`0 0 ${ROAD_WIDTH} ${height}`}
      width={width}
      height={(width * height) / ROAD_WIDTH}
      fill="none"
      className={cn("block max-w-full shrink-0 overflow-visible", tone === "glow" && "drop-shadow-[0_0_9px_rgb(70_230_165/0.45)]", className)}
    >
      <defs>
        {/* Fixed to the road, not to the box: what moves to the right lights up */}
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1={height} x2={ROAD_WIDTH} y2="0">
          <stop stopColor={colors.from} />
          <stop offset="1" stopColor={colors.to} />
        </linearGradient>
        <linearGradient id={`${id}-plane`} gradientUnits="userSpaceOnUse" x1="10" y1="80" x2="80" y2="10">
          <stop stopColor={colors.plane[0]} />
          <stop offset="1" stopColor={colors.plane[1]} />
        </linearGradient>
      </defs>
      {DOTS.map(({ x, y }, i) => (
        <circle key={x} ref={(element) => void (dots.current[i] = element)} cx={x} cy={y + (height - BOX) / 2} r="0" fill={`url(#${id})`} />
      ))}
      {name &&
        NAME_LETTERS.map(({ letter, path }, i) => (
          <g key={letter} ref={(element) => void (letters.current[i] = element)} fillRule="evenodd" style={{ opacity: 0 }}>
            <path d={path} fill={`url(#${id})`} />
            <path d={path} fill={colors.shine} style={{ opacity: 0 }} />
          </g>
        ))}
      {/* Nothing is there until the first picture is drawn: it starts by drawing itself */}
      <rect ref={box} x={(ROAD_WIDTH - BOX) / 2 + INSET} y={(height - BOX) / 2 + INSET} width={BOX - STROKE} height={BOX - STROKE} rx="5" pathLength={1} stroke={`url(#${id})`} strokeWidth={STROKE} style={{ opacity: 0 }} />
      <g ref={plane} stroke={`url(#${id}-plane)`} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        {LINES.map(({ d }, i) => (
          <path key={d} ref={(element) => void (lines.current[i] = element)} d={d} pathLength={1} style={{ opacity: 0 }} />
        ))}
      </g>
    </svg>
  );
}
