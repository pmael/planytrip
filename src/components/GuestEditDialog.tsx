"use client";

import { Dialog } from "@base-ui/react/dialog";
import { BusFront, CarFront, Plane, TramFront, X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { TRANSPORT_MODES, type TransportMode } from "@/core/types";
import { MODE_LABELS } from "@/lib/reachabilityText";
import { cn } from "@/lib/utils";
import type { DeliberationGuest } from "@/server/services/deliberation";
import { glassSurface } from "./GlassCard";

const MODE_ICONS: Record<TransportMode, ReactNode> = { plane: <Plane />, train: <TramFront />, bus: <BusFront />, car: <CarFront /> };

export const inputClass =
  "h-[60px] w-full rounded-full border border-white/25 bg-white/[0.14] px-6 text-xl text-white placeholder:text-white/50 outline-none transition-colors focus-visible:border-emerald-200/60 focus-visible:ring-2 focus-visible:ring-emerald-300/50 [color-scheme:dark]";

/** What was changed, so the page knows whether the fares must be searched again. */
export type GuestEdit = { needsRecompute: boolean };

type Errors = Partial<Record<"name" | "budget" | "dates" | "modes" | "_form", string>>;

/** The first message the server gave for each field of the form. */
function errorsFromBody(body: { fieldErrors?: Record<string, string[]> }): Errors {
  const field = body.fieldErrors ?? {};
  return {
    name: field.name?.[0],
    budget: field.maxBudgetEur?.[0],
    dates: field.availableFrom?.[0] ?? field.availableTo?.[0],
    modes: field.modes?.[0],
    ...(Object.keys(field).length === 0 && { _form: "Something went wrong, please try again." }),
  };
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="px-3 text-lg text-white/70">{label}</span>
      {children}
      {error && (
        <span role="alert" className="px-3 text-base text-rose-200">
          {error}
        </span>
      )}
    </label>
  );
}

function EditForm({ guest, onSaved, onClose }: { guest: DeliberationGuest; onSaved: (edit: GuestEdit) => void; onClose: () => void }) {
  const [name, setName] = useState(guest.name);
  const [budget, setBudget] = useState(String(guest.maxBudgetEur));
  const [from, setFrom] = useState(guest.availableFrom);
  const [to, setTo] = useState(guest.availableTo);
  const [modes, setModes] = useState<TransportMode[]>(guest.modes);
  const [preferred, setPreferred] = useState<TransportMode>(guest.preferredMode);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  function toggleMode(mode: TransportMode) {
    if (mode === preferred) return;
    setModes((current) => (current.includes(mode) ? current.filter((m) => m !== mode) : [...current, mode]));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: Errors = {};
    const amount = Number(budget);
    if (name.trim() === "") found.name = "Required";
    if (!Number.isInteger(amount) || amount <= 0) found.budget = "Enter a whole number of euros";
    if (!from || !to) found.dates = "Pick both dates";
    else if (to < from) found.dates = "The end date can't be before the start date";
    if (Object.keys(found).length > 0) return setErrors(found);

    const sameModes = modes.length === guest.modes.length && modes.every((mode) => guest.modes.includes(mode));
    const patch = {
      ...(name.trim() !== guest.name && { name: name.trim() }),
      ...(amount !== guest.maxBudgetEur && { maxBudgetEur: amount }),
      ...(from !== guest.availableFrom && { availableFrom: from }),
      ...(to !== guest.availableTo && { availableTo: to }),
      ...(preferred !== guest.preferredMode && { preferredMode: preferred }),
    };

    setSaving(true);
    setErrors({});
    try {
      if (Object.keys(patch).length > 0) {
        const response = await fetch(`/api/guests/${guest.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
        if (response.status === 400) return setErrors(errorsFromBody(await response.json()));
        if (!response.ok) throw new Error(`Guest answered ${response.status}`);
      }
      if (!sameModes) {
        const response = await fetch(`/api/guests/${guest.id}/modes`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ modes }) });
        if (response.status === 400) return setErrors(errorsFromBody(await response.json()));
        if (!response.ok) throw new Error(`Modes answered ${response.status}`);
      }
      onSaved({ needsRecompute: "availableFrom" in patch || "availableTo" in patch || "preferredMode" in patch || !sameModes });
      onClose();
    } catch {
      setErrors({ _form: "Couldn’t save, please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5">
      <Field label="Name" error={errors.name}>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="off" />
      </Field>
      <Field label="Maximum budget (€)" error={errors.budget}>
        <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="numeric" className={inputClass} autoComplete="off" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Available from" error={errors.dates}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Available until">
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="px-3 text-lg text-white/70">Ways of travelling they accept</legend>
        <div className="flex flex-wrap gap-3">
          {TRANSPORT_MODES.map((mode) => {
            const on = modes.includes(mode);
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={on}
                onClick={() => toggleMode(mode)}
                title={mode === preferred ? "Their preferred mode is always accepted" : undefined}
                className={cn(
                  "flex h-[54px] cursor-pointer items-center gap-2.5 rounded-full border px-5 text-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-300/60 [&_svg]:size-5 [&_svg]:stroke-[1.5]",
                  on ? "border-emerald-200/60 bg-[#3f7a62]/80" : "border-white/20 bg-white/[0.1] text-white/70 hover:bg-white/[0.18]",
                  mode === preferred && "cursor-default",
                )}
              >
                {MODE_ICONS[mode]}
                {MODE_LABELS[mode]}
              </button>
            );
          })}
        </div>
        {errors.modes && (
          <span role="alert" className="px-3 text-base text-rose-200">
            {errors.modes}
          </span>
        )}
      </fieldset>

      <Field label="Preferred">
        <select value={preferred} onChange={(e) => setPreferred(e.target.value as TransportMode)} className={cn(inputClass, "cursor-pointer")}>
          {modes.map((mode) => (
            <option key={mode} value={mode} className="bg-[#3a3a3a]">
              {MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </Field>

      {errors._form && (
        <p role="alert" className="text-lg text-rose-200">
          {errors._form}
        </p>
      )}
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="h-[54px] cursor-pointer rounded-full border border-white/25 bg-white/[0.12] px-7 text-xl outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-emerald-300/60">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="h-[54px] cursor-pointer rounded-full border border-emerald-200/50 bg-[#3f7a62]/85 px-8 text-xl outline-none transition-colors hover:bg-[#4a8a70] focus-visible:ring-2 focus-visible:ring-emerald-300/60 disabled:cursor-wait disabled:opacity-70"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

/** Changes a guest's name, budget, dates and the ways of travelling they accept. Where they live is not changed here: that is a new departure place, so a new setup. */
export function GuestEditDialog({ guest, onSaved, onClose }: { guest: DeliberationGuest | null; onSaved: (edit: GuestEdit) => void; onClose: () => void }) {
  return (
    <Dialog.Root open={guest !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/25 backdrop-blur-md transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            glassSurface,
            "fixed top-1/2 left-1/2 z-50 max-h-[92vh] w-[min(640px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[40px] bg-[#606060]/95 p-9 text-white outline-none transition-[opacity,scale] duration-200 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-3xl font-normal">Edit {guest?.name}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/15 outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-emerald-300/60">
              <X aria-hidden className="size-6" />
            </Dialog.Close>
          </div>
          {guest && <EditForm key={guest.id} guest={guest} onSaved={onSaved} onClose={onClose} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
