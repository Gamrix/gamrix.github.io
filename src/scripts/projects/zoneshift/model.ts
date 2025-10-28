import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export type ZoneId = string;

export type ShiftDirection = "later" | "earlier";

const ZoneIdSchema = z.string().min(1, "Zone id required");

export const WakeAnchorSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("wake"),
  instant: z.string().datetime(),
  zone: ZoneIdSchema,
  note: z.string().optional(),
});

export type WakeAnchor = z.infer<typeof WakeAnchorSchema>;

export const EventItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  start: z.string().datetime(),
  end: z.string().datetime().optional(),
  zone: ZoneIdSchema,
  colorHint: z.string().optional(),
});

export type EventItem = z.infer<typeof EventItemSchema>;

export const CoreParamsSchema = z.object({
  startTimeZone: ZoneIdSchema,
  endTimeZone: ZoneIdSchema,
  startSleepUtc: z.string().datetime(),
  endWakeUtc: z.string().datetime(),
  sleepHours: z.number().min(0.25).max(18),
  maxShiftLaterPerDayHours: z.number().min(0).max(12),
  maxShiftEarlierPerDayHours: z.number().min(0).max(12),
});

export type CoreParams = z.infer<typeof CoreParamsSchema>;

export const CorePrefsSchema = z
  .object({
    displayZone: z.union([z.literal("home"), z.literal("target")]).optional(),
    timeStepMinutes: z.number().int().min(1).max(240).optional(),
  })
  .optional();

export const CorePlanSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  params: CoreParamsSchema,
  anchors: z.array(WakeAnchorSchema),
  events: z.array(EventItemSchema),
  prefs: CorePrefsSchema,
});

export type CorePlan = z.infer<typeof CorePlanSchema>;

export type ScheduleEvent = {
  id: string;
  kind: "sleep" | "bright" | "wake";
  startInstant: Temporal.Instant;
  endInstant?: Temporal.Instant;
  anchorId?: string;
};

export type WakeScheduleEntry = {
  wakeEvent: ScheduleEvent;
  sleepEvent: ScheduleEvent;
  brightEvent: ScheduleEvent;
  anchor?: WakeAnchor;
  shiftFromPreviousWakeHours: number;
};

export type DisplayEvent = {
  id: string;
  kind: "sleep" | "bright" | "wake" | "manual";
  startZoned: Temporal.ZonedDateTime;
  endZoned?: Temporal.ZonedDateTime;
  splitFrom?: string;
  splitPart?: "start" | "end";
  anchorId?: string;
  shiftFromPreviousWakeHours?: number;
  title?: string;
  colorHint?: string;
  originalZone?: string;
};

export type DisplayDay = {
  date: Temporal.PlainDate;
  events: DisplayEvent[];
};

export type ComputedView = {
  wakeSchedule: WakeScheduleEntry[];
  displayDays: DisplayDay[];
  manualEvents: DisplayEvent[];
  meta: {
    totalDeltaHours: number;
  };
};

export type InterpPolicy = {
  maxLaterPerDay: number;
  maxEarlierPerDay: number;
};

type AnchorResolved = {
  anchor: WakeAnchor;
  wake: Temporal.Instant;
};

const MINUTE = 60;
const NANOS_PER_HOUR = MINUTE * MINUTE * 1_000_000_000;

const toRoundedZonedDateTime = (
  instantIso: string,
  sourceZone: ZoneId,
  targetZone: ZoneId
) =>
  Temporal.Instant.from(instantIso)
    .toZonedDateTimeISO(sourceZone)
    .withTimeZone(targetZone)
    .round({ smallestUnit: "minute", roundingMode: "halfExpand" });

const computeZoneDeltaHours = (
  core: CorePlan,
  startInstant: Temporal.Instant
) => {
  const endOffset = startInstant.toZonedDateTimeISO(
    core.params.endTimeZone
  ).offsetNanoseconds;
  const startOffset = startInstant.toZonedDateTimeISO(
    core.params.startTimeZone
  ).offsetNanoseconds;
  const deltaNanoseconds = endOffset - startOffset;
  return deltaNanoseconds / NANOS_PER_HOUR;
};

export function projectInstant(iso: string, zone: ZoneId) {
  return toRoundedZonedDateTime(iso, zone, zone).toString({
    smallestUnit: "minute",
    fractionalSecondDigits: 0,
  });
}

export const resolvePlanContext = (core: CorePlan) => {
  const sleepDuration = Temporal.Duration.from({
    minutes: Math.round(core.params.sleepHours * MINUTE),
  });
  const startSleepInstant = Temporal.Instant.from(core.params.startSleepUtc);
  const endWakeInstant = Temporal.Instant.from(core.params.endWakeUtc);
  const totalDeltaHours = computeZoneDeltaHours(core, startSleepInstant);
  const startWakeInstant = startSleepInstant.add(sleepDuration);

  return {
    sleepDuration,
    startSleepInstant,
    startWakeInstant,
    endWakeInstant,
    totalDeltaHours,
  };
};

export function computePlan(core: CorePlan): ComputedView {
  const context = resolvePlanContext(core);
  const displayZone =
    core.prefs?.displayZone === "home"
      ? core.params.startTimeZone
      : core.params.endTimeZone;

  // Step 2: Prepare anchors (auto-generate start and end in their respective zones)
  const anchors: WakeAnchor[] = [...core.anchors];

  // Check if we need to auto-generate start anchor
  const startDayStart = context.startWakeInstant.toZonedDateTimeISO(core.params.startTimeZone)
    .toPlainDate().toZonedDateTime({ timeZone: core.params.startTimeZone, plainTime: "00:00" });
  const startDayEnd = startDayStart.add({ days: 1 });
  const hasStartAnchor = anchors.some((a) => {
    const instant = Temporal.Instant.from(a.instant);
    return Temporal.Instant.compare(instant, startDayStart.toInstant()) >= 0 &&
           Temporal.Instant.compare(instant, startDayEnd.toInstant()) < 0;
  });
  if (!hasStartAnchor) {
    anchors.push({
      id: "__auto-start",
      kind: "wake",
      instant: context.startWakeInstant.toString(),
      zone: core.params.startTimeZone,
    });
  }

  // Check if we need to auto-generate end anchor
  const endDayStart = context.endWakeInstant.toZonedDateTimeISO(core.params.endTimeZone)
    .toPlainDate().toZonedDateTime({ timeZone: core.params.endTimeZone, plainTime: "00:00" });
  const endDayEnd = endDayStart.add({ days: 1 });
  const hasEndAnchor = anchors.some((a) => {
    const instant = Temporal.Instant.from(a.instant);
    return Temporal.Instant.compare(instant, endDayStart.toInstant()) >= 0 &&
           Temporal.Instant.compare(instant, endDayEnd.toInstant()) < 0;
  });
  if (!hasEndAnchor) {
    anchors.push({
      id: "__auto-end",
      kind: "wake",
      instant: context.endWakeInstant.toString(),
      zone: core.params.endTimeZone,
    });
  }

  // Convert anchors to UTC for processing
  const resolvedAnchors: AnchorResolved[] = anchors
    .map((anchor) => ({
      anchor,
      wake: Temporal.Instant.from(anchor.instant),
    }))
    .sort((a, b) => Temporal.Instant.compare(a.wake, b.wake));

  // Step 4: Interpolate wake times with 6-hour buffer
  const wakeInstants: { instant: Temporal.Instant; anchorId?: string }[] = [];

  for (let i = 0; i < resolvedAnchors.length; i++) {
    const current = resolvedAnchors[i];
    wakeInstants.push({ instant: current.wake, anchorId: current.anchor.id });

    // Fill forward until next anchor (with 6-hour buffer)
    if (i < resolvedAnchors.length - 1) {
      const next = resolvedAnchors[i + 1];
      const nextSleepStart = next.wake.subtract(context.sleepDuration);
      const buffer = Temporal.Duration.from({ hours: 6 });
      const stopBefore = nextSleepStart.subtract(buffer);

      let fillWake = current.wake.add(Temporal.Duration.from({ hours: 24 }));
      while (Temporal.Instant.compare(fillWake, stopBefore) < 0) {
        wakeInstants.push({ instant: fillWake });
        fillWake = fillWake.add(Temporal.Duration.from({ hours: 24 }));
      }
    }
  }

  // Step 5: Generate ScheduleEvent objects
  const schedule: WakeScheduleEntry[] = [];
  let previousWakeInstant: Temporal.Instant | undefined;

  for (const { instant, anchorId } of wakeInstants) {
    const sleepStartInstant = instant.subtract(context.sleepDuration);
    const brightEndInstant = instant.add(Temporal.Duration.from({ hours: 5 }));

    const baseId = anchorId || instant.toString();
    const anchor = anchorId ? anchors.find((a) => a.id === anchorId) : undefined;

    let shiftHours = 0;
    if (previousWakeInstant) {
      const diffMinutes = instant.since(previousWakeInstant).total({ unit: "minutes" });
      shiftHours = (diffMinutes - 24 * MINUTE) / MINUTE;
    }

    schedule.push({
      wakeEvent: {
        id: `${baseId}-wake`,
        kind: "wake",
        startInstant: instant,
        anchorId,
      },
      sleepEvent: {
        id: `${baseId}-sleep`,
        kind: "sleep",
        startInstant: sleepStartInstant,
        endInstant: instant,
        anchorId,
      },
      brightEvent: {
        id: `${baseId}-bright`,
        kind: "bright",
        startInstant: instant,
        endInstant: brightEndInstant,
        anchorId,
      },
      anchor,
      shiftFromPreviousWakeHours: shiftHours,
    });

    previousWakeInstant = instant;
  }

  // Step 6: Project to display zone and split events
  const allDisplayEvents: DisplayEvent[] = [];

  for (const entry of schedule) {
    for (const event of [entry.sleepEvent, entry.wakeEvent, entry.brightEvent]) {
      const projected = projectScheduleEventToDisplay(event, displayZone, entry.shiftFromPreviousWakeHours);
      allDisplayEvents.push(...projected);
    }
  }

  // Project manual events
  const manualEvents: DisplayEvent[] = core.events.map((event) => {
    const startZoned = toRoundedZonedDateTime(event.start, event.zone, displayZone);
    const endZoned = event.end
      ? toRoundedZonedDateTime(event.end, event.zone, displayZone)
      : undefined;

    const projected: DisplayEvent = {
      id: event.id,
      kind: "manual",
      startZoned,
      endZoned,
      title: event.title,
      colorHint: event.colorHint,
      originalZone: event.zone,
    };

    return projected;
  }).flatMap((event) => splitEventByDay(event, displayZone));

  // Add manual events to all display events
  allDisplayEvents.push(...manualEvents);

  // Build display days
  const displayDays = buildDisplayDays(allDisplayEvents, displayZone);

  return {
    wakeSchedule: schedule,
    displayDays,
    manualEvents,
    meta: {
      totalDeltaHours: context.totalDeltaHours,
    },
  };
}

function projectScheduleEventToDisplay(
  event: ScheduleEvent,
  displayZone: ZoneId,
  shiftHours: number
): DisplayEvent[] {
  const startZoned = event.startInstant.toZonedDateTimeISO(displayZone);
  const endZoned = event.endInstant?.toZonedDateTimeISO(displayZone);

  const displayEvent: DisplayEvent = {
    id: event.id,
    kind: event.kind,
    startZoned,
    endZoned,
    anchorId: event.anchorId,
    shiftFromPreviousWakeHours: event.kind === "wake" ? shiftHours : undefined,
  };

  return splitEventByDay(displayEvent, displayZone);
}

function splitEventByDay(event: DisplayEvent, zone: ZoneId): DisplayEvent[] {
  if (!event.endZoned) {
    return [event];
  }

  const startDate = event.startZoned.toPlainDate();
  const endDate = event.endZoned.toPlainDate();

  if (Temporal.PlainDate.compare(startDate, endDate) === 0) {
    return [event];
  }

  const splits: DisplayEvent[] = [];
  let currentDate = startDate;
  let currentStart = event.startZoned;

  while (Temporal.PlainDate.compare(currentDate, endDate) <= 0) {
    const nextDayMidnight = currentDate.add({ days: 1 }).toZonedDateTime({
      timeZone: zone,
      plainTime: "00:00",
    });

    const isLastPart = Temporal.PlainDate.compare(currentDate, endDate) === 0;
    const currentEnd = isLastPart ? event.endZoned : nextDayMidnight;

    const isFirstPart = Temporal.PlainDate.compare(currentDate, startDate) === 0;

    splits.push({
      ...event,
      id: `${event.id}-${isFirstPart ? "start" : "end"}`,
      startZoned: currentStart,
      endZoned: currentEnd,
      splitFrom: event.id,
      splitPart: isFirstPart ? "start" : "end",
    });

    if (isLastPart) break;

    currentDate = currentDate.add({ days: 1 });
    currentStart = nextDayMidnight;
  }

  return splits;
}

function buildDisplayDays(events: DisplayEvent[], zone: ZoneId): DisplayDay[] {
  const dayMap = new Map<string, DisplayEvent[]>();

  for (const event of events) {
    const date = event.startZoned.toPlainDate();
    const key = date.toString();

    if (!dayMap.has(key)) {
      dayMap.set(key, []);
    }
    dayMap.get(key)!.push(event);
  }

  const days: DisplayDay[] = [];
  const sortedKeys = [...dayMap.keys()].sort();

  for (const key of sortedKeys) {
    days.push({
      date: Temporal.PlainDate.from(key),
      events: dayMap.get(key)!,
    });
  }

  return days;
}
