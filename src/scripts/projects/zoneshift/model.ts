import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export type ZoneId = string;

export type ShiftDirection = "later" | "earlier";

const ZoneIdSchema = z.string().min(1, "Zone id required");

export const AnchorPointSchema = z.object({
  id: z.string().min(1),
  kind: z.union([z.literal("wake"), z.literal("sleep")]),
  instant: z.string().datetime(),
  zone: ZoneIdSchema,
  note: z.string().optional(),
});

export type AnchorPoint = z.infer<typeof AnchorPointSchema>;

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
  homeZone: ZoneIdSchema,
  targetZone: ZoneIdSchema,
  startSleepUtc: z.string().datetime(),
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
  defaultShiftAnchor: AnchorPointSchema.optional(),
  anchors: z.array(AnchorPointSchema),
  events: z.array(EventItemSchema),
  prefs: CorePrefsSchema,
});

export type CorePlan = z.infer<typeof CorePlanSchema>;

export interface DayComputed {
  dateTargetZone: string;
  changeThisDayHours: number;
  sleepStartLocal: string;
  sleepEndLocal: string;
  sleepStartZoned: string;
  sleepEndZoned: string;
  brightStartLocal: string;
  brightEndLocal: string;
  brightStartZoned: string;
  brightEndZoned: string;
  wakeTimeLocal: string;
  anchors: DayAnchorInfo[];
}

export interface ComputedView {
  days: DayComputed[];
  projectedEvents: Array<EventItem & { startZoned: string; endZoned?: string }>;
  projectedAnchors: Array<AnchorPoint & { zonedDateTime: string }>;
  meta: {
    totalDeltaHours: number;
    direction: ShiftDirection;
    perDayShifts: number[];
  };
}

export interface InterpPolicy {
  maxLaterPerDay: number;
  maxEarlierPerDay: number;
}

export interface DayAnchorInfo {
  id: string;
  kind: AnchorPoint["kind"];
  note?: string;
  instant: string;
  editable: boolean;
}

interface AnchorResolved {
  anchor: AnchorPoint;
  wake: Temporal.ZonedDateTime;
}

interface ShiftStrategy {
  direction: ShiftDirection;
  shiftAmountHours: number;
  daysNeeded: number;
}

const MINUTE = 60;
const NANOS_PER_HOUR = MINUTE * MINUTE * 1_000_000_000;

const computeZoneDeltaHours = (core: CorePlan, startInstant: Temporal.Instant) => {
  const targetOffset = startInstant.toZonedDateTimeISO(core.params.targetZone).offsetNanoseconds;
  const homeOffset = startInstant.toZonedDateTimeISO(core.params.homeZone).offsetNanoseconds;
  const deltaNanoseconds = targetOffset - homeOffset;
  return deltaNanoseconds / NANOS_PER_HOUR;
};

const normalizeShift = (
  params: CoreParams,
  totalDeltaHours: number,
): ShiftStrategy => {
  const { maxShiftLaterPerDayHours, maxShiftEarlierPerDayHours } = params;
  const baseShift = -totalDeltaHours;

  const laterShift = baseShift >= 0 ? baseShift : baseShift + 24;
  const earlierShift = baseShift <= 0 ? baseShift : baseShift - 24;

  const computeDaysNeeded = (shift: number, maxPerDay: number) =>
    shift === 0 ? 0 : Math.max(1, Math.ceil(Math.abs(shift) / maxPerDay));

  const laterDays = computeDaysNeeded(laterShift, maxShiftLaterPerDayHours);
  const earlierDays = computeDaysNeeded(earlierShift, maxShiftEarlierPerDayHours);

  if (laterDays <= earlierDays) {
    return {
      direction: "later",
      shiftAmountHours: laterShift,
      daysNeeded: laterDays,
    };
  }

  return {
    direction: "earlier",
    shiftAmountHours: earlierShift,
    daysNeeded: earlierDays,
  };
};

const resolveAnchorWake = (
  anchor: AnchorPoint,
  targetZone: ZoneId,
  sleepDurationMinutes: number,
): Temporal.ZonedDateTime | null => {
  try {
    const base = Temporal.Instant.from(anchor.instant).toZonedDateTimeISO(anchor.zone);
    const inTarget = base.withTimeZone(targetZone);
    if (anchor.kind === "wake") {
      return inTarget;
    }
    return inTarget.add({ minutes: sleepDurationMinutes });
  } catch (error) {
    console.error("Failed to resolve anchor", anchor, error);
    return null;
  }
};

const enumerateDates = (start: Temporal.PlainDate, end: Temporal.PlainDate) => {
  const dates: Temporal.PlainDate[] = [];
  let cursor = start;
  while (Temporal.PlainDate.compare(cursor, end) <= 0) {
    dates.push(cursor);
    cursor = cursor.add({ days: 1 });
  }
  return dates;
};

const computeWakeSchedule = (
  resolvedAnchors: AnchorResolved[],
  dateRange: Temporal.PlainDate[],
  policy: InterpPolicy,
) => {
  const wakeMap = new Map<string, Temporal.ZonedDateTime>();
  if (resolvedAnchors.length === 0) {
    return wakeMap;
  }

  const ordered = [...resolvedAnchors].sort((a, b) =>
    Temporal.Instant.compare(a.wake.toInstant(), b.wake.toInstant()),
  );

  const dateSet = new Set(dateRange.map((d) => d.toString()));

  for (const item of ordered) {
    const key = item.wake.toPlainDate().toString();
    if (dateSet.has(key) && !wakeMap.has(key)) {
      wakeMap.set(key, item.wake);
    }
  }

  for (let i = 0; i < ordered.length - 1; i += 1) {
    const left = ordered[i];
    const right = ordered[i + 1];

    let cursor = left.wake.toPlainDate();
    const endDate = right.wake.toPlainDate();
    const segmentDates: Temporal.PlainDate[] = [];
    while (Temporal.PlainDate.compare(cursor, endDate) <= 0) {
      if (dateSet.has(cursor.toString())) {
        segmentDates.push(cursor);
      }
      if (Temporal.PlainDate.compare(cursor, endDate) === 0) {
        break;
      }
      cursor = cursor.add({ days: 1 });
    }

    if (segmentDates.length < 2) {
      continue;
    }

    const wakes = interpolateDailyWakeTimes(left.wake, right.wake, segmentDates, policy);
    for (let idx = 0; idx < segmentDates.length; idx += 1) {
      const key = segmentDates[idx].toString();
      if (idx === segmentDates.length - 1 || !wakeMap.has(key)) {
        wakeMap.set(key, wakes[idx]);
      }
    }
  }

  let previous: Temporal.ZonedDateTime | undefined;
  for (const date of dateRange) {
    const key = date.toString();
    if (wakeMap.has(key)) {
      previous = wakeMap.get(key);
      continue;
    }
    if (previous) {
      const fallback = previous.add({ days: 1 });
      wakeMap.set(key, fallback);
      previous = fallback;
    }
  }

  // Fill any initial gap by backfilling from first known wake.
  const firstKnownKey = dateRange.find((date) => wakeMap.has(date.toString()));
  if (firstKnownKey) {
    let cursor = firstKnownKey;
    let currentWake = wakeMap.get(cursor.toString());
    while (currentWake && Temporal.PlainDate.compare(dateRange[0], cursor) < 0) {
      cursor = cursor.subtract({ days: 1 });
      currentWake = currentWake.subtract({ days: 1 });
      const key = cursor.toString();
      if (!wakeMap.has(key)) {
        wakeMap.set(key, currentWake);
      }
    }
  }

  return wakeMap;
};

export function interpolateDailyWakeTimes(
  startWake: Temporal.ZonedDateTime,
  endWake: Temporal.ZonedDateTime,
  dates: Array<string | Temporal.PlainDate>,
  policy: InterpPolicy,
): Temporal.ZonedDateTime[] {
  if (dates.length === 0) {
    return [];
  }

  if (dates.length === 1) {
    return [startWake];
  }

  const plainDates = dates.map((value) =>
    typeof value === "string" ? Temporal.PlainDate.from(value) : value,
  );
  const intervals = plainDates.length - 1;
  const baseMinutes = intervals * 24 * MINUTE;
  const totalMinutes = (
    endWake.toInstant().epochMilliseconds - startWake.toInstant().epochMilliseconds
  ) / (MINUTE * 1000);
  const shiftMinutes = totalMinutes - baseMinutes;
  const rawPerDay = shiftMinutes / intervals;
  const maxLater = Math.round(policy.maxLaterPerDay * MINUTE);
  const maxEarlier = -Math.round(policy.maxEarlierPerDay * MINUTE);
  const stepMinutes = Math.min(Math.max(rawPerDay, maxEarlier), maxLater);

  const result: Temporal.ZonedDateTime[] = [];
  let current = startWake;
  result.push(current);

  for (let i = 1; i < intervals; i += 1) {
    current = current.add({ days: 1, minutes: stepMinutes });
    result.push(current);
  }

  result.push(endWake);
  return result;
}

export function computeBrightWindow(
  wake: Temporal.ZonedDateTime,
  _sleepStart: Temporal.ZonedDateTime,
): { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime } {
  const brightStart = wake;
  const brightEnd = wake.add({ hours: 5 });

  const zoneId = wake.timeZoneId;
  const dayStart = Temporal.ZonedDateTime.from({
    timeZone: zoneId,
    year: wake.year,
    month: wake.month,
    day: wake.day,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });
  const dayEnd = dayStart.add({ days: 1 });

  let clampedStart = brightStart;
  let clampedEnd = brightEnd;

  if (Temporal.Instant.compare(clampedStart.toInstant(), dayStart.toInstant()) < 0) {
    clampedStart = dayStart;
  }

  if (Temporal.Instant.compare(clampedEnd.toInstant(), dayEnd.toInstant()) > 0) {
    clampedEnd = dayEnd;
  }

  if (Temporal.Instant.compare(clampedEnd.toInstant(), clampedStart.toInstant()) <= 0) {
    return { start: clampedStart, end: clampedStart };
  }

  return { start: clampedStart, end: clampedEnd };
}

const projectEvent = (
  event: EventItem,
  zone: ZoneId,
): (EventItem & { startZoned: string; endZoned?: string }) | null => {
  try {
    const startInstant = Temporal.Instant.from(event.start);
    const startZoned = startInstant.toZonedDateTimeISO(zone).toString({
      smallestUnit: "minute",
      fractionalSecondDigits: 0,
    });

    let endZoned: string | undefined;
    if (event.end) {
      endZoned = Temporal.Instant.from(event.end).toZonedDateTimeISO(zone).toString({
        smallestUnit: "minute",
        fractionalSecondDigits: 0,
      });
    }

    return {
      ...event,
      startZoned,
      ...(endZoned ? { endZoned } : {}),
    };
  } catch (error) {
    console.error("Failed to project event", event.id, error);
    return null;
  }
};

const projectAnchor = (anchor: AnchorPoint, zone: ZoneId) => {
  const zdt = Temporal.Instant.from(anchor.instant)
    .toZonedDateTimeISO(anchor.zone)
    .withTimeZone(zone);
  return {
    ...anchor,
    zonedDateTime: zdt.toString({ smallestUnit: "minute", fractionalSecondDigits: 0 }),
  };
};

export function makeDefaultShiftAnchor(core: CorePlan): AnchorPoint {
  const targetZone = core.params.targetZone;
  const startSleepInstant = Temporal.Instant.from(core.params.startSleepUtc);
  const startSleep = startSleepInstant.toZonedDateTimeISO(targetZone);
  const sleepDurationMinutes = Math.round(core.params.sleepHours * MINUTE);
  const sleepDuration = Temporal.Duration.from({ minutes: sleepDurationMinutes });
  const startInstant = startSleep.toInstant();
  const totalDeltaHours = computeZoneDeltaHours(core, startInstant);
  const strategy = normalizeShift(core.params, totalDeltaHours);

  const shiftedStartSleep = startSleep.add({ days: strategy.daysNeeded });
  const alignedSleepStart = shiftedStartSleep.add({
    minutes: Math.round(strategy.shiftAmountHours * MINUTE),
  });
  const alignedWake = alignedSleepStart.add(sleepDuration);

  return {
    id: "default-shift-anchor",
    kind: "wake",
    instant: alignedWake.toInstant().toString(),
    zone: targetZone,
    note: "Auto-generated alignment anchor",
  };
}

export function projectInstant(iso: string, zone: ZoneId) {
  const instant = Temporal.Instant.from(iso);
  return instant
    .toZonedDateTimeISO(zone)
    .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });
}

export function computePlan(core: CorePlan): ComputedView {
  const targetZone = core.params.targetZone;
  const sleepDurationMinutes = Math.round(core.params.sleepHours * MINUTE);
  const sleepDuration = Temporal.Duration.from({ minutes: sleepDurationMinutes });
  const startSleepInstant = Temporal.Instant.from(core.params.startSleepUtc);
  const startSleep = startSleepInstant.toZonedDateTimeISO(targetZone);
  const initialWake = startSleep.add(sleepDuration);
  const defaultAnchor = core.defaultShiftAnchor ?? makeDefaultShiftAnchor(core);
  const displayZone =
    core.prefs?.displayZone === "home" ? core.params.homeZone : core.params.targetZone;

  const anchors: AnchorPoint[] = [
    defaultAnchor,
    {
      id: "__initial-wake",
      kind: "wake",
      instant: initialWake.toInstant().toString(),
      zone: targetZone,
    },
    ...core.anchors,
  ];

  const resolvedAnchors: AnchorResolved[] = anchors
    .map((anchor) => {
      const wake = resolveAnchorWake(anchor, targetZone, sleepDurationMinutes);
      if (!wake) {
        return null;
      }
      return { anchor, wake } satisfies AnchorResolved;
    })
    .filter((value): value is AnchorResolved => value !== null);

  const anchorMap = new Map<string, DayAnchorInfo[]>();
  for (const item of resolvedAnchors) {
    const rawAnchorMoment =
      item.anchor.kind === "wake" ? item.wake : item.wake.subtract(sleepDuration);
    const dayKey = rawAnchorMoment.toPlainDate().toString();
    const anchorInstant = rawAnchorMoment.toInstant().toString();
    const isSystemAnchor =
      item.anchor.id === "default-shift-anchor" || item.anchor.id.startsWith("__");
    const info: DayAnchorInfo = {
      id: item.anchor.id,
      kind: item.anchor.kind,
      note: item.anchor.note,
      instant: anchorInstant,
      editable: !isSystemAnchor,
    };
    const existing = anchorMap.get(dayKey);
    if (existing) {
      existing.push(info);
    } else {
      anchorMap.set(dayKey, [info]);
    }
  }

  const maxWakeDate = resolvedAnchors.length
    ? resolvedAnchors
        .map((entry) => entry.wake.toPlainDate())
        .reduce((latest, current) =>
          Temporal.PlainDate.compare(current, latest) > 0 ? current : latest,
        )
    : initialWake.toPlainDate();
  const dateRange = enumerateDates(startSleep.toPlainDate(), maxWakeDate);

  const wakeSchedule = computeWakeSchedule(resolvedAnchors, dateRange, {
    maxLaterPerDay: core.params.maxShiftLaterPerDayHours,
    maxEarlierPerDay: core.params.maxShiftEarlierPerDayHours,
  });

  const days: DayComputed[] = [];
  const perDayShifts: number[] = [];
  let previousSleepStart: Temporal.ZonedDateTime | undefined;

  for (const date of dateRange) {
    const key = date.toString();
    const wake = wakeSchedule.get(key);
    if (!wake) {
      continue;
    }

    const sleepStart = wake.subtract(sleepDuration);
    const sleepStartDisplay = sleepStart.withTimeZone(displayZone);
    const wakeDisplay = wake.withTimeZone(displayZone);
    const brightWindow = computeBrightWindow(wake, sleepStart);
    const brightStartDisplay = brightWindow.start.withTimeZone(displayZone);
    const brightEndDisplay = brightWindow.end.withTimeZone(displayZone);

    let changeHours = 0;
    if (previousSleepStart) {
      const baseline = previousSleepStart.add({ days: 1 });
      const diffMinutes = sleepStart.since(baseline).total({ unit: "minutes" });
      changeHours = diffMinutes / MINUTE;
    }

    perDayShifts.push(changeHours);

    const isoOptions = { smallestUnit: "minute", fractionalSecondDigits: 0 } as const;
    const sleepStartDisplayIso = sleepStartDisplay.toString(isoOptions);
    const sleepEndDisplayIso = wakeDisplay.toString(isoOptions);
    const brightStartDisplayIso = brightStartDisplay.toString(isoOptions);
    const brightEndDisplayIso = brightEndDisplay.toString(isoOptions);
    const sleepStartLocal = sleepStartDisplay
      .toPlainTime()
      .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });
    const sleepEndLocal = wakeDisplay
      .toPlainTime()
      .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });
    const brightStartLocal = brightStartDisplay
      .toPlainTime()
      .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });
    const brightEndLocal = brightEndDisplay
      .toPlainTime()
      .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });
    const wakeTimeLocal = wakeDisplay
      .toPlainTime()
      .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });

    days.push({
      dateTargetZone: key,
      changeThisDayHours: changeHours,
      sleepStartLocal,
      sleepEndLocal,
      sleepStartZoned: sleepStartDisplayIso,
      sleepEndZoned: sleepEndDisplayIso,
      brightStartLocal,
      brightEndLocal,
      brightStartZoned: brightStartDisplayIso,
      brightEndZoned: brightEndDisplayIso,
      wakeTimeLocal,
      anchors: anchorMap.get(key)?.map((anchor) => ({ ...anchor })) ?? [],
    });

    previousSleepStart = sleepStart;
  }

  if (perDayShifts.length > 0) {
    perDayShifts[0] = 0;
  }

  const startInstant = startSleep.toInstant();
  const totalDeltaHours = computeZoneDeltaHours(core, startInstant);
  const strategy = normalizeShift(core.params, totalDeltaHours);

  const projectedEvents = core.events
    .map((event) => projectEvent(event, displayZone))
    .filter((event): event is EventItem & { startZoned: string; endZoned?: string } => event !== null);

  const projectedAnchors = anchors.map((anchor) => projectAnchor(anchor, displayZone));

  return {
    days,
    projectedEvents,
    projectedAnchors,
    meta: {
      totalDeltaHours,
      direction: strategy.direction,
      perDayShifts,
    },
  };
}
