import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export type ZoneId = string;

export type ShiftDirection = "later" | "earlier";

const TimeStringSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:mm in 24h format");

const ZoneIdSchema = z.string().min(1, "Zone id required");

export const AnchorPointSchema = z.object({
  id: z.string().min(1),
  kind: z.union([z.literal("wake"), z.literal("sleep")]),
  localDate: z.string().date("Date must be YYYY-MM-DD"),
  localTime: TimeStringSchema,
  zone: ZoneIdSchema,
  note: z.string().optional(),
});

export type AnchorPoint = z.infer<typeof AnchorPointSchema>;

export const EventItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  local: z
    .object({
      date: z.string().date("Date must be YYYY-MM-DD"),
      time: TimeStringSchema,
      zone: ZoneIdSchema,
    })
    .optional(),
  localEnd: z
    .object({
      date: z.string().date("Date must be YYYY-MM-DD"),
      time: TimeStringSchema,
      zone: ZoneIdSchema,
    })
    .optional(),
  colorHint: z.string().optional(),
});

export type EventItem = z.infer<typeof EventItemSchema>;

export const CoreParamsSchema = z.object({
  homeZone: ZoneIdSchema,
  targetZone: ZoneIdSchema,
  startDateLocal: z.string().date("Date must be YYYY-MM-DD"),
  startSleepLocalTime: TimeStringSchema,
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

export const parseCorePlan = (input: unknown): CorePlan => CorePlanSchema.parse(input);

export interface DayComputed {
  dateTargetZone: string;
  changeThisDayHours: number;
  sleepStartLocal: string;
  sleepEndLocal: string;
  brightStartLocal: string;
  brightEndLocal: string;
  wakeTimeLocal: string;
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

interface AnchorResolved {
  anchor: AnchorPoint;
  wake: Temporal.ZonedDateTime;
}

interface ShiftStrategy {
  direction: ShiftDirection;
  shiftAmountHours: number;
  daysNeeded: number;
}

const DEFAULT_BRIGHT_FALLBACK = "--:--";

const MINUTE = 60;
const NANOS_PER_HOUR = MINUTE * MINUTE * 1_000_000_000;

const clamp = (value: number, lower: number, upper: number) =>
  Math.min(Math.max(value, lower), upper);

const hoursToMinutes = (hours: number) => Math.round(hours * MINUTE);

const minutesDuration = (minutes: number) => Temporal.Duration.from({ minutes });

const toPlainDate = (value: string | Temporal.PlainDate) =>
  typeof value === "string" ? Temporal.PlainDate.from(value) : value;

const formatTime = (zdt: Temporal.ZonedDateTime) =>
  zdt.toPlainTime().toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });

const addDays = (zdt: Temporal.ZonedDateTime, days: number) =>
  days === 0 ? zdt : zdt.add({ days });

const addMinutes = (zdt: Temporal.ZonedDateTime, minutes: number) =>
  minutes === 0 ? zdt : zdt.add(minutesDuration(minutes));

const toZonedDateTime = (date: string, time: string, zone: ZoneId) => {
  const plainDate = Temporal.PlainDate.from(date);
  const plainTime = Temporal.PlainTime.from(time);
  return Temporal.ZonedDateTime.from({
    timeZone: zone,
    year: plainDate.year,
    month: plainDate.month,
    day: plainDate.day,
    hour: plainTime.hour,
    minute: plainTime.minute,
    second: plainTime.second,
    millisecond: plainTime.millisecond,
    microsecond: plainTime.microsecond,
    nanosecond: plainTime.nanosecond,
  });
};

const getPolicy = (params: CoreParams): InterpPolicy => ({
  maxLaterPerDay: params.maxShiftLaterPerDayHours || 0,
  maxEarlierPerDay: params.maxShiftEarlierPerDayHours || 0,
});

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
  const policy = getPolicy(params);
  const baseShift = -totalDeltaHours;

  const laterShift = baseShift >= 0 ? baseShift : baseShift + 24;
  const earlierShift = baseShift <= 0 ? baseShift : baseShift - 24;

  const laterDays =
    laterShift === 0 || policy.maxLaterPerDay <= 0
      ? laterShift === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : Math.abs(laterShift) / policy.maxLaterPerDay;
  const earlierDays =
    earlierShift === 0 || policy.maxEarlierPerDay <= 0
      ? earlierShift === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : Math.abs(earlierShift) / policy.maxEarlierPerDay;

  if (laterDays === earlierDays) {
    return {
      direction: "later",
      shiftAmountHours: laterShift,
      daysNeeded:
        laterShift === 0
          ? 0
          : Math.max(1, Math.ceil(Math.abs(laterShift) / Math.max(policy.maxLaterPerDay, 0.0001))),
    };
  }

  if (laterDays < earlierDays) {
    return {
      direction: "later",
      shiftAmountHours: laterShift,
      daysNeeded:
        laterShift === 0
          ? 0
          : Math.max(1, Math.ceil(Math.abs(laterShift) / Math.max(policy.maxLaterPerDay, 0.0001))),
    };
  }

  return {
    direction: "earlier",
    shiftAmountHours: earlierShift,
    daysNeeded:
      earlierShift === 0
        ? 0
        : Math.max(1, Math.ceil(Math.abs(earlierShift) / Math.max(policy.maxEarlierPerDay, 0.0001))),
  };
};

const resolveAnchorWake = (
  anchor: AnchorPoint,
  targetZone: ZoneId,
  sleepDurationMinutes: number,
): Temporal.ZonedDateTime | null => {
  try {
    const base = toZonedDateTime(anchor.localDate, anchor.localTime, anchor.zone);
    const inTarget = base.withTimeZone(targetZone);
    if (anchor.kind === "wake") {
      return inTarget;
    }
    return inTarget.add(minutesDuration(sleepDurationMinutes));
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

const durationTotalMinutes = (duration: Temporal.Duration) =>
  duration.total({ unit: "minutes" });

const safeMinutes = (value: number) => Number.isFinite(value) ? value : 0;

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

  const plainDates = dates.map(toPlainDate);
  const intervals = plainDates.length - 1;
  const baseMinutes = intervals * 24 * MINUTE;
  const totalMinutes = (
    endWake.toInstant().epochMilliseconds - startWake.toInstant().epochMilliseconds
  ) / (MINUTE * 1000);
  const shiftMinutes = totalMinutes - baseMinutes;
  const rawPerDay = shiftMinutes / intervals;
  const maxLater = hoursToMinutes(policy.maxLaterPerDay);
  const maxEarlier = -hoursToMinutes(policy.maxEarlierPerDay);
  const stepMinutes = clamp(rawPerDay, maxEarlier, maxLater);

  const result: Temporal.ZonedDateTime[] = [];
  let current = startWake;
  result.push(current);

  for (let i = 1; i < intervals; i += 1) {
    current = current.add({ days: 1 }).add(minutesDuration(stepMinutes));
    result.push(current);
  }

  result.push(endWake);
  return result;
}

export function computeBrightWindow(
  wake: Temporal.ZonedDateTime,
  sleepStart: Temporal.ZonedDateTime,
): { start: string; end: string } {
  const wakePlusThirty = wake.add({ minutes: 30 });
  const wakePlusThreeHours = wake.add({ hours: 3 });
  const avoidLightStart = sleepStart.subtract({ hours: 3 });

  let start = wakePlusThirty;
  let end = avoidLightStart;

  const zoneId = wake.timeZoneId ?? wake.timeZone.id;
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

  if (Temporal.Instant.compare(start.toInstant(), dayStart.toInstant()) < 0) {
    start = dayStart;
  }

  if (Temporal.Instant.compare(end.toInstant(), dayEnd.toInstant()) > 0) {
    end = dayEnd;
  }

  if (Temporal.Instant.compare(end.toInstant(), start.toInstant()) <= 0) {
    const fallback = formatTime(wakePlusThreeHours);
    return { start: fallback, end: fallback };
  }

  return { start: formatTime(start), end: formatTime(end) };
}

const resolveEventInstant = (event: EventItem, key: "start" | "end") => {
  try {
    const iso = event[key];
    if (iso) {
      return Temporal.Instant.from(iso);
    }
    const local = key === "start" ? event.local : event.localEnd;
    if (local) {
      const zdt = toZonedDateTime(local.date, local.time, local.zone);
      return zdt.toInstant();
    }
    return null;
  } catch (error) {
    console.error("Failed to resolve event instant", event.id, key, error);
    return null;
  }
};

const projectEvent = (
  event: EventItem,
  zone: ZoneId,
): (EventItem & { startZoned: string; endZoned?: string }) | null => {
  const startInstant = resolveEventInstant(event, "start");
  if (!startInstant) {
    return null;
  }
  const startZoned = startInstant.toZonedDateTimeISO(zone).toString({
    smallestUnit: "minute",
    fractionalSecondDigits: 0,
  });
  const endInstant = resolveEventInstant(event, "end");
  const endZoned = endInstant
    ? endInstant.toZonedDateTimeISO(zone).toString({
        smallestUnit: "minute",
        fractionalSecondDigits: 0,
      })
    : undefined;
  return {
    ...event,
    startZoned,
    ...(endZoned ? { endZoned } : {}),
  };
};

const projectAnchor = (anchor: AnchorPoint, zone: ZoneId) => {
  try {
    const zdt = toZonedDateTime(anchor.localDate, anchor.localTime, anchor.zone).withTimeZone(zone);
    return {
      ...anchor,
      zonedDateTime: zdt.toString({ smallestUnit: "minute", fractionalSecondDigits: 0 }),
    };
  } catch (error) {
    console.error("Failed to project anchor", anchor.id, error);
    return null;
  }
};

const determineDisplayZone = (core: CorePlan): ZoneId =>
  core.prefs?.displayZone === "home" ? core.params.homeZone : core.params.targetZone;

export function makeDefaultShiftAnchor(core: CorePlan): AnchorPoint {
  const targetZone = core.params.targetZone;
  const startSleep = toZonedDateTime(
    core.params.startDateLocal,
    core.params.startSleepLocalTime,
    targetZone,
  );
  const sleepDuration = minutesDuration(hoursToMinutes(core.params.sleepHours));
  const startInstant = startSleep.toInstant();
  const totalDeltaHours = computeZoneDeltaHours(core, startInstant);
  const strategy = normalizeShift(core.params, totalDeltaHours);

  const alignedSleepStart = addMinutes(
    addDays(startSleep, strategy.daysNeeded),
    hoursToMinutes(strategy.shiftAmountHours),
  );
  const alignedWake = alignedSleepStart.add(sleepDuration);

  return {
    id: "default-shift-anchor",
    kind: "wake",
    localDate: alignedWake.toPlainDate().toString(),
    localTime: alignedWake.toPlainTime().toString({
      smallestUnit: "minute",
      fractionalSecondDigits: 0,
    }),
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
  const sleepDurationMinutes = hoursToMinutes(core.params.sleepHours);
  const sleepDuration = minutesDuration(sleepDurationMinutes);
  const startSleep = toZonedDateTime(
    core.params.startDateLocal,
    core.params.startSleepLocalTime,
    targetZone,
  );
  const initialWake = startSleep.add(sleepDuration);
  const defaultAnchor = core.defaultShiftAnchor ?? makeDefaultShiftAnchor(core);

  const anchors: AnchorPoint[] = [
    defaultAnchor,
    { id: "__initial-wake", kind: "wake", localDate: initialWake.toPlainDate().toString(), localTime: initialWake.toPlainTime().toString({ smallestUnit: "minute", fractionalSecondDigits: 0 }), zone: targetZone },
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

  const maxWakeDate = resolvedAnchors.length
    ? resolvedAnchors
        .map((entry) => entry.wake.toPlainDate())
        .reduce((latest, current) =>
          Temporal.PlainDate.compare(current, latest) > 0 ? current : latest,
        )
    : initialWake.toPlainDate();
  const dateRange = enumerateDates(startSleep.toPlainDate(), maxWakeDate);

  const wakeSchedule = computeWakeSchedule(resolvedAnchors, dateRange, getPolicy(core.params));

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
    const bright = computeBrightWindow(wake, sleepStart);

    let changeHours = 0;
    if (previousSleepStart) {
      const baseline = previousSleepStart.add({ days: 1 });
      const diffMinutes = durationTotalMinutes(sleepStart.since(baseline));
      changeHours = safeMinutes(diffMinutes) / MINUTE;
    }

    perDayShifts.push(changeHours);

    days.push({
      dateTargetZone: key,
      changeThisDayHours: changeHours,
      sleepStartLocal: formatTime(sleepStart),
      sleepEndLocal: formatTime(wake),
      brightStartLocal: bright.start ?? DEFAULT_BRIGHT_FALLBACK,
      brightEndLocal: bright.end ?? DEFAULT_BRIGHT_FALLBACK,
      wakeTimeLocal: formatTime(wake),
    });

    previousSleepStart = sleepStart;
  }

  if (perDayShifts.length > 0) {
    perDayShifts[0] = 0;
  }

  const startInstant = startSleep.toInstant();
  const totalDeltaHours = computeZoneDeltaHours(core, startInstant);
  const strategy = normalizeShift(core.params, totalDeltaHours);

  const displayZone = determineDisplayZone(core);

  const projectedEvents = core.events
    .map((event) => projectEvent(event, displayZone))
    .filter((event): event is EventItem & { startZoned: string; endZoned?: string } => event !== null);

  const projectedAnchors = anchors
    .map((anchor) => projectAnchor(anchor, displayZone))
    .filter((anchor): anchor is AnchorPoint & { zonedDateTime: string } => anchor !== null);

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
