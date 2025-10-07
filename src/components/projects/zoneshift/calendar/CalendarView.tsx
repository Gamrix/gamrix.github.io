import { useMemo } from "react";
import { Temporal } from "@js-temporal/polyfill";

import { Button } from "@/components/ui/button";
import type { ComputedView, CorePlan } from "@/scripts/projects/zoneshift/model";

interface CalendarViewProps {
  plan: CorePlan;
  computed: ComputedView;
  displayZoneId: string;
  onEditEvent: (eventId: string) => void;
  onEditAnchor: (anchorId: string) => void;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Temporal.ZonedDateTime;
  end?: Temporal.ZonedDateTime;
}

interface CalendarAnchor {
  id: string;
  kind: "wake" | "sleep";
  note?: string;
  zoned: Temporal.ZonedDateTime;
  editable: boolean;
}

const formatTime = (value: Temporal.ZonedDateTime) =>
  value.toPlainTime().toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });

export function CalendarView({
  plan,
  computed,
  displayZoneId,
  onEditEvent,
  onEditAnchor,
}: CalendarViewProps) {
  const editableAnchorIds = useMemo(() => new Set(plan.anchors.map((anchor) => anchor.id)), [plan.anchors]);

  const eventsByDay = useMemo(() => {
    const mapping = new Map<string, CalendarEvent[]>();
    computed.projectedEvents.forEach((event) => {
      try {
        const start = Temporal.ZonedDateTime.from(event.startZoned).withTimeZone(displayZoneId);
        const end = event.endZoned
          ? Temporal.ZonedDateTime.from(event.endZoned).withTimeZone(displayZoneId)
          : undefined;
        const key = start.toPlainDate().toString();
        const bucket = mapping.get(key) ?? [];
        bucket.push({ id: event.id, title: event.title, start, end });
        mapping.set(key, bucket);
      } catch (error) {
        console.error("Failed to project event for calendar view", event.id, error);
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
        const zoned = Temporal.ZonedDateTime.from(anchor.zonedDateTime).withTimeZone(displayZoneId);
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
        console.error("Failed to project anchor for calendar view", anchor.id, error);
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
        const targetDate = Temporal.PlainDate.from(day.dateTargetZone);
        const dayInDisplayZone = Temporal.ZonedDateTime.from({
          timeZone: displayZoneId,
          year: targetDate.year,
          month: targetDate.month,
          day: targetDate.day,
          hour: 0,
          minute: 0,
        });
        const dayKey = dayInDisplayZone.toPlainDate().toString();
        const events = eventsByDay.get(dayKey) ?? [];
        const anchors = anchorsByDay.get(dayKey) ?? [];
        const weekday = dayInDisplayZone.toLocaleString("en-US", { weekday: "short" });
        const dateLabel = dayInDisplayZone.toLocaleString("en-US", { month: "short", day: "numeric" });

        return (
          <article
            key={day.dateTargetZone}
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
                  {day.sleepStartLocal} – {day.sleepEndLocal}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="uppercase tracking-[0.16em]">Wake</dt>
                <dd className="font-medium text-foreground">{day.wakeTimeLocal}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="uppercase tracking-[0.16em]">Bright</dt>
                <dd className="font-medium text-foreground">
                  {day.brightStartLocal} – {day.brightEndLocal}
                </dd>
              </div>
            </dl>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Anchors</h3>
              {anchors.length === 0 ? (
                <p className="text-xs text-muted-foreground">No anchors scheduled.</p>
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
                      {anchor.kind === "wake" ? "Wake" : "Sleep"} @ {formatTime(anchor.zoned)}
                    </span>
                    {anchor.note ? (
                      <span className="ml-2 truncate text-xs text-muted-foreground">{anchor.note}</span>
                    ) : null}
                  </Button>
                ))
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Events</h3>
              {events.length === 0 ? (
                <p className="text-xs text-muted-foreground">No events scheduled.</p>
              ) : (
                events.map((event) => {
                  const startLabel = formatTime(event.start);
                  const endLabel = event.end ? formatTime(event.end) : null;
                  const rangeLabel = endLabel ? `${startLabel} – ${endLabel}` : startLabel;
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
                        <span className="font-medium text-foreground">{event.title}</span>
                        <span className="text-xs text-muted-foreground">{rangeLabel}</span>
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

export default CalendarView;
