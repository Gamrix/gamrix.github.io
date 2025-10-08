import { useMemo, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";

import { Button } from "@/components/ui/button";
import type { ComputedView } from "@/scripts/projects/zoneshift/model";

interface MiniCalendarViewProps {
  computed: ComputedView;
  displayZoneId: string;
  onEditEvent?: (eventId: string) => void;
}

type SegmentType = "sleep" | "bright" | "other";

interface TimeSegment {
  start: number;
  end: number;
  type: SegmentType;
}

interface MiniEvent {
  id: string;
  title: string;
  start: Temporal.ZonedDateTime;
  end?: Temporal.ZonedDateTime;
  summary: string;
}

const MINUTES_IN_DAY = 24 * 60;

const parseLocalTime = (label: string) => {
  if (!label || label === "--:--") {
    return null;
  }
  const [hourString, minuteString] = label.split(":");
  const hour = Number.parseInt(hourString ?? "0", 10);
  const minute = Number.parseInt(minuteString ?? "0", 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }
  return hour * 60 + minute;
};

const getMinutesFromZdt = (value: Temporal.ZonedDateTime) => {
  const midnight = Temporal.ZonedDateTime.from({
    timeZone: value.timeZoneId,
    year: value.year,
    month: value.month,
    day: value.day,
  });
  return value.since(midnight).total({ unit: "minutes" });
};

const carveRange = (segments: TimeSegment[], start: number, end: number, type: SegmentType) => {
  if (end <= start) {
    return segments;
  }
  return segments.flatMap<TimeSegment>((segment) => {
    if (segment.end <= start || segment.start >= end) {
      return segment;
    }
    const slices: TimeSegment[] = [];
    if (segment.start < start) {
      slices.push({ start: segment.start, end: start, type: segment.type });
    }
    slices.push({ start: Math.max(segment.start, start), end: Math.min(segment.end, end), type });
    if (segment.end > end) {
      slices.push({ start: end, end: segment.end, type: segment.type });
    }
    return slices;
  });
};

const applySegment = (segments: TimeSegment[], start: number | null, end: number | null, type: SegmentType) => {
  if (start === null || end === null) {
    return segments;
  }
  if (start === end) {
    return segments;
  }
  if (end < start) {
    let next = carveRange(segments, start, MINUTES_IN_DAY, type);
    next = carveRange(next, 0, end, type);
    return next;
  }
  return carveRange(segments, start, end, type);
};

const colourForSegment = (type: SegmentType) => {
  switch (type) {
    case "sleep":
      return "bg-blue-600";
    case "bright":
      return "bg-yellow-300";
    default:
      return "bg-muted";
  }
};

const formatEventTime = (value: Temporal.ZonedDateTime) =>
  value.toPlainTime().toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });

export function MiniCalendarView({ computed, displayZoneId, onEditEvent }: MiniCalendarViewProps) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const eventsByDay = useMemo(() => {
    const mapping = new Map<string, MiniEvent[]>();
    computed.projectedEvents.forEach((event) => {
      try {
        const start = Temporal.ZonedDateTime.from(event.startZoned).withTimeZone(displayZoneId);
        const end = event.endZoned
          ? Temporal.ZonedDateTime.from(event.endZoned).withTimeZone(displayZoneId)
          : undefined;
        const key = start.toPlainDate().toString();
        const summary = end
          ? `${formatEventTime(start)} → ${formatEventTime(end)}`
          : formatEventTime(start);
        const bucket = mapping.get(key) ?? [];
        bucket.push({ id: event.id, title: event.title, start, end, summary });
        mapping.set(key, bucket);
      } catch (error) {
        console.error("Failed to map event for mini calendar", event.id, error);
      }
    });

    for (const bucket of mapping.values()) {
      bucket.sort((a, b) => Temporal.ZonedDateTime.compare(a.start, b.start));
    }

    return mapping;
  }, [computed.projectedEvents, displayZoneId]);

  const timelineByDay = useMemo(() => {
    return computed.days.map((day) => {
      const sleepStart = parseLocalTime(day.sleepStartLocal);
      const sleepEnd = parseLocalTime(day.sleepEndLocal);
      const brightStart = parseLocalTime(day.brightStartLocal);
      const brightEnd = parseLocalTime(day.brightEndLocal);

      let segments: TimeSegment[] = [{ start: 0, end: MINUTES_IN_DAY, type: "other" }];

      if (sleepStart !== null && sleepEnd !== null) {
        segments = applySegment(segments, sleepStart, sleepEnd, "sleep");
      }

      if (brightStart !== null && brightEnd !== null) {
        segments = applySegment(segments, brightStart, brightEnd, "bright");
      }

      const key = Temporal.PlainDate.from(day.dateTargetZone).toString();
      const events = eventsByDay.get(key) ?? [];
      return { day, segments, events };
    });
  }, [computed.days, eventsByDay]);

  const hourMarkers = useMemo(() => {
    const markers: number[] = [];
    for (let hour = 0; hour <= 24; hour += 4) {
      markers.push(hour);
    }
    return markers;
  }, []);

  if (timelineByDay.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Mini calendar becomes available once you provide plan details.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card/70 p-3 shadow-sm">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-[0.18em]">Mini calendar</span>
          <span>All times shown in {displayZoneId}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="flex gap-4 pb-4">
          {timelineByDay.map(({ day, segments, events }) => {
            const isoDate = Temporal.PlainDate.from(day.dateTargetZone);
            const weekday = isoDate.toLocaleString("en-US", { weekday: "short" });
            const dateLabel = isoDate.toLocaleString("en-US", { month: "short", day: "numeric" });
            const isExpanded = events.some((event) => event.id === expandedEventId);

            return (
              <div key={day.dateTargetZone} className="flex w-28 flex-col items-center gap-2">
                <div className="text-center text-xs text-muted-foreground">
                  <div className="font-semibold text-foreground">{weekday}</div>
                  <div>{dateLabel}</div>
                </div>
                <div
                  className="relative w-12 rounded-lg border border-border/80 bg-card px-3"
                  style={{ height: "min(26rem, 70vh)" }}
                >
                  <div className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 bg-muted" />
                  {hourMarkers.map((hour) => {
                    const minutes = hour * 60;
                    const top = (minutes / MINUTES_IN_DAY) * 100;
                    return (
                      <div
                        key={`${day.dateTargetZone}-grid-${hour}`}
                        className="pointer-events-none absolute inset-x-1 border-t border-border/60"
                        style={{ top: `${top}%` }}
                      >
                        <span className="absolute -right-12 -translate-y-1/2 text-[10px] text-muted-foreground">
                          {String(hour).padStart(2, "0")}:00
                        </span>
                      </div>
                    );
                  })}
                  {segments.map((segment, index) => (
                    <div
                      key={`${segment.type}-${index}-${day.dateTargetZone}`}
                      className={`absolute left-1/2 z-10 w-[6px] -translate-x-1/2 rounded-full ${colourForSegment(segment.type)}`}
                      style={{
                        top: `${(segment.start / MINUTES_IN_DAY) * 100}%`,
                        height: `${((segment.end - segment.start) / MINUTES_IN_DAY) * 100}%`,
                      }}
                    />
                  ))}

                  {events.map((event) => {
                    const minuteOffset = getMinutesFromZdt(event.start);
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() =>
                          setExpandedEventId((prev) => (prev === event.id ? null : event.id))
                        }
                        className={`absolute left-1/2 z-20 h-2 w-2 -translate-x-1/2 rounded-full border border-card shadow-sm ${
                          expandedEventId === event.id ? "bg-primary" : "bg-foreground"
                        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70`}
                        style={{ top: `calc(${(minuteOffset / MINUTES_IN_DAY) * 100}% - 4px)` }}
                        aria-label={`Toggle ${event.title}`}
                      />
                    );
                  })}
                </div>

                <div className="flex w-full flex-col gap-1 text-xs">
                  {events.length === 0 ? (
                    <span className="text-center text-muted-foreground">No events</span>
                  ) : (
                    events.map((event) => (
                      <Button
                        key={event.id}
                        type="button"
                        variant={expandedEventId === event.id ? "default" : "outline"}
                        size="sm"
                        className="justify-between text-[11px]"
                        onClick={() =>
                          setExpandedEventId((prev) => (prev === event.id ? null : event.id))
                        }
                      >
                        <span className="truncate text-left font-medium">{event.title}</span>
                        <span className="ml-2 text-muted-foreground">{event.summary}</span>
                      </Button>
                    ))
                  )}
                </div>

                {isExpanded ? (
                  <div className="w-full rounded-lg border bg-card/80 p-2 text-xs shadow-sm">
                    {events
                      .filter((event) => event.id === expandedEventId)
                      .map((event) => (
                        <div key={event.id} className="space-y-2">
                          <div>
                            <h4 className="text-sm font-semibold text-foreground">{event.title}</h4>
                            <p className="text-muted-foreground">{event.summary}</p>
                          </div>
                          {onEditEvent ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => onEditEvent(event.id)}
                            >
                              Edit event
                            </Button>
                          ) : null}
                        </div>
                      ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default MiniCalendarView;
