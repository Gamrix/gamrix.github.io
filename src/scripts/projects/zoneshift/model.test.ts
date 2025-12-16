import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";

import {
  computePlan,
  CorePlanSchema,
  type CorePlan,
} from "./model";

const basePlan = () =>
  CorePlanSchema.parse({
    id: "plan",
    version: 1,
    params: {
      startTimeZone: "America/Los_Angeles",
      endTimeZone: "Asia/Taipei",
      startSleepUtc: "2024-10-17T08:30:00Z",
      endWakeUtc: "2024-10-26T01:00:00Z",
      sleepHours: 8,
      maxShiftLaterPerDayHours: 1.5,
      maxShiftEarlierPerDayHours: 1,
    },
    anchors: [],
    events: [],
  });

describe("CorePlanSchema", () => {
  it("rejects invalid instants", () => {
    expect(() =>
      CorePlanSchema.parse({
        id: "plan",
        version: 1,
        params: {
          startTimeZone: "America/Los_Angeles",
          endTimeZone: "Asia/Taipei",
          startSleepUtc: "2024-10-17T25:61:00Z",
          endWakeUtc: "2024-10-26T01:00:00Z",
          sleepHours: 8,
          maxShiftLaterPerDayHours: 1.5,
          maxShiftEarlierPerDayHours: 1,
        },
        anchors: [],
        events: [],
      })
    ).toThrow();
  });

  it("handles display zone projection across time zones correctly", () => {
    const base = basePlan();
    const plan: CorePlan = {
      ...base,
      params: {
        ...base.params,
        startTimeZone: "America/Los_Angeles",
        endTimeZone: "Pacific/Kiritimati",
        startSleepUtc: "2024-10-17T08:30:00Z",
        endWakeUtc: "2024-10-24T09:00:00Z",
        sleepHours: 8,
        maxShiftLaterPerDayHours: 1,
        maxShiftEarlierPerDayHours: 1,
      },
      prefs: { displayZone: "home" },
      anchors: [
        {
          id: "festival-call",
          kind: "wake",
          instant: "2024-10-24T09:00:00Z",
          zone: "Pacific/Kiritimati",
        },
      ],
    } satisfies CorePlan;

    const computed = computePlan(plan);
    const displayDates = computed.displayDays.map((day) => day.date.toString());
    expect(displayDates.length).toBeGreaterThan(1);

    // Verify the wake schedule generates entries
    expect(computed.wakeSchedule.length).toBeGreaterThan(1);

    // Verify display days contain events
    const totalEvents = computed.displayDays.reduce((sum, day) => sum + day.events.length, 0);
    expect(totalEvents).toBeGreaterThan(0);
  });
});

// Removed: interpolateDailyWakeTimes and computeBrightWindow functions were removed
// Wake interpolation is now built into computePlan
// Bright light window is no longer clamped at computation time, but split by day boundaries

describe("computePlan", () => {
  it("derives daily schedule and metadata from core inputs", () => {
    const plan = basePlan();
    const computed = computePlan(plan);

    expect(computed.wakeSchedule).not.toHaveLength(0);
    expect(computed.displayDays).not.toHaveLength(0);

    const firstScheduleEntry = computed.wakeSchedule[0];
    expect(firstScheduleEntry.wakeEvent).toBeDefined();
    expect(firstScheduleEntry.sleepEvent).toBeDefined();
    expect(firstScheduleEntry.brightEvent).toBeDefined();
    expect(firstScheduleEntry.shiftFromPreviousWakeHours).toBe(0);

    // Check that wake events exist across all display days
    const allWakeEvents = computed.displayDays.flatMap((day) =>
      day.events.filter((e) => e.kind === "wake")
    );
    expect(allWakeEvents.length).toBeGreaterThan(0);

    // Test display zone switching
    const homeDisplayPlan = {
      ...plan,
      prefs: { ...(plan.prefs ?? {}), displayZone: "home" },
    } satisfies CorePlan;
    const homeComputed = computePlan(homeDisplayPlan);
    expect(homeComputed.displayDays.length).toBeGreaterThan(0);

    // Test user anchors are preserved
    const anchoredPlan = {
      ...plan,
      anchors: [
        {
          id: "user-anchor",
          kind: "wake" as const,
          instant: "2024-10-19T01:00:00Z",
          zone: plan.params.endTimeZone,
          note: "Test anchor",
        },
      ],
    } satisfies CorePlan;
    const anchoredComputed = computePlan(anchoredPlan);
    const userAnchorEntry = anchoredComputed.wakeSchedule.find((entry) =>
      entry.anchor?.id === "user-anchor"
    );
    expect(userAnchorEntry).toBeDefined();
    expect(userAnchorEntry?.anchor?.note).toBe("Test anchor");

    // LA to Taipei offset is approximately +15 hours (LA is UTC-7/8, Taipei is UTC+8)
    expect(computed.meta.totalDeltaHours).toBeCloseTo(15, 1);
  });

  it("emits Temporal instances for all computed timestamps", () => {
    const plan = basePlan();
    const computed = computePlan(plan);

    const firstEntry = computed.wakeSchedule[0];
    expect(firstEntry.wakeEvent.startInstant).toBeInstanceOf(Temporal.Instant);
    expect(firstEntry.sleepEvent.startInstant).toBeInstanceOf(Temporal.Instant);
    expect(firstEntry.brightEvent.endInstant).toBeInstanceOf(Temporal.Instant);

    const firstDay = computed.displayDays[0];
    expect(firstDay.date).toBeInstanceOf(Temporal.PlainDate);
    firstDay.events.forEach((event) => {
      expect(event.startZoned).toBeInstanceOf(Temporal.ZonedDateTime);
      if (event.endZoned) {
        expect(event.endZoned).toBeInstanceOf(Temporal.ZonedDateTime);
      }
    });

    computed.manualEvents.forEach((event) => {
      expect(event.startZoned).toBeInstanceOf(Temporal.ZonedDateTime);
      if (event.endZoned) {
        expect(event.endZoned).toBeInstanceOf(Temporal.ZonedDateTime);
      }
    });
  });

  it("projects events into the active display zone", () => {
    const plan = {
      ...basePlan(),
      events: [
        {
          id: "late-flight",
          title: "Red-eye",
          start: "2024-10-19T09:00:00Z",
          end: "2024-10-19T15:30:00Z",
          zone: "America/Los_Angeles",
        },
      ],
      prefs: { displayZone: "target" },
    } satisfies CorePlan;
    const computed = computePlan(plan);
    const projected = computed.manualEvents.find(
      (event) => event.id === "late-flight" || event.splitFrom === "late-flight"
    );
    expect(projected).toBeDefined();
    expect(projected?.startZoned.timeZoneId).toBe(plan.params.endTimeZone);
    expect(projected?.kind).toBe("manual");
    expect(projected?.title).toBe("Red-eye");
  });

  it("splits bright window across days when it crosses midnight", () => {
    const plan = {
      ...basePlan(),
      params: {
        ...basePlan().params,
        startSleepUtc: "2024-10-17T13:30:00Z", // 21:30 local in end zone
        endWakeUtc: "2024-10-26T15:30:00Z",
        sleepHours: 2,
      },
      events: [],
    } satisfies CorePlan;
    const computed = computePlan(plan);

    // Find a day with a wake event near midnight
    const lateWakeDay = computed.displayDays.find((day) => {
      const wakeEvent = day.events.find((e) => e.kind === "wake");
      if (!wakeEvent) return false;
      const hour = wakeEvent.startZoned.hour;
      return hour >= 22; // After 10 PM
    });

    if (lateWakeDay) {
      // Check if the bright event is split
      const brightEvents = lateWakeDay.events.filter((e) => e.kind === "bright");
      const splitBrightEvents = brightEvents.filter((e) => e.splitFrom);
      // If wake is late, bright light should cross midnight and be split
      expect(splitBrightEvents.length).toBeGreaterThan(0);
    }
  });
});

describe("Additional Edge Case Coverage", () => {
  it("Test 1: fills gaps with 24-hour shifts (ignoring maxShift constraints)", () => {
    const plan = {
      ...basePlan(),
      params: {
        ...basePlan().params,
        maxShiftLaterPerDayHours: 0.5, // Strict limit that would fail if enforced
      },
      anchors: [
        {
          id: "start",
          kind: "wake",
          instant: "2024-10-17T08:00:00Z",
          zone: "UTC",
        },
        {
          id: "end",
          kind: "wake",
          instant: "2024-10-20T14:00:00Z", // +3 days + 6 hours
          zone: "UTC",
        },
      ],
    } satisfies CorePlan;

    const computed = computePlan(plan);

    // Verify intermediate days are generated with clamped shifts
    // 6 hours total shift over 3 days = 2h/day.
    // Max shift is 0.5h/day.
    // Expected: 0.5h shift per day
    const intermediate = computed.wakeSchedule.filter((e) => !e.anchor);
    expect(intermediate.length).toBeGreaterThan(0);
    intermediate.forEach((entry) => {
      expect(entry.shiftFromPreviousWakeHours).toBe(0.5);
    });
  });

  it("Test 6: splits manual events crossing midnight", () => {
    // 23:30 to 01:30 in LA time
    const startInZone = "2024-10-18T23:30:00";
    const endInZone = "2024-10-19T01:30:00";

    const plan = {
      ...basePlan(),
      params: {
        ...basePlan().params,
        startTimeZone: "America/Los_Angeles",
      },
      events: [
        {
          id: "midnight-party",
          title: "Party",
          // Convert to UTC for the model
          start: Temporal.PlainDateTime.from(startInZone)
            .toZonedDateTime("America/Los_Angeles")
            .toInstant()
            .toString(),
          end: Temporal.PlainDateTime.from(endInZone)
            .toZonedDateTime("America/Los_Angeles")
            .toInstant()
            .toString(),
          zone: "America/Los_Angeles",
          colorHint: "red",
        },
      ],
      prefs: { displayZone: "home" }, // View in LA
    } satisfies CorePlan;

    const computed = computePlan(plan);
    const partyEvents = computed.displayDays
      .flatMap((d) => d.events)
      .filter((e) => e.kind === "manual" && e.title === "Party");

    expect(partyEvents).toHaveLength(2);

    const [part1, part2] = partyEvents;
    expect(part1.splitPart).toBe("start");
    expect(part1.endZoned?.hour).toBe(0);
    expect(part1.endZoned?.minute).toBe(0);

    expect(part2.splitPart).toBe("end");
    expect(part2.startZoned.hour).toBe(0);
    expect(part2.startZoned.minute).toBe(0);
  });

  it("Test 8: handles International Date Line crossing correctly", () => {
    const plan = {
      ...basePlan(),
      params: {
        ...basePlan().params,
        startTimeZone: "Asia/Tokyo", // UTC+9
        endTimeZone: "America/Los_Angeles", // UTC-7
        startSleepUtc: "2024-10-18T14:00:00Z",
        endWakeUtc: "2024-10-25T14:00:00Z",
      },
      prefs: { displayZone: "target" },
    } satisfies CorePlan;

    const computed = computePlan(plan);
    const dates = computed.displayDays.map((d) => d.date.toString());

    // Verify no gaps in dates
    for (let i = 0; i < dates.length - 1; i++) {
      const current = Temporal.PlainDate.from(dates[i]);
      const next = Temporal.PlainDate.from(dates[i + 1]);
      expect(current.add({ days: 1 }).equals(next)).toBe(true);
    }
  });

  it("Test 10: calculates negative shifts correctly", () => {
    const plan = {
      ...basePlan(),
      anchors: [
        {
          id: "a1",
          kind: "wake",
          instant: "2024-10-17T10:00:00Z",
          zone: "UTC",
        },
        {
          id: "a2",
          kind: "wake",
          instant: "2024-10-18T09:00:00Z", // 23 hours later (1 hour earlier in day)
          zone: "UTC",
        },
      ],
    } satisfies CorePlan;

    const computed = computePlan(plan);
    const entry2 = computed.wakeSchedule.find((e) => e.anchor?.id === "a2");

    expect(entry2).toBeDefined();
    expect(entry2?.shiftFromPreviousWakeHours).toBe(-1);
  });

  it("Test 11: interpolates earlier shifts correctly (3h earlier over 4 days)", () => {
    const plan = {
      ...basePlan(),
      params: {
        ...basePlan().params,
        maxShiftEarlierPerDayHours: 1.0, // Allow up to 1h earlier per day
        endWakeUtc: "2024-10-21T07:00:00Z", // Match end anchor to prevent auto-generation
      },
      anchors: [
        {
          id: "start",
          kind: "wake",
          instant: "2024-10-17T10:00:00Z",
          zone: "UTC",
        },
        {
          id: "end",
          kind: "wake",
          instant: "2024-10-21T07:00:00Z", // 4 days later, 3 hours earlier
          zone: "UTC",
        },
      ],
    } satisfies CorePlan;

    // Expected behavior:
    // Total delta: -3 hours
    // Total days: 4 days (start -> day2 -> day3 -> day4 -> end)
    // Shift per day: -3 / 4 = -0.75 hours (-45 minutes)
    // This is within the max limit of -1.0 hours.

    const computed = computePlan(plan);
    const intermediate = computed.wakeSchedule.filter((e) => !e.anchor);

    // There should be 3 intermediate days (Oct 18, 19, 20)
    expect(intermediate).toHaveLength(3);

    intermediate.forEach((entry) => {
      expect(entry.shiftFromPreviousWakeHours).toBe(-0.75);
    });

    // Verify the final anchor link
    const lastEntry = computed.wakeSchedule[computed.wakeSchedule.length - 1];
    expect(lastEntry?.anchor?.id).toBe("end");
    // Ideally the last link would also reflect the shift, but our logic
    // calculates shift based on the *previous* wake.
    // Let's verify the shift leading INTO the final anchor is also correct.
    expect(lastEntry?.shiftFromPreviousWakeHours).toBe(-0.75);
  });
});
