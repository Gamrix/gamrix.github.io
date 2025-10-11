import { useMemo } from "react";
import { Temporal } from "@js-temporal/polyfill";

import { Button } from "@/components/ui/button";
import type {
  ComputedView,
  CorePlan,
} from "@/scripts/projects/zoneshift/model";
import { formatRangeLabel } from "../utils/timeSegments";

type CalendarListViewProps = {
  plan: CorePlan;
  computed: ComputedView;
  displayZoneId: string;
  onEditEvent: (eventId: string) => void;
  onEditAnchor: (anchorId: string) => void;
};

type CalendarEvent = {
  id: string;
  title: string;
  start: Temporal.ZonedDateTime;
  end?: Temporal.ZonedDateTime;
};

type CalendarAnchor = {
  id: string;
  kind: "wake" | "sleep";
  note?: string;
  zoned: Temporal.ZonedDateTime;
  editable: boolean;
};

export function CalendarListView({
  plan,
  computed,
  displayZoneId,
  onEditEvent,
  onEditAnchor,
}: CalendarListViewProps) {
  const editableAnchorIds = useMemo(
    () => new Set(plan.anchors.map((anchor) => anchor.id)),
    [plan.anchors]
  );

  const eventsByDay = useMemo(() => {
    const mapping = new Map<string, CalendarEvent[]>();
    computed.projectedEvents.forEach((event) => {
      try {
        const start = event.startZoned.withTimeZone(displayZoneId);
        const end = event.endZoned
          ? event.endZoned.withTimeZone(displayZoneId)
          : undefined;
        const key = start.toPlainDate().toString();
        const bucket = mapping.get(key) ?? [];
        bucket.push({ id: event.id, title: event.title, start, end });
        mapping.set(key, bucket);
      } catch (error) {
        console.error(
          "Failed to project event for calendar list",
          event.id,
          error
        );
      }
    });

    for (const bucket of mapping.values()) {
      bucket.sort((a, b) => Temporal.ZonedDateTime.compare(a.start, b.start));
    }

    return mapping;
  }, [computed.projectedEvents, displayZoneId]);

  const anchorsByDay = useMemo(() => {
    const mapping = new Map<string, CalendarAnchor[]>();
    computed.projectedAnchors.forEach((anchor) => {
      try {
        const zoned = anchor.zonedDateTime.withTimeZone(displayZoneId);
        const key = zoned.toPlainDate().toString();
        const bucket = mapping.get(key) ?? [];
        bucket.push({
          id: anchor.id,
          kind: anchor.kind,
          note: anchor.note,
          zoned,
          editable: editableAnchorIds.has(anchor.id),
        });
        mapping.set(key, bucket);
      } catch (error) {
        console.error(
          "Failed to project anchor for calendar list",
          anchor.id,
          error
        );
      }
    });

    for (const bucket of mapping.values()) {
      bucket.sort((a, b) => Temporal.ZonedDateTime.compare(a.zoned, b.zoned));
    }

    return mapping;
  }, [computed.projectedAnchors, displayZoneId, editableAnchorIds]);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {computed.days.map((day) => {
        const wakeDate = day.wakeDisplayDate;
        const dayKey = wakeDate.toString();
        const events = eventsByDay.get(dayKey) ?? [];
        const anchors = anchorsByDay.get(dayKey) ?? [];
        const weekday = wakeDate.toLocaleString("en-US", { weekday: "short" });
        const dateLabel = wakeDate.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
        });

        return (
          <article
            key={day.wakeInstant.toString()}
            className="flex h-full flex-col gap-4 rounded-lg border bg-card/70 p-4 shadow-sm"
          >
            <header className="flex items-baseline justify-between text-sm text-foreground">
              <span className="font-semibold">{weekday}</span>
              <span className="text-muted-foreground">{dateLabel}</span>
            </header>

            <dl className="grid gap-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <dt className="uppercase tracking-[0.16em]">Sleep</dt>
                <dd className="font-medium text-foreground">
                  {formatRangeLabel(day.sleepStartZoned, day.sleepEndZoned)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="uppercase tracking-[0.16em]">Wake</dt>
                <dd className="font-medium text-foreground">
                  {day.wakeTimeLocal}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="uppercase tracking-[0.16em]">Bright</dt>
                <dd className="font-medium text-foreground">
                  {formatRangeLabel(day.brightStartZoned, day.brightEndZoned)}
                </dd>
              </div>
            </dl>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Wake Times
              </h3>
              {anchors.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No wake times scheduled.
                </p>
              ) : (
                anchors.map((anchor) => (
                  <Button
                    key={anchor.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-between text-left"
                    onClick={() => onEditAnchor(anchor.id)}
                    disabled={!anchor.editable}
                  >
                    <span className="font-medium text-foreground">
                      {anchor.kind === "wake" ? "Wake time" : "Sleep time"} @
                      {anchor.zoned
                        .toPlainTime()
                        .toString({
                          smallestUnit: "minute",
                          fractionalSecondDigits: 0,
                        })}
                    </span>
                    {anchor.note ? (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {anchor.note}
                      </span>
                    ) : null}
                  </Button>
                ))
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Events
              </h3>
              {events.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No events scheduled.
                </p>
              ) : (
                events.map((event) => {
                  const startLabel = event.start
                    .toPlainTime()
                    .toString({
                      smallestUnit: "minute",
                      fractionalSecondDigits: 0,
                    });
                  const endLabel = event.end
                    ? event.end
                        .toPlainTime()
                        .toString({
                          smallestUnit: "minute",
                          fractionalSecondDigits: 0,
                        })
                    : null;
                  const rangeLabel = endLabel
                    ? formatRangeLabel(
                        event.start.toString({
                          smallestUnit: "minute",
                          fractionalSecondDigits: 0,
                        }),
                        event.end.toString({
                          smallestUnit: "minute",
                          fractionalSecondDigits: 0,
                        }),
                        { separator: " → " }
                      )
                    : startLabel;
                  return (
                    <Button
                      key={event.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-left"
                      onClick={() => onEditEvent(event.id)}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {event.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {rangeLabel}
                        </span>
                      </div>
                    </Button>
                  );
                })
              )}
            </section>
          </article>
        );
      })}
    </div>
  );
}

export default CalendarListView;
