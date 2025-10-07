import { useEffect, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./DialogPrimitive";
import type { CorePlan, EventItem } from "@/scripts/projects/zoneshift/model";

interface EventDialogProps {
  plan: CorePlan;
  event: EventItem | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (eventId: string, payload: Partial<EventItem>) => void;
  onRemove: (eventId: string) => void;
}

const toLocalValue = (instantIso: string, zone: string) => {
  const zdt = Temporal.Instant.from(instantIso).toZonedDateTimeISO(zone);
  return zdt.toPlainDateTime().toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });
};

const fromLocalValue = (value: string, zone: string) => {
  const dateTime = Temporal.PlainDateTime.from(value);
  return Temporal.ZonedDateTime.from({
    timeZone: zone,
    year: dateTime.year,
    month: dateTime.month,
    day: dateTime.day,
    hour: dateTime.hour,
    minute: dateTime.minute,
  })
    .toInstant()
    .toString();
};

export function EventDialog({ plan, event, open, onClose, onUpdate, onRemove }: EventDialogProps) {
  const [title, setTitle] = useState("");
  const [zone, setZone] = useState(plan.params.targetZone);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [colorHint, setColorHint] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!event) {
      return;
    }
    setTitle(event.title);
    setZone(event.zone);
    setStart(toLocalValue(event.start, event.zone));
    setEnd(event.end ? toLocalValue(event.end, event.zone) : "");
    setColorHint(event.colorHint);
  }, [event]);

  if (!event) {
    return null;
  }

  const handleSubmit = (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    try {
      const next: Partial<EventItem> = {
        title: title.trim().length > 0 ? title.trim() : event.title,
        zone,
        start: fromLocalValue(start, zone),
      };
      if (end) {
        next.end = fromLocalValue(end, zone);
      } else if (event.end) {
        next.end = undefined;
      }
      next.colorHint = colorHint?.trim() ?? undefined;
      onUpdate(event.id, next);
      onClose();
    } catch (error) {
      console.error("Unable to update event", error);
    }
  };

  const removeEvent = () => {
    onRemove(event.id);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit event</DialogTitle>
            <DialogDescription>Adjust the activity timing in its native timezone.</DialogDescription>
          </DialogHeader>

          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Title
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Timezone
            <select
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {[event.zone, plan.params.homeZone, plan.params.targetZone]
                .filter((value, index, array) => array.indexOf(value) === index)
                .map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
            </select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Starts
              <input
                type="datetime-local"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                required
                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Ends (optional)
              <input
                type="datetime-local"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Color hint (optional)
            <input
              type="text"
              value={colorHint ?? ""}
              onChange={(event) => {
                const value = event.target.value.trim();
                setColorHint(value.length > 0 ? value : undefined);
              }}
              placeholder="peach, blue, etc."
              className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </label>

          <DialogFooter>
            <Button type="submit" size="sm">
              Save changes
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={removeEvent}>
              Remove event
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
