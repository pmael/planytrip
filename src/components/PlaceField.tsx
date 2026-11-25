"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { GeoPlace } from "@/core/types";
import { cn } from "@/lib/utils";
import { FieldRow, pillSurface } from "./PillField";

type Lookup = { query: string; places: GeoPlace[]; failed: boolean };

/**
 * A city field with suggestions from /api/geo/search as you type. Submits the typed text as
 * `<name>` and, once a suggestion is picked, the whole place as JSON in `<name>Place`.
 */
export function PlaceField({
  icon,
  name,
  placeholder,
  error,
}: {
  icon: ReactNode;
  name: string;
  placeholder: string;
  error?: string;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<GeoPlace | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const query = text.trim();
  const searching = !selected && query.length >= 2;
  const answered = searching && lookup?.query === query;
  const loading = searching && !answered;
  const places = answered ? lookup.places : [];

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/geo/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Search answered ${response.status}`);
        setLookup({ query, places: await response.json(), failed: false });
        setActive(-1);
      } catch {
        if (!controller.signal.aborted) setLookup({ query, places: [], failed: true });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searching]);

  function pick(place: GeoPlace) {
    setSelected(place);
    setText(place.label);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (places.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + places.length) % places.length);
    } else if (event.key === "Enter" && open && active >= 0 && places[active]) {
      event.preventDefault();
      pick(places[active]);
    } else if (event.key === "Escape" && open) {
      // Close the list, not the whole popup
      event.stopPropagation();
      setOpen(false);
    }
  }

  const showList = open && searching && answered;

  return (
    <FieldRow icon={icon} name={name} error={error}>
      <div className="relative w-full">
        <div className={cn(pillSurface(Boolean(error)), "flex h-[86px] items-center pr-8")}>
          <input
            name={name}
            value={text}
            autoComplete="off"
            placeholder={placeholder}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setSelected(null);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            className="h-full w-full bg-transparent px-10 outline-none placeholder:text-white/35"
          />
          {loading && <LoaderCircle aria-hidden className="size-6 shrink-0 animate-spin text-white/60" />}
        </div>
        <input type="hidden" name={`${name}Place`} value={selected ? JSON.stringify(selected) : ""} />

        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="absolute top-full right-0 left-0 z-20 mt-2 max-h-[340px] animate-[fade-up_0.2s_ease-out_both] overflow-y-auto rounded-[28px] border border-white/20 bg-[#4b4b4b]/95 py-2 shadow-[0_12px_40px_rgb(0_0_0/0.4)] backdrop-blur-md"
          >
            {places.length === 0 && (
              <li className="px-8 py-4 text-xl text-white/60">
                {lookup?.failed ? "The city search is unavailable right now" : "No city found"}
              </li>
            )}
            {places.map((place, index) => (
              <li
                key={`${place.label}-${place.lat}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // Keep the focus in the input so the list is not closed before the click lands
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(place)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-6 px-8 py-3.5 text-xl",
                  index === active && "bg-white/15",
                )}
              >
                <span>{place.label}</span>
                {place.airports.length > 0 && (
                  <span className="text-base text-white/55">{place.airports.slice(0, 3).join(" · ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </FieldRow>
  );
}
