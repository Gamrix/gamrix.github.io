import { Temporal } from "@js-temporal/polyfill";

export const MINUTES_IN_DAY = 24 * 60;

export const describeDayDelta = (difference: number) => {
  if (difference === 0) {
    return "";
  }
  if (difference > 0) {
    const unit = difference === 1 ? "day" : "days";
    return ` (+${difference} ${unit})`;
  }
  const magnitude = Math.abs(difference);
  const unit = magnitude === 1 ? "day" : "days";
  return ` (-${magnitude} ${unit})`;
};

const toZonedDateTime = (value: Temporal.ZonedDateTime | string) =>
  typeof value === "string"
    ? Temporal.ZonedDateTime.from(value)
    : value;

export const rangeDaySuffix = (
  startValue: Temporal.ZonedDateTime | string,
  endValue: Temporal.ZonedDateTime | string
) => {
  const start = toZonedDateTime(startValue);
  const end = toZonedDateTime(endValue);
  const dayDifference = Temporal.PlainDate.compare(
    end.toPlainDate(),
    start.toPlainDate()
  );
  return describeDayDelta(dayDifference);
};

export const formatRangeLabel = (
  startValue: Temporal.ZonedDateTime | string,
  endValue: Temporal.ZonedDateTime | string,
  options?: { separator?: string }
) => {
  const start = toZonedDateTime(startValue);
  const end = toZonedDateTime(endValue);
  const separator = options?.separator ?? " – ";

  const startLabel = start
    .toPlainTime()
    .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });
  const endLabel = end
    .toPlainTime()
    .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });

  const instantComparison = Temporal.Instant.compare(
    end.toInstant(),
    start.toInstant()
  );
  const suffix = rangeDaySuffix(start, end);

  if (instantComparison === 0) {
    return `${startLabel}${suffix}`;
  }

  return `${startLabel}${separator}${endLabel}${suffix}`;
};

export const minutesSinceStartOfDay = (value: Temporal.ZonedDateTime) => {
  const startOfDay = Temporal.ZonedDateTime.from({
    timeZone: value.timeZoneId,
    year: value.year,
    month: value.month,
    day: value.day,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });
  return value.since(startOfDay).total({ unit: "minutes" });
};

export type DaySegment = {
  date: string;
  start: Temporal.ZonedDateTime;
  end: Temporal.ZonedDateTime;
};

export const splitRangeByDay = (
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime
) => {
  if (Temporal.Instant.compare(end.toInstant(), start.toInstant()) <= 0) {
    return [] satisfies DaySegment[];
  }

  const segments: DaySegment[] = [];
  let cursor = start;

  while (Temporal.Instant.compare(cursor.toInstant(), end.toInstant()) < 0) {
    const dayStart = Temporal.ZonedDateTime.from({
      timeZone: cursor.timeZoneId,
      year: cursor.year,
      month: cursor.month,
      day: cursor.day,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
      microsecond: 0,
      nanosecond: 0,
    });
    const dayEnd = dayStart.add({ days: 1 });
    const segmentEnd =
      Temporal.Instant.compare(end.toInstant(), dayEnd.toInstant()) < 0
        ? end
        : dayEnd;

    segments.push({
      date: cursor.toPlainDate().toString(),
      start: cursor,
      end: segmentEnd,
    });

    if (
      Temporal.Instant.compare(segmentEnd.toInstant(), end.toInstant()) >= 0
    ) {
      break;
    }

    cursor = segmentEnd;
  }

  return segments;
};
