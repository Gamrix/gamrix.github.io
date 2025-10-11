import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  FormEvent as ReactFormEvent,
} from "react";
import { Temporal } from "@js-temporal/polyfill";

import { Button } from "@/components/ui/button";
import type {
  ComputedView,
  CorePlan,
} from "@/scripts/projects/zoneshift/model";
import { minutesSinceStartOfDay, rangeDaySuffix } from "../utils/timeSegments";

const PIXELS_PER_MINUTE = 2;
const CALENDAR_MINUTES = 24 * 60;
const CALENDAR_HEIGHT = CALENDAR_MINUTES * PIXELS_PER_MINUTE;
const VIRTUAL_PADDING_MINUTES = 120;

type TimelineProps = {
  plan: CorePlan;
  computed: ComputedView;
  displayZoneId: string;
  timeStepMinutes: number;
  onEditEvent: (eventId: string) => void;
  onEditAnchor: (anchorId: string) => void;
  onEventChange: (
    eventId: string,
    payload: {
      start: Temporal.ZonedDateTime;
      end?: Temporal.ZonedDateTime;
      zone: string;
    }
  ) => void;
  onAnchorChange: (
    anchorId: string,
    payload: { instant: Temporal.ZonedDateTime; zone: string }
  ) => void;
  onAddAnchor: (payload: {
    kind: "wake" | "sleep";
    zoned: Temporal.ZonedDateTime;
    zone: string;
  }) => void;
  onAddEvent: (payload: {
    title: string;
    start: Temporal.ZonedDateTime;
    end?: Temporal.ZonedDateTime;
    zone: string;
  }) => void;
};

type TimelineAnchor = {
  id: string;
  kind: "wake" | "sleep";
  note?: string;
  zone: string;
  zoned: Temporal.ZonedDateTime;
  editable: boolean;
};

type TimelineEvent = {
  id: string;
  title: string;
  start: Temporal.ZonedDateTime;
  end?: Temporal.ZonedDateTime;
  zone: string;
  conflict: boolean;
};

type DragStateBase = {
  pointerId: number;
  startClientY: number;
  lastDelta: number;
};

type EventDragState = DragStateBase & {
  type: "event" | "event-resize-start" | "event-resize-end";
  id: string;
  zone: string;
  originalStart: Temporal.ZonedDateTime;
  originalEnd?: Temporal.ZonedDateTime;
};

type AnchorDragState = DragStateBase & {
  type: "anchor";
  id: string;
  zone: string;
  originalInstant: Temporal.ZonedDateTime;
};

type DragState = EventDragState | AnchorDragState | null;

type VisibleRanges = Record<string, { start: number; end: number }>;

type ContextMenuState =
  | { visible: false }
  | {
      visible: true;
      isoDate: string;
      clientX: number;
      clientY: number;
      minuteOffset: number;
    };

type EventComposerState =
  | { visible: false }
  | {
      visible: true;
      isoDate: string;
      clientX: number;
      clientY: number;
      start: string;
      end: string;
      title: string;
    };

const setPointerCaptureSafe = (event: ReactPointerEvent<Element>) => {
  const target = event.currentTarget as Element & {
    setPointerCapture?: (pointerId: number) => void;
  };
  if (typeof target.setPointerCapture === "function") {
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // jsdom does not implement setPointerCapture
    }
  }
};

const releasePointerCaptureSafe = (event: ReactPointerEvent<Element>) => {
  const target = event.currentTarget as Element & {
    releasePointerCapture?: (pointerId: number) => void;
  };
  if (typeof target.releasePointerCapture === "function") {
    try {
      target.releasePointerCapture(event.pointerId);
    } catch {
      // jsdom does not implement releasePointerCapture
    }
  }
};

const clampMinutes = (minutes: number) => {
  if (minutes < 0) {
    return 0;
  }
  if (minutes > CALENDAR_MINUTES) {
    return CALENDAR_MINUTES;
  }
  return minutes;
};

const formatMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const remainder = Math.floor(minutes % 60)
    .toString()
    .padStart(2, "0");
  return `${hours}:${remainder}`;
};

export function Timeline({
  plan,
  computed,
  displayZoneId,
  timeStepMinutes,
  onEditEvent,
  onEditAnchor,
  onEventChange,
  onAnchorChange,
  onAddAnchor,
  onAddEvent,
}: TimelineProps) {
  const [dragState, setDragState] = useState<DragState>(null);
  const [visibleRanges, setVisibleRanges] = useState<VisibleRanges>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
  });
  const [eventComposer, setEventComposer] = useState<EventComposerState>({
    visible: false,
  });
  const [eventComposerError, setEventComposerError] = useState<string | null>(
    null
  );
  const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const eventsByDay = useMemo(() => {
    const mapping = new Map<string, TimelineEvent[]>();
    const daySleepWindows = new Map<
      string,
      { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime }
    >();
    computed.days.forEach((day) => {
      const sleepStart = day.sleepStartZoned.withTimeZone(displayZoneId);
      const sleepEnd = day.sleepEndZoned.withTimeZone(displayZoneId);
      const entry = { start: sleepStart, end: sleepEnd };
      daySleepWindows.set(day.wakeDisplayDate.toString(), entry);
      daySleepWindows.set(sleepStart.toPlainDate().toString(), entry);
      daySleepWindows.set(sleepEnd.toPlainDate().toString(), entry);
    });

    computed.projectedEvents.forEach((event) => {
      try {
        const start = event.startZoned.withTimeZone(displayZoneId);
        const end = event.endZoned
          ? event.endZoned.withTimeZone(displayZoneId)
          : undefined;
        const key = start.toPlainDate().toString();
        const bucket = mapping.get(key) ?? [];
        const sleepWindow = daySleepWindows.get(key);
        let conflict = false;
        if (sleepWindow) {
          const eventStart = start.toInstant();
          const eventEnd = end?.toInstant() ?? start.toInstant();
          const sleepStart = sleepWindow.start.toInstant();
          const sleepEnd = sleepWindow.end.toInstant();
          conflict =
            Temporal.Instant.compare(eventStart, sleepEnd) < 0 &&
            Temporal.Instant.compare(eventEnd, sleepStart) > 0;
        }
        bucket.push({
          id: event.id,
          title: event.title,
          start,
          end,
          zone: event.zone,
          conflict,
        });
        mapping.set(key, bucket);
      } catch (error) {
        console.error("Failed to project event for timeline", event.id, error);
      }
    });
    return mapping;
  }, [computed.days, computed.projectedEvents, displayZoneId]);

  const editableAnchors = useMemo(() => {
    const anchorIds = new Set(plan.anchors.map((anchor) => anchor.id));
    return computed.projectedAnchors
      .filter((anchor) => anchorIds.has(anchor.id))
      .map<TimelineAnchor | null>((anchor) => {
        try {
          const zoned = anchor.zonedDateTime.withTimeZone(displayZoneId);
          const original = plan.anchors.find((item) => item.id === anchor.id);
          if (!original) {
            return null;
          }
          return {
            id: anchor.id,
            kind: original.kind,
            note: original.note,
            zone: original.zone,
            zoned,
            editable: true,
          } satisfies TimelineAnchor;
        } catch (error) {
          console.error(
            "Failed to project anchor for timeline",
            anchor.id,
            error
          );
          return null;
        }
      })
      .filter((value): value is TimelineAnchor => value !== null);
  }, [computed.projectedAnchors, displayZoneId, plan.anchors]);

  const anchorsByDay = useMemo(() => {
    const mapping = new Map<string, TimelineAnchor[]>();
    editableAnchors.forEach((anchor) => {
      const key = anchor.zoned.toPlainDate().toString();
      const bucket = mapping.get(key) ?? [];
      bucket.push(anchor);
      mapping.set(key, bucket);
    });
    return mapping;
  }, [editableAnchors]);

  const calendarDays = useMemo(
    () => computed.days.map((day) => day.wakeInstant.toString()),
    [computed.days]
  );

  const roundDelta = useCallback(
    (minutes: number) => {
      if (timeStepMinutes <= 1) {
        return minutes;
      }
      return Math.round(minutes / timeStepMinutes) * timeStepMinutes;
    },
    [timeStepMinutes]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>) => {
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }
      const deltaPixels = event.clientY - dragState.startClientY;
      const rawDeltaMinutes = deltaPixels / PIXELS_PER_MINUTE;
      const deltaMinutes = roundDelta(rawDeltaMinutes);
      if (deltaMinutes === dragState.lastDelta) {
        return;
      }

      if (
        dragState.type === "event" ||
        dragState.type === "event-resize-start" ||
        dragState.type === "event-resize-end"
      ) {
        let nextStartDisplay = dragState.originalStart;
        let nextEndDisplay = dragState.originalEnd;

        if (dragState.type === "event") {
          nextStartDisplay = dragState.originalStart.add({
            minutes: deltaMinutes,
          });
          nextEndDisplay = dragState.originalEnd?.add({
            minutes: deltaMinutes,
          });
        } else if (dragState.type === "event-resize-start") {
          const proposed = dragState.originalStart.add({
            minutes: deltaMinutes,
          });
          if (
            !nextEndDisplay ||
            Temporal.Instant.compare(
              proposed.toInstant(),
              nextEndDisplay.toInstant()
            ) < 0
          ) {
            nextStartDisplay = proposed;
          }
        } else if (dragState.type === "event-resize-end" && nextEndDisplay) {
          const proposed = nextEndDisplay.add({ minutes: deltaMinutes });
          if (
            Temporal.Instant.compare(
              proposed.toInstant(),
              dragState.originalStart.toInstant()
            ) > 0
          ) {
            nextEndDisplay = proposed;
          }
        }

        const startInZone = nextStartDisplay.withTimeZone(dragState.zone);
        const endInZone = nextEndDisplay?.withTimeZone(dragState.zone);
        onEventChange(dragState.id, {
          start: startInZone,
          end: endInZone,
          zone: dragState.zone,
        });
      } else {
        const nextInstantDisplay = dragState.originalInstant.add({
          minutes: deltaMinutes,
        });
        const instantInZone = nextInstantDisplay.withTimeZone(dragState.zone);
        onAnchorChange(dragState.id, {
          instant: instantInZone,
          zone: dragState.zone,
        });
      }

      setDragState((prev) =>
        prev ? { ...prev, lastDelta: deltaMinutes } : prev
      );
    },
    [dragState, onEventChange, onAnchorChange, roundDelta]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>) => {
      if (dragState && event.pointerId === dragState.pointerId) {
        setDragState(null);
        releasePointerCaptureSafe(event);
      }
    },
    [dragState]
  );

  const beginEventDrag = useCallback(
    (
      pointerEvent: React.PointerEvent<HTMLButtonElement>,
      item: TimelineEvent
    ) => {
      setPointerCaptureSafe(pointerEvent);
      setDragState({
        type: "event",
        id: item.id,
        pointerId: pointerEvent.pointerId,
        startClientY: pointerEvent.clientY,
        originalStart: item.start,
        originalEnd: item.end,
        zone: item.zone,
        lastDelta: 0,
      });
    },
    []
  );

  const beginEventResize = useCallback(
    (
      pointerEvent: React.PointerEvent<HTMLDivElement>,
      item: TimelineEvent,
      mode: "event-resize-start" | "event-resize-end"
    ) => {
      pointerEvent.preventDefault();
      pointerEvent.stopPropagation();
      setPointerCaptureSafe(pointerEvent);
      setDragState({
        type: mode,
        id: item.id,
        pointerId: pointerEvent.pointerId,
        startClientY: pointerEvent.clientY,
        originalStart: item.start,
        originalEnd: item.end,
        zone: item.zone,
        lastDelta: 0,
      });
    },
    []
  );

  const beginAnchorDrag = useCallback(
    (
      pointerEvent: React.PointerEvent<HTMLButtonElement>,
      anchor: TimelineAnchor
    ) => {
      setPointerCaptureSafe(pointerEvent);
      setDragState({
        type: "anchor",
        id: anchor.id,
        pointerId: pointerEvent.pointerId,
        startClientY: pointerEvent.clientY,
        originalInstant: anchor.zoned,
        zone: anchor.zone,
        lastDelta: 0,
      });
    },
    []
  );

  const handleScroll = useCallback(
    (isoDate: string, container: HTMLDivElement) => {
      const start = container.scrollTop / PIXELS_PER_MINUTE;
      const end =
        (container.scrollTop + container.clientHeight) / PIXELS_PER_MINUTE;
      setVisibleRanges((prev) => ({
        ...prev,
        [isoDate]: { start, end },
      }));
    },
    []
  );

  const handleContextMenu = useCallback(
    (isoDate: string, event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = scrollRefs.current[isoDate];
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const offsetY = event.clientY - rect.top + container.scrollTop;
      const minuteOffset = Math.max(
        0,
        Math.min(offsetY / PIXELS_PER_MINUTE, CALENDAR_MINUTES)
      );
      setEventComposer({ visible: false });
      setEventComposerError(null);
      setContextMenu({
        visible: true,
        isoDate,
        clientX: event.clientX,
        clientY: event.clientY,
        minuteOffset,
      });
    },
    []
  );

  const closeContextMenu = useCallback(
    () => setContextMenu({ visible: false }),
    []
  );

  const handleAddAnchor = useCallback(
    (kind: "wake" | "sleep") => {
      if (!contextMenu.visible) {
        return;
      }
      const date = Temporal.PlainDate.from(contextMenu.isoDate);
      const hour = Math.floor(contextMenu.minuteOffset / 60);
      const minute = Math.round(contextMenu.minuteOffset % 60);
      const zoned = Temporal.ZonedDateTime.from({
        timeZone: displayZoneId,
        year: date.year,
        month: date.month,
        day: date.day,
        hour,
        minute,
      });
      onAddAnchor({ kind, zoned, zone: displayZoneId });
      closeContextMenu();
    },
    [closeContextMenu, contextMenu, displayZoneId, onAddAnchor]
  );

  const openEventComposer = useCallback(() => {
    if (!contextMenu.visible) {
      return;
    }
    const snappedStart =
      Math.round(contextMenu.minuteOffset / timeStepMinutes) * timeStepMinutes;
    const normalizedStart = Math.max(
      0,
      Math.min(snappedStart, CALENDAR_MINUTES - timeStepMinutes)
    );
    const defaultEndMinutes = Math.min(
      normalizedStart + Math.max(timeStepMinutes, 60),
      CALENDAR_MINUTES - 1
    );
    const endMinutes =
      defaultEndMinutes <= normalizedStart
        ? Math.min(normalizedStart + timeStepMinutes, CALENDAR_MINUTES - 1)
        : defaultEndMinutes;
    setEventComposer({
      visible: true,
      isoDate: contextMenu.isoDate,
      clientX: contextMenu.clientX,
      clientY: contextMenu.clientY,
      start: formatMinutes(normalizedStart),
      end: formatMinutes(endMinutes),
      title: "",
    });
    setEventComposerError(null);
    closeContextMenu();
  }, [closeContextMenu, contextMenu, timeStepMinutes]);

  const closeEventComposer = useCallback(() => {
    setEventComposer({ visible: false });
    setEventComposerError(null);
  }, []);

  const handleEventComposerSubmit = useCallback(
    (formEvent: ReactFormEvent<HTMLFormElement>) => {
      formEvent.preventDefault();
      if (!eventComposer.visible) {
        return;
      }
      try {
        const date = Temporal.PlainDate.from(eventComposer.isoDate);
        const startTime = Temporal.PlainTime.from(eventComposer.start);
        const startZoned = Temporal.ZonedDateTime.from({
          timeZone: displayZoneId,
          year: date.year,
          month: date.month,
          day: date.day,
          hour: startTime.hour,
          minute: startTime.minute,
          second: startTime.second,
        });
        const endTime = Temporal.PlainTime.from(eventComposer.end);
        let endZoned = Temporal.ZonedDateTime.from({
          timeZone: displayZoneId,
          year: date.year,
          month: date.month,
          day: date.day,
          hour: endTime.hour,
          minute: endTime.minute,
          second: endTime.second,
        });
        if (Temporal.ZonedDateTime.compare(endZoned, startZoned) <= 0) {
          endZoned = endZoned.add({ days: 1 });
        }
        onAddEvent({
          title: eventComposer.title,
          start: startZoned,
          end: endZoned,
          zone: displayZoneId,
        });
        setEventComposer({ visible: false });
        setEventComposerError(null);
      } catch (error) {
        setEventComposerError(
          error instanceof Error ? error.message : "Unable to add event"
        );
      }
    },
    [displayZoneId, eventComposer, onAddEvent]
  );

  useEffect(() => {
    if (!contextMenu.visible) {
      return;
    }
    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[role='menu']")) {
        closeContextMenu();
      }
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, [contextMenu.visible, closeContextMenu]);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/80 p-3 text-xs text-muted-foreground backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-primary" />{" "}
          Sleep window
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-300" />{" "}
          Bright window
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-primary/60 border border-primary" />{" "}
          Event conflict
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-full gap-4">
          {calendarDays.map((wakeInstantIso) => {
            const day = computed.days.find(
              (item) => item.wakeInstant.toString() === wakeInstantIso
            );
            if (!day) {
              return null;
            }
            const dayKey = day.wakeDisplayDate.toString();
            const isoDate = dayKey;
            const events = eventsByDay.get(dayKey) ?? [];
            const anchors = anchorsByDay.get(dayKey) ?? [];
            const isoDate = dayKey;
            const dateObj = day.wakeDisplayDate;
            const weekday = dateObj.toLocaleString("en-US", {
              weekday: "short",
            });

            let sleepSegment: { top: number; height: number } | null = null;
            const sleepStartDisplay = day.sleepStartZoned.withTimeZone(
              displayZoneId
            );
            const sleepEndDisplay = day.sleepEndZoned.withTimeZone(
              displayZoneId
            );
            const sleepStartMinutes = clampMinutes(
              minutesSinceStartOfDay(sleepStartDisplay)
            );
            const sleepDurationMinutes = Math.max(
              Math.round(
                sleepEndDisplay
                  .since(sleepStartDisplay)
                  .total({ unit: "minutes" })
              ),
              timeStepMinutes
            );
            const sleepEndMinutes = sleepStartMinutes + sleepDurationMinutes;
            const clampedEnd = Math.min(sleepEndMinutes, CALENDAR_MINUTES);
            if (clampedEnd > sleepStartMinutes) {
              sleepSegment = {
                top: sleepStartMinutes,
                height: clampedEnd - sleepStartMinutes,
              };
            }

            let brightSegment: { top: number; height: number } | null = null;
            const brightStartDisplay = day.brightStartZoned.withTimeZone(
              displayZoneId
            );
            const brightEndDisplay = day.brightEndZoned.withTimeZone(
              displayZoneId
            );
            const brightStartMinutes = clampMinutes(
              minutesSinceStartOfDay(brightStartDisplay)
            );
            const brightDurationMinutes = Math.max(
              Math.round(
                brightEndDisplay
                  .since(brightStartDisplay)
                  .total({ unit: "minutes" })
              ),
              timeStepMinutes
            );
            const brightEndMinutes = brightStartMinutes + brightDurationMinutes;
            const clampedBrightEnd = Math.min(
              brightEndMinutes,
              CALENDAR_MINUTES
            );
            if (clampedBrightEnd > brightStartMinutes) {
              brightSegment = {
                top: brightStartMinutes,
                height: clampedBrightEnd - brightStartMinutes,
              };
            }

            const visible = visibleRanges[isoDate] ?? {
              start: 0,
              end: CALENDAR_MINUTES,
            };
            const renderStart = Math.max(
              0,
              visible.start - VIRTUAL_PADDING_MINUTES
            );
            const renderEnd = Math.min(
              CALENDAR_MINUTES,
              visible.end + VIRTUAL_PADDING_MINUTES
            );

            const visibleEvents = events.filter((event) => {
              const startMinutes = clampMinutes(
                minutesSinceStartOfDay(event.start)
              );
              const eventEndDisplay =
                event.end ?? event.start.add({ minutes: timeStepMinutes });
              const durationMinutes = Math.max(
                Math.round(
                  eventEndDisplay.since(event.start).total({ unit: "minutes" })
                ),
                timeStepMinutes
              );
              const endMinutes = Math.min(
                startMinutes + durationMinutes,
                CALENDAR_MINUTES
              );
              return endMinutes >= renderStart && startMinutes <= renderEnd;
            });

            const visibleAnchors = anchors.filter((anchor) => {
              const minutes = clampMinutes(
                minutesSinceStartOfDay(anchor.zoned)
              );
              return minutes >= renderStart && minutes <= renderEnd;
            });

            const visibleTicks: number[] = [];
            for (
              let minute = Math.floor(renderStart / 60) * 60;
              minute <= renderEnd;
              minute += 60
            ) {
              visibleTicks.push(minute);
            }

            return (
              <div
                key={isoDate}
                className="min-w-[240px] flex-1"
                data-testid={`timeline-day-${isoDate}`}
              >
                <div className="flex items-center justify-between border-b pb-2 text-sm font-medium text-foreground">
                  <span>{weekday}</span>
                  <span>{`${dateObj.month.toString().padStart(2, "0")}/${dateObj.day.toString().padStart(2, "0")}`}</span>
                </div>
                <div
                  ref={(element) => {
                    scrollRefs.current[isoDate] = element;
                  }}
                  className="relative border-l border-r border-b bg-card"
                  data-testid={`timeline-scroll-${isoDate}`}
                  role="application"
                  aria-label={`Timeline interactions for ${isoDate}`}
                  style={{ height: `${CALENDAR_HEIGHT}px` }}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onScroll={(event) =>
                    handleScroll(isoDate, event.currentTarget)
                  }
                  onContextMenu={(event) => handleContextMenu(isoDate, event)}
                >
                  {visibleTicks.map((minute) => (
                    <div
                      key={`${isoDate}-${minute}`}
                      className="absolute left-0 right-0 border-b border-border/60 text-[10px] text-muted-foreground"
                      style={{ top: `${minute * PIXELS_PER_MINUTE}px` }}
                    >
                      <span className="ml-1">{formatMinutes(minute)}</span>
                    </div>
                  ))}

                  {brightSegment ? (
                    <div
                      className="absolute inset-x-0 rounded-sm bg-amber-200/40"
                      style={{
                        top: `${brightSegment.top * PIXELS_PER_MINUTE}px`,
                        height: `${brightSegment.height * PIXELS_PER_MINUTE}px`,
                        zIndex: 0,
                      }}
                    />
                  ) : null}

                  {sleepSegment ? (
                    <div
                      className="absolute inset-x-1 rounded-md bg-primary/10"
                      style={{
                        top: `${sleepSegment.top * PIXELS_PER_MINUTE}px`,
                        height: `${sleepSegment.height * PIXELS_PER_MINUTE}px`,
                        zIndex: 0,
                      }}
                    />
                  ) : null}

                  {visibleEvents.map((item) => {
                    const startMinutes = clampMinutes(
                      minutesSinceStartOfDay(item.start)
                    );
                    const eventEndDisplay =
                      item.end ?? item.start.add({ minutes: timeStepMinutes });
                    const rawDurationMinutes = Math.max(
                      Math.round(
                        eventEndDisplay
                          .since(item.start)
                          .total({ unit: "minutes" })
                      ),
                      timeStepMinutes
                    );
                    const cappedEndMinutes = Math.min(
                      startMinutes + rawDurationMinutes,
                      CALENDAR_MINUTES
                    );
                    const durationMinutes = Math.max(
                      cappedEndMinutes - startMinutes,
                      timeStepMinutes
                    );
                    const timeSuffix = item.end
                      ? rangeDaySuffix(item.start, item.end)
                      : "";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onEditEvent(item.id)}
                        onPointerDown={(event) => beginEventDrag(event, item)}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        className={`absolute inset-x-2 cursor-grab rounded-md border px-2 py-1 text-left text-xs shadow-sm outline-none ring-primary focus-visible:ring-2 ${
                          item.conflict
                            ? "border-primary bg-primary/20 text-primary"
                            : "border-primary/70 bg-primary/10 text-primary"
                        }`}
                        style={{
                          top: `${startMinutes * PIXELS_PER_MINUTE}px`,
                          height: `${durationMinutes * PIXELS_PER_MINUTE}px`,
                        }}
                      >
                        <div className="font-medium">{item.title}</div>
                        <div className="text-[10px] text-primary/80">
                          {item.start
                            .toPlainTime()
                            .toString({
                              smallestUnit: "minute",
                              fractionalSecondDigits: 0,
                            })}
                          {item.end
                            ? ` → ${item.end
                                .toPlainTime()
                                .toString({
                                  smallestUnit: "minute",
                                  fractionalSecondDigits: 0,
                                })}${timeSuffix}`
                            : ""}
                        </div>
                        {item.end ? (
                          <>
                            <div
                              role="presentation"
                              onPointerDown={(event) =>
                                beginEventResize(
                                  event,
                                  item,
                                  "event-resize-start"
                                )
                              }
                              className="absolute left-0 right-0 top-0 h-2 cursor-ns-resize"
                            />
                            <div
                              role="presentation"
                              onPointerDown={(event) =>
                                beginEventResize(
                                  event,
                                  item,
                                  "event-resize-end"
                                )
                              }
                              className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize"
                            />
                          </>
                        ) : null}
                      </button>
                    );
                  })}

                  {visibleAnchors.map((anchor) => {
                    const minutes = clampMinutes(
                      minutesSinceStartOfDay(anchor.zoned)
                    );
                    const anchorKindLabel =
                      anchor.kind === "wake" ? "Wake time" : "Sleep time";
                    return (
                      <button
                        key={anchor.id}
                        type="button"
                        onClick={() => onEditAnchor(anchor.id)}
                        onPointerDown={(event) =>
                          beginAnchorDrag(event, anchor)
                        }
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        className="absolute left-2 right-2 flex cursor-grab items-center gap-2 rounded-md bg-foreground/10 px-2 py-1 text-left text-[10px] text-foreground transition-colors hover:bg-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        style={{ top: `${minutes * PIXELS_PER_MINUTE - 10}px` }}
                        aria-label={`${anchorKindLabel} at ${anchor.zoned
                          .toPlainTime()
                          .toString({
                            smallestUnit: "minute",
                            fractionalSecondDigits: 0,
                          })}`}
                      >
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        <span>
                          {anchorKindLabel} @{" "}
                          {anchor.zoned
                            .toPlainTime()
                            .toString({
                              smallestUnit: "minute",
                              fractionalSecondDigits: 0,
                            })}
                        </span>
                        {anchor.note ? (
                          <span className="text-muted-foreground">
                            {anchor.note}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {contextMenu.visible ? (
        <div
          className="fixed z-50 rounded-md border bg-popover p-2 text-xs shadow-lg"
          style={{ left: contextMenu.clientX, top: contextMenu.clientY }}
          role="menu"
        >
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left hover:bg-muted"
            onClick={openEventComposer}
          >
            Add event
          </button>
          <button
            type="button"
            className="mt-1 block w-full rounded px-2 py-1 text-left hover:bg-muted"
            onClick={() => handleAddAnchor("wake")}
          >
            Add wake anchor
          </button>
          <button
            type="button"
            className="mt-1 block w-full rounded px-2 py-1 text-left hover:bg-muted"
            onClick={() => handleAddAnchor("sleep")}
          >
            Add sleep anchor
          </button>
          <button
            type="button"
            className="mt-1 block w-full rounded px-2 py-1 text-left text-muted-foreground hover:bg-muted"
            onClick={closeContextMenu}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {eventComposer.visible ? (
        <div
          className="fixed z-50 w-64 -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-popover p-3 text-xs shadow-lg"
          style={{
            left: eventComposer.clientX,
            top: eventComposer.clientY,
          }}
          role="dialog"
          aria-modal="true"
        >
          <form className="space-y-2" onSubmit={handleEventComposerSubmit}>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Quick event
            </div>
            <label className="flex flex-col gap-1">
              Title
              <input
                type="text"
                value={eventComposer.title}
                onChange={(event) =>
                  setEventComposer((prev) =>
                    prev.visible
                      ? { ...prev, title: event.target.value }
                      : prev
                  )
                }
                placeholder="Name this event"
                className="rounded-md border px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                Starts
                <input
                  type="time"
                  required
                  value={eventComposer.start}
                  onChange={(event) =>
                    setEventComposer((prev) =>
                      prev.visible
                        ? { ...prev, start: event.target.value }
                        : prev
                    )
                  }
                  className="rounded-md border px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </label>
              <label className="flex flex-col gap-1">
                Ends
                <input
                  type="time"
                  required
                  value={eventComposer.end}
                  onChange={(event) =>
                    setEventComposer((prev) =>
                      prev.visible
                        ? { ...prev, end: event.target.value }
                        : prev
                    )
                  }
                  className="rounded-md border px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </label>
            </div>
            {eventComposerError ? (
              <p className="text-xs text-destructive">{eventComposerError}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm">
                Create event
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={closeEventComposer}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
