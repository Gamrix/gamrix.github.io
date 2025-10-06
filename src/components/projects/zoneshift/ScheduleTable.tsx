import { Temporal } from "@js-temporal/polyfill";

import { Button } from "@/components/ui/button";
import type { ComputedView } from "@/scripts/projects/zoneshift/model";

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const formatChange = (value: number) => {
  if (Math.abs(value) < 0.05) {
    return "0";
  }
  return value.toFixed(1).replace(/\.0$/, "");
};

const formatDayLabel = (isoDate: string) => {
  const date = Temporal.PlainDate.from(isoDate);
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  const weekday = WEEKDAY[(date.dayOfWeek + 6) % 7];
  return {
    dateLabel: `${month}/${day}`,
    weekday,
  };
};

interface ScheduleTableProps {
  computed: ComputedView;
  displayZoneId: string;
  onEditAnchor?: (anchorId: string) => void;
}

const anchorKindLabel = {
  wake: "Wake anchor",
  sleep: "Sleep anchor",
} as const;

export function ScheduleTable({ computed, displayZoneId, onEditAnchor }: ScheduleTableProps) {
  if (computed.days.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Schedule data becomes available once you provide core plan details.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <table className="w-full border-spacing-0 text-left text-sm">
        <caption className="bg-muted/60 px-6 py-4 text-left text-sm font-medium text-muted-foreground">
          Derived daily sleep, wake, and bright-light guidance.
        </caption>
        <thead className="bg-muted/50 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <tr>
            <th scope="col" className="px-6 py-3 font-medium">Date</th>
            <th scope="col" className="px-6 py-3 font-medium">Shift Δ (h)</th>
            <th scope="col" className="px-6 py-3 font-medium">Sleep Start</th>
            <th scope="col" className="px-6 py-3 font-medium">Sleep End</th>
            <th scope="col" className="px-6 py-3 font-medium">Wake</th>
            <th scope="col" className="px-6 py-3 font-medium">Bright Window</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {computed.days.map((day) => {
            const { dateLabel, weekday } = formatDayLabel(day.dateTargetZone);
            return (
              <tr key={day.dateTargetZone} className="hover:bg-muted/20">
                <td className="px-6 py-4 align-middle">
                  <div className="font-medium text-foreground">{dateLabel}</div>
                  <div className="text-xs text-muted-foreground">{weekday}</div>
                  {day.anchors.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {day.anchors.map((anchor) => {
                        const anchorTime = Temporal.Instant.from(anchor.instant)
                          .toZonedDateTimeISO(displayZoneId)
                          .toPlainTime()
                          .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });
                        return (
                          <div
                            key={anchor.id}
                            className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                          >
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                              {anchorKindLabel[anchor.kind]} @ {anchorTime}
                            </span>
                            {anchor.note ? <span>{anchor.note}</span> : null}
                            {anchor.editable && onEditAnchor ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-auto px-2 py-1 text-[11px]"
                                onClick={() => onEditAnchor(anchor.id)}
                              >
                                Edit anchor
                              </Button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 align-middle font-mono text-sm text-muted-foreground">
                  {formatChange(day.changeThisDayHours)}
                </td>
                <td className="px-6 py-4 align-middle font-mono text-sm">{day.sleepStartLocal}</td>
                <td className="px-6 py-4 align-middle font-mono text-sm">{day.sleepEndLocal}</td>
                <td className="px-6 py-4 align-middle font-mono text-sm">{day.wakeTimeLocal}</td>
                <td className="px-6 py-4 align-middle font-mono text-sm">
                  {day.brightStartLocal === "--:--" || day.brightEndLocal === "--:--"
                    ? "--"
                    : `${day.brightStartLocal} – ${day.brightEndLocal}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
