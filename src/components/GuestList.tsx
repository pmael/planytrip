"use client";

import { BusFront, CarFront, Calendar, CreditCard, House, Luggage, Plane, TramFront, User, UserPlus } from "lucide-react";
import { colorOf } from "@/core/colors";
import { limitingGuests, commonWindow, noCommonDates } from "@/core/dates";
import type { Color, Guest } from "@/core/types";
import { capitalize, formatDateRange } from "@/lib/form";
import { errorsFromResponse, validateGuestForm } from "@/lib/guestForm";
import type { EntryField, SubmitResult } from "./EntryDialog";
import type { Tone } from "./EntryRow";
import { EntryList } from "./EntryList";
import { GuestRow, type GuestRowData } from "./GuestRow";
import { WindowBanner } from "./WindowBanner";

const fields: EntryField[] = [
  { name: "name", icon: <User />, placeholder: "Enter the name of the guest ..." },
  { type: "place", name: "home", icon: <House />, placeholder: "Enter where the guest live ..." },
  { name: "budget", icon: <CreditCard />, placeholder: "Enter your maximum budget ...", inputMode: "numeric" },
  { type: "dateRange", name: "availabilities", icon: <Calendar /> },
  {
    type: "choice",
    name: "transport",
    icon: <Luggage />,
    label: "Preferred means of transportation",
    choices: [
      { id: "plane", label: "Plane", icon: <Plane /> },
      { id: "train", label: "Train", icon: <TramFront /> },
      { id: "bus", label: "Bus", icon: <BusFront /> },
      { id: "car", label: "Car", icon: <CarFront /> },
    ],
  },
];

const JSON_HEADERS = { "content-type": "application/json" };

async function submitGuest(tripId: string, form: FormData): Promise<SubmitResult<Guest>> {
  const checked = validateGuestForm(form);
  if ("errors" in checked) return checked;

  try {
    const response = await fetch(`/api/trips/${tripId}/guests`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(checked.input),
    });
    if (response.status === 400) return { errors: errorsFromResponse(await response.json()) };
    if (response.status === 502) return { errors: { _form: "The city search is unavailable, please try again." } };
    if (!response.ok) return { errors: { _form: "Something went wrong, please try again." } };
    const { guest }: { guest: Guest } = await response.json();
    return { item: guest };
  } catch {
    return { errors: { _form: "Couldn't reach the server, please try again." } };
  }
}

async function removeGuest(guest: Guest): Promise<boolean> {
  try {
    return (await fetch(`/api/guests/${guest.id}`, { method: "DELETE" })).ok;
  } catch {
    return false;
  }
}

const TONE: Record<Color, Tone> = { green: "good", yellow: "warn", red: "bad", neutral: "neutral" };

/**
 * How a guest looks in the list. The budget is coloured against the group's (the biggest budget is
 * the greenest), and the dates flag whoever sets the limit of the common window.
 */
function rowOf(guest: Guest, guests: Guest[]): GuestRowData {
  const budgets = guests.map((other) => -other.maxBudgetEur);
  const window = commonWindow(guests);
  const limiting = window ? limitingGuests(guests, window) : [];
  const clash = noCommonDates(guests);

  const datesTone: Tone = clash?.includes(guest) ? "bad" : limiting.includes(guest) ? "warn" : "good";
  return {
    name: guest.name,
    city: guest.homeLabel.split(",")[0],
    budget: `${guest.maxBudgetEur} €`,
    budgetTone: TONE[colorOf("relativePrice", -guest.maxBudgetEur, budgets)],
    dates: formatDateRange(guest.availableFrom, guest.availableTo),
    datesTone,
    mode: capitalize(guest.preferredMode),
  };
}

/** Step 1: the guests of the trip, saved as they are added. */
export function GuestList({ tripId, initialGuests }: { tripId: string; initialGuests: Guest[] }) {
  return (
    <EntryList<Guest>
      title="Add a guest"
      triggerIcon={<UserPlus />}
      fields={fields}
      submit={(form) => submitGuest(tripId, form)}
      initialItems={initialGuests}
      onRemove={removeGuest}
      renderRow={(guest, _index, guests, remove) => (
        <GuestRow key={guest.id} guest={rowOf(guest, guests)} onRemove={remove} />
      )}
      banner={(guests) => <WindowBanner guests={guests} />}
      // A-S2: with no common dates there is nothing to plan, so the wizard cannot go on
      nextDisabled={(guests) => noCommonDates(guests) !== null}
      nextHref="destinations"
    />
  );
}
