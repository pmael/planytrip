"use client";

import { Dialog } from "@base-ui/react/dialog";
import { LoaderCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { FieldErrors } from "@/lib/guestForm";
import { cn } from "@/lib/utils";
import { glassSurface } from "./GlassCard";
import { DateRangeField } from "./DateRangeField";
import { ChoiceField, type Choice } from "./ChoiceField";
import { PillField } from "./PillField";
import { PlaceField } from "./PlaceField";

export type EntryField =
  | {
      type?: "text";
      name: string;
      icon: ReactNode;
      placeholder: string;
      inputMode?: "numeric" | "text";
    }
  /** Start and end date, submitted as `<name>From` and `<name>To`. */
  | { type: "dateRange"; name: string; icon: ReactNode }
  /** A city with suggestions, submitted as `<name>` and `<name>Place`. */
  | { type: "place"; name: string; icon: ReactNode; placeholder: string }
  /** One choice among a few, submitted as `<name>`. `defaultValue` selects one from the start. */
  | { type: "choice"; name: string; icon: ReactNode; label: string; choices: Choice[]; defaultValue?: string };

/** What a submit gives back: the new item, or what is wrong, keyed by field name (`_form` for the whole form). */
export type SubmitResult<T> = { item: T } | { errors: FieldErrors };

const actionButton = "h-[62px] rounded-full border px-9 text-lg text-white transition-colors";

/**
 * The "Add a …" card and the popup it opens, driven entirely by props so every setup step reuses
 * it. `submit` validates and saves (it may be async); the popup stays open and shows the errors
 * until it returns an item, which is handed to `onAdd`. `className` styles the card, which the
 * list moves around.
 */
export function EntryDialog<T>({
  title,
  triggerIcon,
  fields,
  submit,
  onAdd,
  className,
}: {
  title: string;
  triggerIcon: ReactNode;
  fields: EntryField[];
  submit: (form: FormData) => Promise<SubmitResult<T>> | SubmitResult<T>;
  onAdd: (item: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  function clearErrorOf(event: React.SyntheticEvent) {
    const name = (event.target as HTMLElement).closest<HTMLElement>("[data-field]")?.dataset.field;
    if (name && errors[name]) {
      setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== name)));
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setErrors({});
      }}
    >
      <Dialog.Trigger
        className={cn(
          glassSurface,
          "flex h-[400px] w-full flex-col items-center justify-between rounded-[44px] px-6 pb-9 pt-24 text-2xl text-white outline-none transition-[transform,background-color] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.2] focus-visible:ring-2 focus-visible:ring-emerald-300/50 motion-reduce:transition-none lg:w-[368px] lg:shrink-0",
          className,
        )}
      >
        <span className="flex size-[150px] items-center justify-center rounded-full bg-white text-[#0d4a35] [&_svg]:size-[72px] [&_svg]:stroke-[1.5]">
          {triggerIcon}
        </span>
        {title}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/25 backdrop-blur-md transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            glassSurface,
            "fixed top-1/2 left-1/2 z-50 max-h-[94vh] w-[min(1480px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[56px] bg-[#606060]/95 px-[4%] py-10 text-white outline-none transition-[opacity,scale] duration-200 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          )}
        >
          <Dialog.Title className="text-3xl font-normal">{title}</Dialog.Title>

          <form
            noValidate
            className="mt-12 flex min-h-[652px] flex-col gap-8 lg:px-[6%]"
            // Touching a field takes its error away (typing, picking a date, a suggestion or a mode)
            onInput={clearErrorOf}
            onClick={clearErrorOf}
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setPending(true);
              setErrors({});
              try {
                const result = await submit(form);
                if ("errors" in result) {
                  setErrors(result.errors);
                } else {
                  onAdd(result.item);
                  setOpen(false);
                }
              } finally {
                setPending(false);
              }
            }}
          >
            {fields.map((field) => {
              const error = errors[field.name];
              switch (field.type) {
                case "dateRange":
                  return <DateRangeField key={field.name} icon={field.icon} name={field.name} error={error} />;
                case "place":
                  return (
                    <PlaceField key={field.name} icon={field.icon} name={field.name} placeholder={field.placeholder} error={error} />
                  );
                case "choice":
                  return (
                    <ChoiceField
                      key={field.name}
                      icon={field.icon}
                      name={field.name}
                      label={field.label}
                      choices={field.choices}
                      defaultValue={field.defaultValue}
                      error={error}
                    />
                  );
                default:
                  return (
                    <PillField
                      key={field.name}
                      icon={field.icon}
                      name={field.name}
                      inputMode={field.inputMode}
                      placeholder={field.placeholder}
                      error={error}
                    />
                  );
              }
            })}

            <div className="mt-auto flex items-center justify-end gap-6">
              {errors._form && (
                <p role="alert" className="mr-auto animate-[fade-up_0.3s_ease-out_both] text-lg text-rose-200">
                  {errors._form}
                </p>
              )}
              <button
                type="submit"
                disabled={pending}
                className={cn(
                  actionButton,
                  "flex items-center gap-3 border-emerald-200/40 bg-[#6f9f72] hover:bg-[#7db380] disabled:opacity-70",
                )}
              >
                {pending && <LoaderCircle aria-hidden className="size-5 animate-spin" />}
                Enter
              </button>
              <Dialog.Close className={cn(actionButton, "border-rose-200/40 bg-[#a56a6e] hover:bg-[#b87a7e]")}>
                Cancel
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
