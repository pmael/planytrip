import { Calendar, CreditCard, House, Luggage, User } from "lucide-react";
import { Divider, EntryRow, TextSegment, ValuePill, type Tone } from "./EntryRow";

export type GuestRowData = {
  name: string;
  city: string;
  budget: string;
  budgetTone: Tone;
  dates: string;
  datesTone: Tone;
  mode: string;
};

export function GuestRow({ guest, onRemove }: { guest: GuestRowData; onRemove?: () => void }) {
  return (
    <EntryRow onRemove={onRemove} removeLabel={`Remove ${guest.name}`}>
      <TextSegment className="w-[150px]" icon={<User />}>
        {guest.name}
      </TextSegment>
      <Divider />
      <TextSegment className="w-[150px]" icon={<House />}>
        {guest.city}
      </TextSegment>
      <Divider />
      <ValuePill className="w-[182px]" icon={<CreditCard />} tone={guest.budgetTone}>
        {guest.budget}
      </ValuePill>
      <Divider />
      <ValuePill className="w-[266px]" icon={<Calendar />} tone={guest.datesTone}>
        {guest.dates}
      </ValuePill>
      <Divider />
      <TextSegment className="w-[130px]" icon={<Luggage />}>
        {guest.mode}
      </TextSegment>
    </EntryRow>
  );
}
