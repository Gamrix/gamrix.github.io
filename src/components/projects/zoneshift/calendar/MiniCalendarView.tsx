import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PointerEvent as ReactPointerEvent,
  MouseEvent,
  FormEvent,
} from "react";
import { Temporal } from "@js-temporal/polyfill";

import { Button } from "@/components/ui/button";
import type { ComputedView, CorePlan } from "@/scripts/projects/zoneshift/model";
import {
  MINUTES_IN_DAY,
  formatRangeLabel,
  rangeDaySuffix,
  minutesSinceStartOfDay,
} from "../utils/timeSegments";
import {
  MiniCalendarComposer,
  type ComposerOutput,
} from "./MiniCalendarComposer";
import { EventItem } from "./EventItem";

type ComposerConfig = {
  type: "event" | "wake";
  dayKey: string;
  initialStart: string;
  initialEnd?: string;
};

const EVENT_HOVER_DURATION_MINUTES = 60;
const HOVER_EVENT_THRESHOLD_MINUTES = 12;
const HOVER_WAKE_THRESHOLD_MINUTES = 20;

const clampMinutesValue = (minutes: number) => {
  if (minutes < 0) {
    return 0;
  }
  if (minutes > MINUTES_IN_DAY - 5) {
    return MINUTES_IN_DAY - 5;
  }
  return minutes;
};

const minutesToTimeString = (minutes: number) => {
  const clamped = clampMinutesValue(minutes);
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const timeStringToMinutes = (value: string) => {
  const time = Temporal.PlainTime.from(value);
  return time.hour * 60 + time.minute;
};

type MiniCalendarViewProps = {
  plan: CorePlan;
  computed: ComputedView;
  displayZoneId: string;
  onEditEvent?: (eventId: string) => void;
  onEditAnchor?: (anchorId: string) => void;
  onOpenPlanSettings?: () => void;
  onEventChange?: (
    eventId: string,
    payload: {
      start: Temporal.ZonedDateTime;
      end?: Temporal.ZonedDateTime;
      zone: string;
    }
  ) => void;
  onAnchorChange?: (
    anchorId: string,
    payload: { instant: Temporal.ZonedDateTime; zone: string }
  ) => void;
  onAddEvent?: (payload: {
    title: string;
    start: Temporal.ZonedDateTime;
    end?: Temporal.ZonedDateTime;
    zone: string;
  }) => void;
  onAddAnchor?: (payload: {
    zoned: Temporal.ZonedDateTime;
    zone: string;
    note?: string;
    autoSelect?: boolean;
  }) => void;
};

type SegmentType = "sleep" | "bright" | "other";

type TimeSegment = {
  start: number;
  end: number;
  type: SegmentType;
};

import type { MiniEvent } from "./MiniEvent";

const TIMELINE_HEIGHT = "min(34rem, 80vh)";
const HEADER_HEIGHT = "2.5rem";
const AXIS_WIDTH = "clamp(2.25rem, 12vw, 3.5rem)";
const TOTAL_HEIGHT = `calc(${TIMELINE_HEIGHT} + ${HEADER_HEIGHT})`;
const MIN_DAYS_PER_PAGE = 7;
const DAY_COLUMN_WIDTH_PX = 50;
const DAY_GAP_PX = 16;
const MIDNIGHT = Temporal.PlainTime.from("00:00");

const getMinutesFromZdt = (value: Temporal.ZonedDateTime) => {
  return minutesSinceStartOfDay(value);
};

const carveRange = (
  segments: TimeSegment[],
  start: number,
  end: number,
  type: SegmentType
) => {
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
    slices.push({
      start: Math.max(segment.start, start),
      end: Math.min(segment.end, end),
      type,
    });
    if (segment.end > end) {
      slices.push({ start: end, end: segment.end, type: segment.type });
    }
    return slices;
  });
};

const applySegment = (
  segments: TimeSegment[],
  start: number | null,
  end: number | null,
  type: SegmentType
) => {
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
  value
    .toPlainTime()
    .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });

type ColumnRect = {
  key: string;
  rect: DOMRect;
};

type DragState = {
  pointerId: number;
  eventId: string;
  kind: "event" | "wake";
  zone: string;
  originalStart: Temporal.ZonedDateTime;
  originalEnd?: Temporal.ZonedDateTime;
  duration?: Temporal.Duration | null;
  pointerOffsetX: number;
  pointerOffsetY: number;
  startClientX: number;
  startClientY: number;
  hasMoved: boolean;
  lastApplied: string | null;
  anchorId?: string;
};

type HoverTarget =
  | { type: "event"; dayKey: string; minutes: number }
  | { type: "wake"; dayKey: string; minutes: number };

const setPointerCaptureSafe = (event: ReactPointerEvent<Element>) => {
  const target = event.currentTarget as Element & {
    setPointerCapture?: (pointerId: number) => void;
  };
  if (typeof target.setPointerCapture === "function") {
    try {
      target.setPointerCapture(event.pointerId);
    } catch { }
  }
};

const releasePointerCaptureSafe = (event: ReactPointerEvent<Element>) => {
  const target = event.currentTarget as Element & {
    releasePointerCapture?: (pointerId: number) => void;
  };
  if (typeof target.releasePointerCapture === "function") {
    try {
      target.releasePointerCapture(event.pointerId);
    } catch { }
  }
};

type TimelineDay = {
  wakeInstant: Temporal.Instant;
  wakeZoned: Temporal.ZonedDateTime;
  wakeDisplayDate: Temporal.PlainDate;
  changeThisDayHours: number;
  sleepStartLocal: string;
  sleepStartZoned: Temporal.ZonedDateTime;
  wakeTimeLocal: string;
  brightStartZoned?: Temporal.ZonedDateTime;
  brightEndZoned?: Temporal.ZonedDateTime;
  anchors: {
    id: string;
    kind: "wake";
    note?: string;
    instant: Temporal.Instant;
    editable: boolean;
  }[];
};

export function MiniCalendarView({
  plan,
  computed,
  displayZoneId,
  onEditEvent,
  onEditAnchor,
  onOpenPlanSettings,
  onEventChange,
  onAnchorChange,
  onAddEvent,
  onAddAnchor,
}: MiniCalendarViewProps) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [daysPerPage, setDaysPerPage] = useState(MIN_DAYS_PER_PAGE);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(
    null
  );
  const [containerWidth, setContainerWidth] = useState(0);


  const [dragState, setDragState] = useState<DragState | null>(null);
  const [composer, setComposer] = useState<ComposerConfig | null>(null);
  // Removed eventDraft, wakeDraft, composerError state

  const dayColumnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const suppressClickRef = useRef(false);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);

  // ... existing refs and callbacks ...

  const setScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    setScrollContainer(node);
  }, []);

  const registerDayColumn = useCallback(
    (key: string) => (node: HTMLDivElement | null) => {
      if (node) {
        dayColumnRefs.current[key] = node;
      } else {
        delete dayColumnRefs.current[key];
      }
    },
    []
  );

  const closeComposer = useCallback(() => {
    setComposer(null);
  }, []); // Removed setComposerError

  // ... effects ...

  const openEventComposer = useCallback(
    (day: TimelineDay, minuteOverride?: number) => {
      const dayKey = day.wakeDisplayDate.toString();
      const brightStartDisplay = day.brightStartZoned
        ? day.brightStartZoned.withTimeZone(displayZoneId)
        : day.sleepStartZoned.withTimeZone(displayZoneId);
      const brightEndDisplay = day.brightEndZoned
        ? day.brightEndZoned.withTimeZone(displayZoneId)
        : null;

      const startMinutes =
        minuteOverride !== undefined
          ? clampMinutesValue(minuteOverride)
          : minutesSinceStartOfDay(brightStartDisplay);
      const endMinutes =
        minuteOverride !== undefined
          ? clampMinutesValue(startMinutes + EVENT_HOVER_DURATION_MINUTES)
          : brightEndDisplay
            ? minutesSinceStartOfDay(brightEndDisplay)
            : clampMinutesValue(startMinutes + EVENT_HOVER_DURATION_MINUTES);

      setComposer({
        type: "event",
        dayKey,
        initialStart: minutesToTimeString(startMinutes),
        initialEnd: minutesToTimeString(endMinutes),
      });
    },
    [displayZoneId]
  );

  const openWakeComposer = useCallback(
    (day: TimelineDay, minuteOverride?: number) => {
      const dayKey = day.wakeDisplayDate.toString();
      setComposer({
        type: "wake",
        dayKey,
        initialStart: minutesToTimeString(
          minuteOverride ?? timeStringToMinutes(day.wakeTimeLocal)
        ),
      });
    },
    []
  );




  const eventsByDay = useMemo(() => {
    const mapping = new Map<string, MiniEvent[]>();
    if (!computed?.manualEvents) {
      return mapping;
    }
    computed.manualEvents.forEach((event) => {
      try {
        const start = event.startZoned.withTimeZone(displayZoneId);
        const end = event.endZoned
          ? event.endZoned.withTimeZone(displayZoneId)
          : undefined;
        const key = start.toPlainDate().toString();
        const summary = end
          ? formatRangeLabel(start, end, { separator: " → " })
          : formatEventTime(start);
        const bucket = mapping.get(key) ?? [];
        bucket.push({
          id: event.id,
          title: event.title ?? "",
          start,
          end,
          summary,
          zone: event.originalZone ?? event.startZoned.timeZoneId,
          kind: "event",
          editable: true,
        });
        mapping.set(key, bucket);
      } catch (error) {
        console.error("Failed to map event for mini calendar", event.id, error);
      }
    });

    for (const bucket of mapping.values()) {
      bucket.sort((a, b) => Temporal.ZonedDateTime.compare(a.start, b.start));
    }

    return mapping;
  }, [computed.manualEvents, displayZoneId]);

  const anchorMetadata = useMemo(() => {
    const mapping = new Map<
      string,
      { zoned: Temporal.ZonedDateTime; zone: string; note?: string }
    >();
    if (!plan?.anchors) {
      return mapping;
    }
    plan.anchors.forEach((anchor) => {
      try {
        const zoned = Temporal.Instant.from(anchor.instant).toZonedDateTimeISO(displayZoneId);
        mapping.set(anchor.id, {
          zoned,
          zone: anchor.zone,
          note: anchor.note,
        });
      } catch (error) {
        console.error(
          "Failed to map anchor metadata for mini calendar",
          anchor.id,
          error
        );
      }
    });
    return mapping;
  }, [plan?.anchors, displayZoneId]);

  const timelineByDay = useMemo(() => {
    // Helper to calculate minutes for time
    const toMinutes = (value: Temporal.ZonedDateTime) => {
      // Note: minutesSinceStartOfDay returns 0-1439.
      // If we are projecting, we handle the 1440 case manually.
      return minutesSinceStartOfDay(value.withTimeZone(displayZoneId));
    };

    const schedule = computed.wakeSchedule ?? [];
    return schedule.map((entry) => {
      // Resolve Zoned Times from ScheduleEntry (Ground Truth)
      const wakeZoned = entry.wakeEvent.startInstant.toZonedDateTimeISO(displayZoneId);
      const sleepZoned = entry.sleepEvent.startInstant.toZonedDateTimeISO(displayZoneId);
      const brightStartZoned = entry.wakeEvent.startInstant.toZonedDateTimeISO(displayZoneId);
      const brightEndZoned = entry.brightEvent.endInstant
        ? entry.brightEvent.endInstant.toZonedDateTimeISO(displayZoneId)
        : undefined;

      // Define Day Boundaries for this column (The Wake Day)
      const wakeDate = wakeZoned.toPlainDate();
      const dayStart = wakeDate.toZonedDateTime({ timeZone: displayZoneId, plainTime: "00:00" });
      const dayEnd = dayStart.add({ days: 1 });

      // Helper to clip ranges to this day
      const projectToDay = (start: Temporal.ZonedDateTime, end: Temporal.ZonedDateTime) => {
        if (Temporal.ZonedDateTime.compare(end, dayStart) <= 0) return null;
        if (Temporal.ZonedDateTime.compare(start, dayEnd) >= 0) return null;

        const s = Temporal.ZonedDateTime.compare(start, dayStart) > 0 ? start : dayStart;
        const e = Temporal.ZonedDateTime.compare(end, dayEnd) < 0 ? end : dayEnd;

        const sMin = toMinutes(s);
        let eMin = toMinutes(e);

        // If we clamped to dayEnd (or natural end is at midnight), force 1440
        // Compare epoch nanoseconds to be precise, or just equality check
        if (Temporal.ZonedDateTime.compare(e, dayEnd) === 0) {
          eMin = MINUTES_IN_DAY;
        }
        // If wrapping occurred naturally (e.g. 0 min) but it should be 1440
        if (eMin === 0 && Temporal.ZonedDateTime.compare(e, dayStart) > 0) {
          eMin = MINUTES_IN_DAY;
        }

        return { start: sMin, end: eMin };
      };

      let segments: TimeSegment[] = [{ start: 0, end: MINUTES_IN_DAY, type: "other" }];

      // SLEEP
      const sleepRange = projectToDay(sleepZoned, wakeZoned);
      if (sleepRange) {
        segments = carveRange(segments, sleepRange.start, sleepRange.end, "sleep");
      }

      // BRIGHT
      if (brightEndZoned) {
        const brightRange = projectToDay(wakeZoned, brightEndZoned);
        if (brightRange) {
          segments = carveRange(segments, brightRange.start, brightRange.end, "bright");
        }
      }

      const key = wakeDate.toString();
      const events = eventsByDay.get(key) ?? [];
      const anchor = entry.anchor;
      const wakeEvents: MiniEvent[] = anchor ? [{
        id: `wake-${anchor.id}`,
        title: anchor.note?.trim() || "Wake time",
        start: wakeZoned, // Use the zoned instant directly
        summary: (() => {
          const timeLabel = wakeZoned.toPlainTime().toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });
          const trimmedNote = anchor.note?.trim() ?? "";
          return trimmedNote.length > 0 ? `${timeLabel} · ${trimmedNote}` : timeLabel;
        })(),
        zone: anchor.zone, // Use anchor zone or fallback
        kind: "wake" as const,
        anchorId: anchor.id,
        editable: !anchor.id.startsWith("__auto"),
        note: anchor.note,
        displayTime: wakeZoned.toPlainTime().toString({ smallestUnit: "minute", fractionalSecondDigits: 0 }),
      }] : [];

      const combined = [...events, ...wakeEvents];
      combined.sort((a, b) => Temporal.ZonedDateTime.compare(a.start, b.start));

      const day: TimelineDay = {
        wakeInstant: entry.wakeEvent.startInstant,
        wakeZoned: wakeZoned,
        wakeDisplayDate: wakeDate,
        changeThisDayHours: entry.shiftFromPreviousWakeHours,
        sleepStartLocal: sleepZoned.toPlainTime().toString({ smallestUnit: "minute", fractionalSecondDigits: 0 }),
        sleepStartZoned: sleepZoned,
        wakeTimeLocal: wakeZoned.toPlainTime().toString({ smallestUnit: "minute", fractionalSecondDigits: 0 }),
        brightStartZoned: brightStartZoned,
        brightEndZoned: brightEndZoned,
        anchors: anchor ? [{
          id: anchor.id,
          kind: "wake" as const,
          note: anchor.note,
          instant: Temporal.Instant.from(anchor.instant),
          editable: !anchor.id.startsWith("__auto"),
        }] : [],
      };

      return {
        day,
        segments,
        events: combined,
        hasWakeAnchor: Boolean(anchor),
        wakeMinutes: toMinutes(wakeZoned)
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  }, [anchorMetadata, computed.wakeSchedule, displayZoneId, eventsByDay]);

  const hourMarkers = useMemo(() => {
    const markers: number[] = [];
    for (let hour = 0; hour <= 24; hour += 2) {
      markers.push(hour);
    }
    return markers;
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, item: MiniEvent) => {
      const isWake = item.kind === "wake";
      const canDrag = isWake
        ? Boolean(onAnchorChange && item.editable && item.anchorId)
        : Boolean(onEventChange);
      suppressClickRef.current = true;
      if (!canDrag) {
        suppressClickRef.current = false;
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const pointerOffsetX =
        event.clientX - (rect.left + rect.width / 2);
      const pointerOffsetY =
        event.clientY - (rect.top + rect.height / 2);
      setPointerCaptureSafe(event);
      setDragState({
        pointerId: event.pointerId,
        eventId: item.id,
        kind: item.kind,
        zone: item.zone,
        originalStart: item.start,
        originalEnd: item.kind === "event" ? item.end : undefined,
        duration:
          item.kind === "event" && item.end
            ? item.end.since(item.start)
            : null,
        pointerOffsetX,
        pointerOffsetY,
        startClientX: event.clientX,
        startClientY: event.clientY,
        hasMoved: false,
        lastApplied: null,
        anchorId: item.anchorId,
      });
    },
    [onAnchorChange, onEventChange]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }
      event.preventDefault();
      const moved =
        Math.abs(event.clientX - dragState.startClientX) > 2 ||
        Math.abs(event.clientY - dragState.startClientY) > 2;
      if (moved && !dragState.hasMoved) {
        setDragState((prev) =>
          prev && prev.pointerId === event.pointerId
            ? { ...prev, hasMoved: true }
            : prev
        );
      }
      const columnRects = Object.entries(dayColumnRefs.current)
        .map(([key, node]) => {
          if (!node) {
            return null;
          }
          return { key, rect: node.getBoundingClientRect() };
        })
        .filter((value): value is ColumnRect => value !== null);

      if (columnRects.length === 0) {
        return;
      }
      const canApply =
        dragState.kind === "wake"
          ? Boolean(onAnchorChange && dragState.anchorId)
          : Boolean(onEventChange);
      if (!canApply) {
        return;
      }
      const targetCenterX = event.clientX - dragState.pointerOffsetX;
      const targetCenterY = event.clientY - dragState.pointerOffsetY;
      let closest: ColumnRect | null = null;
      let minDistance = Number.POSITIVE_INFINITY;
      for (const column of columnRects) {
        const center = column.rect.left + column.rect.width / 2;
        const distance = Math.abs(targetCenterX - center);
        if (distance < minDistance) {
          minDistance = distance;
          closest = column;
        }
      }
      if (!closest) {
        return;
      }
      const rect = closest.rect;
      const clampedY = Math.min(
        Math.max(targetCenterY, rect.top),
        rect.bottom
      );
      const ratio =
        rect.height === 0 ? 0 : (clampedY - rect.top) / rect.height;
      const minutesRaw = ratio * MINUTES_IN_DAY;
      const minutes = Math.max(
        0,
        Math.min(Math.round(minutesRaw), MINUTES_IN_DAY - 5)
      );
      const signature = `${closest.key}-${minutes}`;
      if (dragState.lastApplied === signature) {
        return;
      }
      let date: Temporal.PlainDate;
      try {
        date = Temporal.PlainDate.from(closest.key);
      } catch {
        return;
      }
      const base = date.toZonedDateTime({
        plainTime: MIDNIGHT,
        timeZone: displayZoneId,
      });
      const nextStartDisplay = base.add({ minutes });
      const startInZone = nextStartDisplay.withTimeZone(dragState.zone);
      if (dragState.kind === "wake") {
        if (dragState.anchorId && onAnchorChange) {
          const instantInZone = nextStartDisplay.withTimeZone(dragState.zone);
          onAnchorChange(dragState.anchorId, {
            instant: instantInZone,
            zone: dragState.zone,
          });
        }
      } else if (onEventChange) {
        const nextEndDisplay = dragState.duration
          ? nextStartDisplay.add(dragState.duration)
          : undefined;
        const endInZone = nextEndDisplay
          ? nextEndDisplay.withTimeZone(dragState.zone)
          : undefined;
        onEventChange(dragState.eventId, {
          start: startInZone,
          end: endInZone,
          zone: dragState.zone,
        });
      }
      setDragState((prev) =>
        prev && prev.pointerId === event.pointerId
          ? { ...prev, hasMoved: true, lastApplied: signature }
          : prev
      );
    },
    [dragState, displayZoneId, onAnchorChange, onEventChange]
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, eventId: string) => {
      if (dragState && event.pointerId === dragState.pointerId) {
        releasePointerCaptureSafe(event);
        const moved = dragState.hasMoved;
        setDragState(null);
        if (!moved) {
          setExpandedEventId((prev) => (prev === eventId ? null : eventId));
        }
        return;
      }
      setExpandedEventId((prev) => (prev === eventId ? null : eventId));
    },
    [dragState]
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }
      releasePointerCaptureSafe(event);
      setDragState(null);
    },
    [dragState]
  );

  const handleButtonClick = useCallback(
    (_event: MouseEvent<HTMLButtonElement>, eventId: string) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      setExpandedEventId((prev) => (prev === eventId ? null : eventId));
    },
    []
  );

  const handleColumnPointerMove = useCallback(
    (meta: {
      dayKey: string;
      hasWakeAnchor: boolean;
      wakeMinutes: number;
      events: MiniEvent[];
      day: TimelineDay;
    }) =>
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragState || composer) {
          return;
        }
        const container = event.currentTarget;
        const rect = container.getBoundingClientRect();
        if (rect.height === 0) {
          setHoverTarget(null);
          return;
        }
        const offsetY = event.clientY - rect.top;
        if (offsetY < 0 || offsetY > rect.height) {
          setHoverTarget(null);
          return;
        }
        if (!onAddEvent && !onAddAnchor) {
          setHoverTarget(null);
          return;
        }

        const ratio = offsetY / rect.height;
        const minutes = clampMinutesValue(
          Math.round(ratio * MINUTES_IN_DAY)
        );

        const isNearExisting = meta.events.some((current) => {
          const startMinutes = clampMinutesValue(
            getMinutesFromZdt(current.start)
          );
          const threshold =
            current.kind === "wake"
              ? HOVER_WAKE_THRESHOLD_MINUTES
              : HOVER_EVENT_THRESHOLD_MINUTES;
          return Math.abs(startMinutes - minutes) <= threshold;
        });

        const canShowWake =
          Boolean(onAddAnchor) &&
          !meta.hasWakeAnchor &&
          Math.abs(meta.wakeMinutes - minutes) <= HOVER_WAKE_THRESHOLD_MINUTES;

        if (canShowWake) {
          setHoverTarget({
            type: "wake",
            dayKey: meta.dayKey,
            minutes: meta.wakeMinutes,
          });
          return;
        }

        if (onAddEvent && !isNearExisting) {
          setHoverTarget({
            type: "event",
            dayKey: meta.dayKey,
            minutes,
          });
          return;
        }

        setHoverTarget(null);
      },
    [composer, dragState, onAddAnchor, onAddEvent]
  );

  const handleColumnPointerLeave = useCallback(() => {
    setHoverTarget(null);
  }, []);

  const handleHoverCreate = useCallback(
    (
      kind: "event" | "wake",
      day: TimelineDay,
      minutes: number
    ) => {
      if (kind === "wake") {
        openWakeComposer(day, minutes);
      } else {
        openEventComposer(day, minutes);
      }
      setHoverTarget(null);
    },
    [openEventComposer, openWakeComposer]
  );

  // Fix 2 & 3: Touch Scrolling & Ghost Touches
  // Moved logic from pointerDown to onClick to allow scrolling and prevent accidental creation
  const handleColumnClick = useCallback(
    (meta: {
      dayKey: string;
      hasWakeAnchor: boolean;
      wakeMinutes: number;
      events: MiniEvent[];
      day: TimelineDay;
    }) =>
      (event: ReactPointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
        if (dragState || composer) {
          return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest("button")) {
          return;
        }
        // Removed event.preventDefault() to allow scrolling
        const container = event.currentTarget;
        const rect = container.getBoundingClientRect();
        if (rect.height === 0) {
          return;
        }
        const offsetY = event.clientY - rect.top;
        if (offsetY < 0 || offsetY > rect.height) {
          return;
        }
        const ratio = offsetY / rect.height;
        const minutes = clampMinutesValue(Math.round(ratio * MINUTES_IN_DAY));
        const isNearExisting = meta.events.some((current) => {
          const startMinutes = clampMinutesValue(
            getMinutesFromZdt(current.start)
          );
          const threshold =
            current.kind === "wake"
              ? HOVER_WAKE_THRESHOLD_MINUTES
              : HOVER_EVENT_THRESHOLD_MINUTES;
          return Math.abs(startMinutes - minutes) <= threshold;
        });

        const canCreateWake =
          Boolean(onAddAnchor) &&
          !meta.hasWakeAnchor &&
          Math.abs(meta.wakeMinutes - minutes) <= HOVER_WAKE_THRESHOLD_MINUTES;

        if (canCreateWake) {
          handleHoverCreate("wake", meta.day, meta.wakeMinutes);
          return;
        }

        if (onAddEvent && !isNearExisting) {
          handleHoverCreate("event", meta.day, minutes);
        }
      },
    [composer, dragState, handleHoverCreate, onAddAnchor, onAddEvent]
  );

  useEffect(() => {
    const totalDays = timelineByDay.length;
    if (totalDays === 0) {
      setDaysPerPage(MIN_DAYS_PER_PAGE);
      setContainerWidth(0);
      return;
    }

    const calculateLayout = () => {
      const width = scrollContainer?.clientWidth ?? 0;
      setContainerWidth(width);

      const rawCount =
        width > 0
          ? Math.floor(
            (width + DAY_GAP_PX) / (DAY_COLUMN_WIDTH_PX + DAY_GAP_PX)
          )
          : MIN_DAYS_PER_PAGE;
      const desired = Math.max(
        MIN_DAYS_PER_PAGE,
        rawCount || MIN_DAYS_PER_PAGE
      );
      const clamped = Math.min(desired, totalDays);

      setDaysPerPage((previous) => (previous === clamped ? previous : clamped));
    };

    calculateLayout();

    if (!scrollContainer) {
      return;
    }

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(calculateLayout);
      observer.observe(scrollContainer);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", calculateLayout);
    return () => window.removeEventListener("resize", calculateLayout);
  }, [scrollContainer, timelineByDay.length]);

  useEffect(() => {
    setPageIndex((prev) => {
      const maxPage = Math.max(
        0,
        Math.ceil(timelineByDay.length / daysPerPage) - 1
      );
      return Math.min(prev, maxPage);
    });
  }, [daysPerPage, timelineByDay.length]);

  if (timelineByDay.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Mini calendar becomes available once you provide plan details.
      </div>
    );
  }

  const startIndex = pageIndex * daysPerPage;
  const visibleTimeline = timelineByDay.slice(
    startIndex,
    startIndex + daysPerPage
  );
  const hasPrevious = startIndex > 0;
  const hasNext = startIndex + daysPerPage < timelineByDay.length;
  const maxPageIndex = Math.max(
    0,
    Math.ceil(timelineByDay.length / daysPerPage) - 1
  );
  const visibleCount = visibleTimeline.length;
  const dayColumnWidth =
    visibleCount > 0 && containerWidth > 0
      ? Math.max(
        DAY_COLUMN_WIDTH_PX,
        (containerWidth - Math.max(0, visibleCount - 1) * DAY_GAP_PX) /
        visibleCount
      )
      : DAY_COLUMN_WIDTH_PX;
  const composerDay = composer
    ? timelineByDay.find(
      (item) => item.day.wakeDisplayDate.toString() === composer.dayKey
    )
    : null;


  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card/70 p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="font-semibold uppercase tracking-[0.18em]">
              Mini calendar
            </span>
            <span className="text-muted-foreground">
              All times in {displayZoneId}
            </span>
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
              Prev {daysPerPage} days
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() =>
                setPageIndex((prev) =>
                  hasNext ? Math.min(prev + 1, maxPageIndex) : prev
                )
              }
              disabled={!hasNext}
            >
              Next {daysPerPage} days
            </Button>
          </div>
        </div>
      </div>
      <div className="rounded-lg border bg-card/80 p-3 shadow-sm">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `${AXIS_WIDTH} 1fr`,
            height: TOTAL_HEIGHT,
          }}
        >
          <div
            className="flex flex-col items-end text-[10px] text-muted-foreground"
            style={{
              width: AXIS_WIDTH,
              minWidth: AXIS_WIDTH,
              height: TOTAL_HEIGHT,
            }}
          >
            <div className="h-10" />
            <div
              className="relative w-full"
              style={{ height: TIMELINE_HEIGHT }}
            >
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
              <div
                ref={setScrollContainerRef}
                className="flex-1 overflow-x-auto pt-2"
              >
                <div className="flex h-full gap-4">
                  {visibleTimeline.map(
                    ({
                      day,
                      segments,
                      events,
                      hasWakeAnchor,
                      wakeMinutes,
                    }) => {
                      const isoDate = day.wakeDisplayDate;
                      const dayKey = isoDate.toString();
                      const weekday = isoDate.toLocaleString("en-US", {
                        weekday: "short",
                      });
                      const dateLabel = isoDate.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                      });

                      return (
                        <div
                          key={dayKey}
                          className="relative h-full flex-shrink-0"
                          ref={registerDayColumn(dayKey)}
                          style={{
                            width: `${dayColumnWidth}px`,
                            minWidth: `${DAY_COLUMN_WIDTH_PX}px`,
                          }}
                        >
                          <div className="absolute inset-x-0 top-0 flex h-10 items-center px-2 text-xs text-muted-foreground">
                            <div className="flex flex-col leading-tight">
                              <span className="font-semibold text-foreground">
                                {weekday}
                              </span>
                              <span>{dateLabel}</span>
                            </div>
                          </div>
                          <div className="absolute inset-x-0 bottom-0 top-10 flex flex-col">
                            <div
                              className="relative flex-1 w-full overflow-visible touch-pan-x"
                              onPointerMove={handleColumnPointerMove({
                                dayKey,
                                hasWakeAnchor,
                                wakeMinutes,
                                events,
                                day,
                              })}
                              onClick={handleColumnClick({
                                dayKey,
                                hasWakeAnchor,
                                wakeMinutes,
                                events,
                                day,
                              })}
                              onPointerLeave={handleColumnPointerLeave}
                            >
                              <div className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 bg-border" />
                              {segments.map((segment, index) => (
                                <div
                                  key={`${segment.type}-${index}-${dayKey}`}
                                  className={`absolute left-1/2 z-10 w-[6px] -translate-x-1/2 rounded-full ${colourForSegment(segment.type)}`}
                                  style={{
                                    top: `${(segment.start / MINUTES_IN_DAY) * 100}%`,
                                    height: `${((segment.end - segment.start) / MINUTES_IN_DAY) * 100}%`,
                                  }}
                                />
                              ))}

                              {events.map((item) => (
                                <EventItem
                                  key={item.id}
                                  item={item}
                                  isActive={expandedEventId === item.id}
                                  onEditEvent={onEditEvent}
                                  onEditAnchor={onEditAnchor}
                                  onPointerDown={handlePointerDown}
                                  onPointerMove={handlePointerMove}
                                  onPointerUp={handlePointerUp}
                                  onPointerCancel={handlePointerCancel}
                                  onClick={handleButtonClick}
                                />
                              ))}
                              {
                                hoverTarget && hoverTarget.dayKey === dayKey ? (
                                  <button
                                    type="button"
                                    className={`absolute left-1/2 z-30 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-sm font-semibold leading-none shadow-sm focus-visible:outline-none focus-visible:ring-2 ${hoverTarget.type === "wake"
                                      ? "bg-emerald-500/70 border-emerald-600 text-emerald-900 focus-visible:ring-emerald-500/70"
                                      : "bg-white/90 border-border text-foreground focus-visible:ring-ring/60"
                                      }`}
                                    style={{
                                      top: `${(
                                        hoverTarget.minutes / MINUTES_IN_DAY
                                      ) * 100}%`,
                                    }}
                                    onClick={() =>
                                      handleHoverCreate(
                                        hoverTarget.type,
                                        day,
                                        hoverTarget.minutes
                                      )
                                    }
                                    aria-label={
                                      hoverTarget.type === "wake"
                                        ? `Add wake anchor on ${dateLabel}`
                                        : `Add event on ${dateLabel}`
                                    }
                                  >
                                    +
                                  </button>
                                ) : null
                              }
                            </div>
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        {composer && composerDay ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50">
            <MiniCalendarComposer
              mode={composer.type}
              dayKey={composer.dayKey}
              dayLabel={
                composerDay.day.wakeDisplayDate.toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })
              }
              initialValues={{
                startOrTime: composer.initialStart,
                end: composer.initialEnd,
              }}
              displayZoneId={displayZoneId}
              onAddEvent={onAddEvent}
              onAddAnchor={onAddAnchor}
              onCancel={closeComposer}
              className="shadow-2xl"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default MiniCalendarView;
