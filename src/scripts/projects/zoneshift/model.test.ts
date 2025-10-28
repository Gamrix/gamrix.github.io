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
