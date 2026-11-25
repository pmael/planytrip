"use client";

import { Crown, Sparkles } from "lucide-react";
import { guestHue, initialsOf, standingOfCell, STANDING_HEX, STANDING_WORD, type Standing } from "@/lib/deliberationText";
import type { TripMapData } from "@/lib/tripMap";
import { cn } from "@/lib/utils";
import type { DeliberationGuest, Dossier } from "@/server/services/deliberation";
import type { Focus } from "./GuestMatrix";
import { glassSurface } from "./GlassCard";

/** "9,400 km", rounded to the hundred: it is a distance to feel, not to navigate by */
const kmText = (km: number) => `≈ ${(Math.round(km / 100) * 100).toLocaleString("en-US")} km`;

const STAR_HEX = "#e5c35a";
const AI_HEX = "#a78bfa";

/**
 * Where everybody is and where they could go: a curve from each guest's home to each destination,
 * coloured by how that trip sits with their budget (dashed when they cannot get there), and gold
 * when it is their ★. Pointing at a guest or a destination, here or in the matrix, brings out
 * their curves (use-cases.md C-S5). Optional: nothing else on the page depends on it.
 */
export function TripMap({
  map,
  guests,
  destinations,
  focus,
  aiPickId,
  onFocus,
  onOpen,
}: {
  map: TripMapData;
  guests: DeliberationGuest[];
  destinations: Dossier[];
  focus: Focus;
  aiPickId: string | null;
  onFocus: (focus: Focus) => void;
  onOpen: (destinationId: string) => void;
}) {
  const active = focus.guestId !== null || focus.destinationId !== null;
  const hot = (guestId: string, destinationId: string) => focus.guestId === guestId || focus.destinationId === destinationId;
  const clear = () => onFocus({ guestId: null, destinationId: null });

  const standingOf = (guestId: string, destinationId: string): Standing => {
    const cell = destinations.find((d) => d.id === destinationId)?.cells.find((c) => c.guestId === guestId);
    return cell ? standingOfCell(cell) : "unreachable";
  };

  return (
    <section
      aria-label="Map"
      className={cn(glassSurface, "relative animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both] overflow-hidden rounded-[44px] bg-white/[0.1] p-3 text-white")}
    >
      <svg viewBox={`0 0 ${map.width} ${map.height}`} role="img" aria-label="Map of where each guest could go" className="block h-auto w-full rounded-[34px] font-sans">
        <defs>
          <radialGradient id="map-sea" cx="50%" cy="40%" r="75%">
            <stop offset="0%" stopColor="#1d4a55" />
            <stop offset="100%" stopColor="#0c2230" />
          </radialGradient>
          <filter id="map-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={map.width} height={map.height} fill="url(#map-sea)" />
        <path d={map.graticule} fill="none" stroke="#ffffff" strokeOpacity={0.07} strokeWidth={0.8} />
        <path d={map.land} fill="#5c7f72" fillOpacity={0.62} />
        <path d={map.borders} fill="none" stroke="#e8f5ee" strokeOpacity={0.3} strokeWidth={0.7} />

        {/* The curves: all of them, the pointed-at ones brought out */}
        <g fill="none" strokeLinecap="round">
          {map.arcs.map((arc, index) => {
            const guestIndex = guests.findIndex((g) => g.id === arc.guestId);
            const standing = standingOf(arc.guestId, arc.destinationId);
            const starred = guests[guestIndex]?.favoriteId === arc.destinationId;
            const emphasised = active && hot(arc.guestId, arc.destinationId);
            const hex = starred ? STAR_HEX : STANDING_HEX[standing];
            const dashed = standing === "unreachable";
            return (
              <path
                key={`${arc.guestId}-${arc.destinationId}`}
                d={arc.d}
                pathLength={1}
                stroke={hex}
                strokeWidth={emphasised ? 5 : starred ? 4 : 2.6}
                strokeOpacity={active ? (emphasised ? 1 : 0.1) : dashed ? 0.5 : 0.78}
                strokeDasharray={dashed ? "0.012 0.022" : 1}
                filter={emphasised || starred ? "url(#map-glow)" : undefined}
                className="animate-[draw-arc_1.2s_cubic-bezier(0.22,1,0.36,1)_both] transition-[stroke-opacity,stroke-width] duration-300"
                style={{ animationDelay: `${300 + index * 70}ms` }}
              >
                <title>{`${guests[guestIndex]?.name} to ${destinations.find((d) => d.id === arc.destinationId)?.shortLabel}: ${STANDING_WORD[standing]}${starred ? " (★)" : ""}`}</title>
              </path>
            );
          })}
        </g>

        {/* Where the guests live */}
        {map.homes.map((home) => {
          const members = home.guestIds.map((id) => guests.findIndex((g) => g.id === id)).filter((i) => i >= 0);
          const dim = active && focus.guestId !== null && !home.guestIds.includes(focus.guestId);
          return (
            <g key={home.originKey} className={cn("transition-opacity duration-300", dim && "opacity-35")}>
              {members.map((guestIndex, i) => {
                const offset = (i - (members.length - 1) / 2) * 30;
                return (
                  <g
                    key={guests[guestIndex].id}
                    transform={`translate(${home.x + offset},${home.y})`}
                    onMouseEnter={() => onFocus({ guestId: guests[guestIndex].id, destinationId: null })}
                    onMouseLeave={clear}
                    className="cursor-pointer"
                  >
                    <g className="animate-[pin-in_0.5s_ease-out_both] [transform-box:fill-box] [transform-origin:center]" style={{ animationDelay: `${i * 80}ms` }}>
                      <circle r={15} fill={guestHue(guestIndex)} stroke="#ffffff" strokeWidth={2.5} />
                      <text textAnchor="middle" dy="0.35em" fontSize={14} fill="#fff" className="pointer-events-none select-none">
                        {initialsOf(guests[guestIndex].name)}
                      </text>
                      <title>{`${guests[guestIndex].name}, from ${home.city}`}</title>
                    </g>
                  </g>
                );
              })}
              <text x={home.x} y={home.y + 36} textAnchor="middle" fontSize={15} fill="#e8f5ee" stroke="#0b1d28" strokeWidth={4} paintOrder="stroke" className="pointer-events-none select-none">
                {home.city}
              </text>
            </g>
          );
        })}

        {/* The destinations, ranked */}
        {map.destinations.map((pin, index) => {
          const dossier = destinations.find((d) => d.id === pin.id)!;
          const hex = STANDING_HEX[dossier.tier];
          const dim = active && focus.destinationId !== null ? focus.destinationId !== pin.id : false;
          // Near the top of the map the name goes under the pin so it is not cut off
          const below = pin.y < 95;
          return (
            <g
              key={pin.id}
              transform={`translate(${pin.x},${pin.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${dossier.shortLabel}, ranked ${dossier.rank}${pin.offMap ? `, about ${kmText(pin.km)} away` : ""}. Open details`}
              onMouseEnter={() => onFocus({ guestId: null, destinationId: pin.id })}
              onMouseLeave={clear}
              onFocus={() => onFocus({ guestId: null, destinationId: pin.id })}
              onBlur={clear}
              onClick={() => onOpen(pin.id)}
              onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), onOpen(pin.id))}
              className={cn("cursor-pointer outline-none transition-opacity duration-300", dim && "opacity-40")}
            >
              <g className="animate-[pin-in_0.6s_ease-out_both] [transform-box:fill-box] [transform-origin:center]" style={{ animationDelay: `${600 + index * 120}ms` }}>
                {dossier.recommended && (
                  <circle r={20} fill="none" stroke="#2ec48f" strokeWidth={3} className="animate-[ripple_2.2s_ease-out_infinite] [transform-box:fill-box] [transform-origin:center]" />
                )}
                {aiPickId === pin.id && <circle r={27} fill="none" stroke={AI_HEX} strokeWidth={2.5} strokeDasharray="5 5" filter="url(#map-glow)" />}
                {pin.offMap && (
                  <path
                    d="M0,-10 L16,0 L0,10 Z"
                    fill="#ffffff"
                    fillOpacity={0.9}
                    transform={`rotate(${(pin.angle * 180) / Math.PI}) translate(38,0)`}
                    className="pointer-events-none"
                  />
                )}
                <circle r={20} fill={hex} stroke="#ffffff" strokeWidth={3} strokeDasharray={pin.offMap ? "6 4" : undefined} filter="url(#map-glow)" />
                <text textAnchor="middle" dy="0.36em" fontSize={19} fill="#fff" className="pointer-events-none select-none">
                  {dossier.rank}
                </text>
                <text y={below ? 46 : -32} textAnchor="middle" fontSize={19} fill="#fff" stroke="#0b1d28" strokeWidth={5} paintOrder="stroke" className="pointer-events-none select-none">
                  {dossier.shortLabel}
                </text>
                {pin.offMap && (
                  <text y={below ? 66 : -13 - 38} textAnchor="middle" fontSize={14} fill="#cfe6dc" stroke="#0b1d28" strokeWidth={4} paintOrder="stroke" className="pointer-events-none select-none">
                    {kmText(pin.km)} away
                  </text>
                )}
              </g>
            </g>
          );
        })}
      </svg>

      <ul className="absolute bottom-7 left-8 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-full bg-[#0c2230]/80 px-5 py-2.5 text-base text-white/85 backdrop-blur-sm" aria-label="Legend">
        {(["comfy", "limited", "over", "unreachable"] as const).map((standing) => (
          <li key={standing} className="flex items-center gap-2">
            <span aria-hidden className="h-0 w-6 border-t-[3px]" style={{ borderColor: STANDING_HEX[standing], borderStyle: standing === "unreachable" ? "dashed" : "solid" }} />
            {STANDING_WORD[standing]}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-0 w-6 border-t-[4px]" style={{ borderColor: STAR_HEX }} />★
        </li>
        <li className="flex items-center gap-1.5 text-white/65">
          <Crown aria-hidden className="size-4" /> Recommended
        </li>
        {aiPickId && (
          <li className="flex items-center gap-1.5 text-violet-200">
            <Sparkles aria-hidden className="size-4" /> AI&rsquo;s pick
          </li>
        )}
      </ul>
    </section>
  );
}
