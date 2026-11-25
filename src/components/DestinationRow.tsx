import { Calendar, CreditCard, Goal, MapPin } from "lucide-react";
import { Divider, EntryRow, ValuePill, type Tone } from "./EntryRow";

export type DestinationRowData = {
  place: string;
  /** False when the destination is outside Europe: computed for reference only */
  inScope: boolean;
  budget: string;
  objective: string;
  dates: string;
  datesTone: Tone;
};

export function DestinationRow({
  destination,
  onRemove,
}: {
  destination: DestinationRowData;
  onRemove?: () => void;
}) {
  return (
    <EntryRow
      onRemove={onRemove}
      removeLabel={`Remove ${destination.place}`}
      badge={destination.inScope ? undefined : <span title="Computed for reference only">Outside Europe</span>}
    >
      <span className="flex min-w-0 flex-1 items-center gap-4 [&_svg]:size-7 [&_svg]:shrink-0">
        <MapPin aria-hidden />
        <span className="truncate" title={destination.place}>
          {destination.place}
        </span>
      </span>
      <Divider />
      <ValuePill className="w-[230px]" icon={<CreditCard />} tone="neutral">
        {destination.budget}
      </ValuePill>
      <Divider />
      <ValuePill className="w-[200px]" icon={<Goal />} tone="neutral">
        {destination.objective}
      </ValuePill>
      <Divider />
      <ValuePill className="w-[266px]" icon={<Calendar />} tone={destination.datesTone}>
        {destination.dates}
      </ValuePill>
    </EntryRow>
  );
}
