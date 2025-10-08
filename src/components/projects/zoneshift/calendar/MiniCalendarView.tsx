import { Fragment, useMemo, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";

import { Button } from "@/components/ui/button";
import type { ComputedView } from "@/scripts/projects/zoneshift/model";

interface MiniCalendarViewProps {
  computed: ComputedView;
  displayZoneId: string;
  onEditEvent?: (eventId: string) => void;
  onOpenPlanSettings?: () => void;
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

interface MiniAnchor {
  id: string;
  minuteOffset: number;
  label: string;
}

const MINUTES_IN_DAY = 24 * 60;
const TIMELINE_HEIGHT = "min(26rem, 70vh)";
const HEADER_HEIGHT = "2.5rem";
const AXIS_WIDTH = "clamp(2.25rem, 12vw, 3.5rem)";
const TOTAL_HEIGHT = `calc(${TIMELINE_HEIGHT} + ${HEADER_HEIGHT})`;

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

export function MiniCalendarView({
  computed,
  displayZoneId,
  onEditEvent,
  onOpenPlanSettings,
}: MiniCalendarViewProps) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);

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

      const wakeAnchors: MiniAnchor[] = day.anchors
        .filter((anchor) => anchor.kind === "wake")
        .map((anchor) => {
          try {
            const zdt = Temporal.Instant.from(anchor.instant).toZonedDateTimeISO(displayZoneId);
            const minutes = getMinutesFromZdt(zdt);
            return {
              id: anchor.id,
              minuteOffset: minutes,
              label: zdt
                .toPlainTime()
                .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 }),
            } satisfies MiniAnchor;
          } catch (error) {
            console.error("Failed to project wake anchor for mini calendar", anchor.id, error);
            return null;
          }
        })
        .filter((item): item is MiniAnchor => item !== null);

      const key = Temporal.PlainDate.from(day.dateTargetZone).toString();
      const events = eventsByDay.get(key) ?? [];
      return { day, segments, events, wakeAnchors };
    });
  }, [computed.days, eventsByDay, displayZoneId]);

  const hourMarkers = useMemo(() => {
    const markers: number[] = [];
    for (let hour = 0; hour <= 24; hour += 2) {
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

  const DAYS_PER_PAGE = 7;
  const startIndex = pageIndex * DAYS_PER_PAGE;
  const visibleTimeline = timelineByDay.slice(startIndex, startIndex + DAYS_PER_PAGE);
  const hasPrevious = startIndex > 0;
  const hasNext = startIndex + DAYS_PER_PAGE < timelineByDay.length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card/70 p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="font-semibold uppercase tracking-[0.18em]">Mini calendar</span>
            <span className="text-muted-foreground">All times in {displayZoneId}</span>
          </div>
          <div className="flex items-center gap-2">
            {onOpenPlanSettings ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={onOpenPlanSettings}
              >
                Edit plan settings
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
              disabled={!hasPrevious}
            >
              Prev 7 days
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() =>
                setPageIndex((prev) =>
                  hasNext ? Math.min(prev + 1, Math.ceil(timelineByDay.length / DAYS_PER_PAGE) - 1) : prev,
                )
              }
              disabled={!hasNext}
            >
              Next 7 days
            </Button>
          </div>
        </div>
      </div>
      <div className="rounded-lg border bg-card/80 p-3 shadow-sm">
        <div
          className="grid"
          style={{ gridTemplateColumns: `${AXIS_WIDTH} 1fr`, height: TOTAL_HEIGHT }}
        >
          <div
            className="flex flex-col items-end text-[10px] text-muted-foreground"
            style={{ width: AXIS_WIDTH, minWidth: AXIS_WIDTH, height: TOTAL_HEIGHT }}
          >
            <div className="h-10" />
            <div className="relative w-full" style={{ height: TIMELINE_HEIGHT }}>
              {hourMarkers.map((hour) => {
                const minutes = hour * 60;
                const topPercent = (minutes / MINUTES_IN_DAY) * 100;
                return (
                  <div
                    key={`axis-${hour}`}
                    className="absolute right-0 flex -translate-y-1/2 items-center gap-1"
                    style={{ top: `${topPercent}%` }}
                  >
                    <div className="h-px w-4 bg-border/70" />
                    {hour % 4 === 0 ? (
                      <span>{String(hour).padStart(2, "0")}:00</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="relative" style={{ height: TOTAL_HEIGHT }}>
            <div
              className="pointer-events-none absolute left-0 right-0"
              style={{ top: HEADER_HEIGHT, bottom: 0 }}
            >
              {hourMarkers.map((hour) => {
                const minutes = hour * 60;
                const topPercent = (minutes / MINUTES_IN_DAY) * 100;
                return (
                  <div
                    key={`grid-${hour}`}
                    className="absolute left-0 right-0 border-t border-border/50"
                    style={{ top: `${topPercent}%` }}
                  />
                );
              })}
            </div>
            <div className="absolute left-0 right-0 top-0 bottom-0 flex flex-col">
              <div className="flex-1 overflow-x-auto pt-2">
                <div className="flex h-full gap-4">
                  {visibleTimeline.map(({ day, segments, events, wakeAnchors }) => {
                    const isoDate = Temporal.PlainDate.from(day.dateTargetZone);
                    const weekday = isoDate.toLocaleString("en-US", { weekday: "short" });
                    const dateLabel = isoDate.toLocaleString("en-US", { month: "short", day: "numeric" });

                    return (
                      <div key={day.dateTargetZone} className="relative h-full w-28">
                        <div className="absolute inset-x-0 top-0 flex h-10 flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
                          <div className="font-semibold text-foreground">{weekday}</div>
                          <div>{dateLabel}</div>
                        </div>
                        <div className="absolute inset-x-0 bottom-0 top-10">
                          <div className="relative h-full w-full overflow-visible">
                            <div className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 bg-border" />
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

                            {wakeAnchors.map((anchor) => (
                              <div
                                key={anchor.id}
                                className="absolute left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 text-[10px] font-medium text-emerald-500"
                                style={{ top: `${(anchor.minuteOffset / MINUTES_IN_DAY) * 100}%` }}
                              >
                                <div className="flex -translate-y-1 items-center gap-2">
                                  <div className="h-4 w-4 rounded-full border-2 border-emerald-400 bg-card shadow-sm" />
                                  <span>{anchor.label}</span>
                                </div>
                              </div>
                            ))}

                            {events.map((event) => {
                              const minuteOffset = getMinutesFromZdt(event.start);
                              const topPercent = (minuteOffset / MINUTES_IN_DAY) * 100;
                              const isActive = expandedEventId === event.id;

                              return (
                                <Fragment key={event.id}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedEventId((prev) => (prev === event.id ? null : event.id))
                                    }
                                    className={`absolute left-1/2 z-20 h-4 w-4 -translate-x-1/2 rounded-full border border-card shadow-sm ${
                                      isActive ? "bg-primary" : "bg-foreground"
                                    } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70`}
                                    style={{ top: `calc(${topPercent}% - 8px)` }}
                                    aria-label={`Toggle ${event.title}`}
                                  />
                                  {isActive ? (
                                    <div
                                      className="absolute left-1/2 z-30 w-48 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-card/95 p-3 text-xs shadow-lg"
                                      style={{ top: `calc(${topPercent}% - 12px)` }}
                                    >
                                      <div className="font-semibold text-foreground">{event.title}</div>
                                      <p className="text-muted-foreground">{event.summary}</p>
                                      {onEditEvent ? (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          className="mt-2"
                                          onClick={() => onEditEvent(event.id)}
                                        >
                                          Edit event
                                        </Button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </Fragment>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MiniCalendarView;
