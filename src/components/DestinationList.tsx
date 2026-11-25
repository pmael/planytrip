"use client";

import {
  Calendar,
  CreditCard,
  Goal,
  Landmark,
  MapPin,
  MapPinPlus,
  PartyPopper,
  Sofa,
  TreePine,
} from "lucide-react";
import { colorOf } from "@/core/colors";
import { commonWindow, coverageOf } from "@/core/dates";
import type { Color, Destination, Guest } from "@/core/types";
import { destinationErrorsFromResponse, validateDestinationForm } from "@/lib/destinationForm";
import { capitalize, formatDateRange } from "@/lib/form";
import { DestinationRow, type DestinationRowData } from "./DestinationRow";
import type { EntryField, SubmitResult } from "./EntryDialog";
import { EntryList } from "./EntryList";
import type { Tone } from "./EntryRow";

const fields: EntryField[] = [
  { name: "place", type: "place", icon: <MapPin />, placeholder: "Enter the destination (town) ..." },
  {
    type: "choice",
    name: "budget",
    icon: <CreditCard />,
    label: "Type of budget for this destination",
    defaultValue: "medium",
    choices: [
      { id: "light", label: "Light" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
    ],
  },
  {
    type: "choice",
    name: "objective",
    icon: <Goal />,
    label: "Objective of this destination",
    defaultValue: "none",
    choices: [
      { id: "partying", label: "Partying", icon: <PartyPopper /> },
      { id: "chill", label: "Chill", icon: <Sofa /> },
      { id: "culture", label: "Culture", icon: <Landmark /> },
      { id: "nature", label: "Nature", icon: <TreePine /> },
      { id: "none", label: "None" },
    ],
  },
  { type: "dateRange", name: "dates", icon: <Calendar /> },
];

const JSON_HEADERS = { "content-type": "application/json" };

async function submitDestination(tripId: string, form: FormData): Promise<SubmitResult<Destination>> {
  const checked = validateDestinationForm(form);
  if ("errors" in checked) return checked;

  try {
    const response = await fetch(`/api/trips/${tripId}/destinations`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(checked.input),
    });
    if (response.status === 400) return { errors: destinationErrorsFromResponse(await response.json()) };
    if (response.status === 502) return { errors: { _form: "The place search is unavailable, please try again." } };
    if (!response.ok) return { errors: { _form: "Something went wrong, please try again." } };
    return { item: (await response.json()) as Destination };
  } catch {
    return { errors: { _form: "Couldn't reach the server, please try again." } };
  }
}

async function removeDestination(destination: Destination): Promise<boolean> {
  try {
    return (await fetch(`/api/destinations/${destination.id}`, { method: "DELETE" })).ok;
  } catch {
    return false;
  }
}

const TONE: Record<Color, Tone> = { green: "good", yellow: "warn", red: "bad", neutral: "neutral" };

/**
 * How a destination looks in the list. Its dates, when it has some, are coloured by how they sit
 * against the days the whole group is free: covering them all is green, cutting into them yellow,
 * missing them red.
 */
function rowOf(destination: Destination, guests: Guest[]): DestinationRowData {
  const window = commonWindow(guests);
  const hasDates = destination.dateFrom !== null || destination.dateTo !== null;
  const coverage =
    hasDates && window
      ? coverageOf(
          { availableFrom: destination.dateFrom ?? "0000-01-01", availableTo: destination.dateTo ?? "9999-12-31" },
          window,
        )
      : null;

  return {
    place: destination.label,
    inScope: destination.inScope,
    budget: `${capitalize(destination.budgetLevel)} Budget`,
    objective: destination.objective === "none" ? "No needs" : capitalize(destination.objective),
    dates: formatDateRange(destination.dateFrom ?? "", destination.dateTo ?? "") || "Any dates",
    datesTone: coverage ? TONE[colorOf("dates", coverage)] : "neutral",
  };
}

/** Step 2: the places to compare, saved as they are added. `guests` give the window the dates are judged against. */
export function DestinationList({
  tripId,
  initialDestinations,
  guests,
}: {
  tripId: string;
  initialDestinations: Destination[];
  guests: Guest[];
}) {
  return (
    <EntryList<Destination>
      title="Add a destination"
      triggerIcon={<MapPinPlus />}
      fields={fields}
      submit={(form) => submitDestination(tripId, form)}
      initialItems={initialDestinations}
      onRemove={removeDestination}
      renderRow={(destination, _index, _all, remove) => (
        <DestinationRow key={destination.id} destination={rowOf(destination, guests)} onRemove={remove} />
      )}
      nextHref="transports"
    />
  );
}
