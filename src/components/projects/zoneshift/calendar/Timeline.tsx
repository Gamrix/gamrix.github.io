import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Temporal } from "@js-temporal/polyfill";

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
}: TimelineProps) {
  const [dragState, setDragState] = useState<DragState>(null);
  const [visibleRanges, setVisibleRanges] = useState<VisibleRanges>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
  });
  const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const eventsByDay = useMemo(() => {
    const mapping = new Map<string, TimelineEvent[]>();
    const daySleepWindows = new Map<
      string,
      { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime }
    >();
    computed.days.forEach((day) => {
      const sleepStart = Temporal.ZonedDateTime.from(
        day.sleepStartZoned
      ).withTimeZone(displayZoneId);
      const sleepEnd = Temporal.ZonedDateTime.from(
        day.sleepEndZoned
      ).withTimeZone(displayZoneId);
      const entry = { start: sleepStart, end: sleepEnd };
      daySleepWindows.set(day.dateTargetZone, entry);
      daySleepWindows.set(sleepStart.toPlainDate().toString(), entry);
      daySleepWindows.set(sleepEnd.toPlainDate().toString(), entry);
    });

    computed.projectedEvents.forEach((event) => {
      try {
        const start = Temporal.ZonedDateTime.from(
          event.startZoned
        ).withTimeZone(displayZoneId);
        const end = event.endZoned
          ? Temporal.ZonedDateTime.from(event.endZoned).withTimeZone(
              displayZoneId
            )
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
          const zoned = Temporal.ZonedDateTime.from(
            anchor.zonedDateTime
          ).withTimeZone(displayZoneId);
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
    () => computed.days.map((day) => day.dateTargetZone),
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
          {calendarDays.map((isoDate) => {
            const day = computed.days.find(
              (item) => item.dateTargetZone === isoDate
            );
            if (!day) {
              return null;
            }
            const events = eventsByDay.get(isoDate) ?? [];
            const anchors = anchorsByDay.get(isoDate) ?? [];
            const dateObj = Temporal.PlainDate.from(isoDate);
            const weekday = dateObj.toLocaleString("en-US", {
              weekday: "short",
            });

            let sleepSegment: { top: number; height: number } | null = null;
            const sleepStartDisplay = Temporal.ZonedDateTime.from(
              day.sleepStartZoned
            ).withTimeZone(displayZoneId);
            const sleepEndDisplay = Temporal.ZonedDateTime.from(
              day.sleepEndZoned
            ).withTimeZone(displayZoneId);
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
            const brightStartDisplay = Temporal.ZonedDateTime.from(
              day.brightStartZoned
            ).withTimeZone(displayZoneId);
            const brightEndDisplay = Temporal.ZonedDateTime.from(
              day.brightEndZoned
            ).withTimeZone(displayZoneId);
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
                      ? rangeDaySuffix(
                          item.start.toString({
                            smallestUnit: "minute",
                            fractionalSecondDigits: 0,
                          }),
                          item.end.toString({
                            smallestUnit: "minute",
                            fractionalSecondDigits: 0,
                          })
                        )
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
            onClick={() => handleAddAnchor("wake")}
          >
            Add wake time
          </button>
          <button
            type="button"
            className="mt-1 block w-full rounded px-2 py-1 text-left hover:bg-muted"
            onClick={() => handleAddAnchor("sleep")}
          >
            Add sleep time
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
    </div>
  );
}
