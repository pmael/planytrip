"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EntryDialog, type EntryField, type SubmitResult } from "./EntryDialog";
import { EmptyEntryRow } from "./EntryRow";
import { NextLink } from "./NextLink";

/**
 * One setup step: with no entry the "Add a …" card sits in the middle; once one is added it
 * slides to the left, the list appears beside it and a "Next" link shows up. Entries start from
 * `initialItems` (what the server already has) and follow what `submit` and `onRemove` confirm.
 */
export function EntryList<T>({
  title,
  triggerIcon,
  fields,
  submit,
  renderRow,
  initialItems = [],
  onRemove,
  banner,
  nextHref,
  nextDisabled,
}: {
  title: string;
  triggerIcon: ReactNode;
  fields: EntryField[];
  submit: (form: FormData) => Promise<SubmitResult<T>> | SubmitResult<T>;
  /** Draws one row. `remove` is set when entries can be removed; call it to remove this one. */
  renderRow: (item: T, index: number, items: T[], remove?: () => void) => ReactNode;
  initialItems?: T[];
  /** Removes an entry for real (e.g. DELETE); resolve to false to keep it. */
  onRemove?: (item: T) => Promise<boolean | void>;
  /** Shown above the list, from all the entries (e.g. the common window). */
  banner?: (items: T[]) => ReactNode;
  /** Relative to the current step, e.g. "destinations". */
  nextHref: string;
  nextDisabled?: (items: T[]) => boolean;
}) {
  const [items, setItems] = useState<T[]>(initialItems);
  const isEmpty = items.length === 0;

  return (
    <div className="@container mx-auto mt-12 flex w-full max-w-[1500px] flex-col gap-10">
      {banner?.(items)}

      <div className="flex flex-col items-start gap-10 lg:flex-row">
        <EntryDialog
          title={title}
          triggerIcon={triggerIcon}
          fields={fields}
          submit={submit}
          onAdd={(item) => setItems((current) => [...current, item])}
          className={cn(isEmpty && "lg:translate-x-[calc(50cqw_-_50%)]")}
        />
        {!isEmpty && (
          <ul className="flex w-full flex-col gap-8 lg:flex-1">
            {items.map((item, index) =>
              renderRow(
                item,
                index,
                items,
                onRemove &&
                  (async () => {
                    if ((await onRemove(item)) === false) return;
                    setItems((current) => current.filter((other) => other !== item));
                  }),
              ),
            )}
            <EmptyEntryRow />
          </ul>
        )}
      </div>

      {!isEmpty && <NextLink href={nextHref} disabled={nextDisabled?.(items)} className="self-end" />}
    </div>
  );
}
