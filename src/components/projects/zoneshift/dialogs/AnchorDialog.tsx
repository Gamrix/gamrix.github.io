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
import type { WakeAnchor, CorePlan } from "@/scripts/projects/zoneshift/model";

type AnchorDialogProps = {
  plan: CorePlan;
  anchor: WakeAnchor | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (anchorId: string, payload: Partial<WakeAnchor>) => void;
  onRemove: (anchorId: string) => void;
};

const toLocalValue = (instantIso: string, zone: string) => {
  const zdt = Temporal.Instant.from(instantIso).toZonedDateTimeISO(zone);
  return {
    date: zdt.toPlainDate().toString(),
    time: zdt
      .toPlainTime()
      .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 }),
  };
};

const toInstant = (date: string, time: string, zone: string) => {
  const plainDate = Temporal.PlainDate.from(date);
  const plainTime = Temporal.PlainTime.from(time);
  const zoned = Temporal.ZonedDateTime.from({
    timeZone: zone,
    year: plainDate.year,
    month: plainDate.month,
    day: plainDate.day,
    hour: plainTime.hour,
    minute: plainTime.minute,
  });
  return zoned.toInstant().toString();
};

export function AnchorDialog({
  plan,
  anchor,
  open,
  onClose,
  onUpdate,
  onRemove,
}: AnchorDialogProps) {
  const [zone, setZone] = useState(plan.params.endTimeZone);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!anchor) {
      return;
    }
    setZone(anchor.zone);
    const { date: localDate, time: localTime } = toLocalValue(
      anchor.instant,
      anchor.zone
    );
    setDate(localDate);
    setTime(localTime);
    setNote(anchor.note ?? "");
  }, [anchor]);

  if (!anchor) {
    return null;
  }

  const anchorTitle = "Wake Time";
  const anchorLabel = "wake time";

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      onUpdate(anchor.id, {
        zone,
        instant: toInstant(date, time, zone),
        note: note.trim().length > 0 ? note.trim() : undefined,
      });
      onClose();
    } catch (error) {
      console.error(`Failed to update ${anchorLabel}`, error);
    }
  };

  const removeAnchor = () => {
    onRemove(anchor.id);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit {anchorTitle}</DialogTitle>
            <DialogDescription>
              {anchorTitle} entries influence the interpolated wake schedule.
            </DialogDescription>
          </DialogHeader>

          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Timezone
            <select
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {[anchor.zone, plan.params.startTimeZone, plan.params.endTimeZone]
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
              Date
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Time
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                required
                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Note (optional)
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Bright light walk, hydration, etc."
              className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </label>

          <DialogFooter>
            <Button type="submit" size="sm">
              Save {anchorLabel}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={removeAnchor}
            >
              Remove {anchorLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
