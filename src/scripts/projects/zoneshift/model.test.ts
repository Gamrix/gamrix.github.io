import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";

import {
  computeBrightWindow,
  computePlan,
  CorePlanSchema,
  interpolateDailyWakeTimes,
  makeDefaultShiftAnchor,
  type CorePlan,
} from "./model";

const basePlan = () =>
  CorePlanSchema.parse({
    id: "plan",
    version: 1,
    params: {
      homeZone: "America/Los_Angeles",
      targetZone: "Asia/Taipei",
      startSleepUtc: "2024-10-17T08:30:00Z",
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
          homeZone: "America/Los_Angeles",
          targetZone: "Asia/Taipei",
          startSleepUtc: "2024-10-17T25:61:00Z",
          sleepHours: 8,
          maxShiftLaterPerDayHours: 1.5,
          maxShiftEarlierPerDayHours: 1,
        },
        anchors: [],
        events: [],
      })
    ).toThrow();
  });

  it("supports display days without wakes when converting across time zones", () => {
    const base = basePlan();
    const plan: CorePlan = {
      ...base,
      params: {
        ...base.params,
        homeZone: "America/Los_Angeles",
        targetZone: "Pacific/Kiritimati",
        startSleepUtc: "2024-10-17T08:30:00Z",
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
    const displayDates = computed.days.map((day) => day.wakeDisplayDate.toString());
    expect(displayDates.length).toBeGreaterThan(1);

    const firstDate = Temporal.PlainDate.from(displayDates[0]);
    const lastDate = Temporal.PlainDate.from(
      displayDates[displayDates.length - 1]
    );
    const dateSet = new Set(displayDates);
    const missing: string[] = [];
    let cursor = firstDate;
    while (Temporal.PlainDate.compare(cursor, lastDate) <= 0) {
      if (!dateSet.has(cursor.toString())) {
        missing.push(cursor.toString());
      }
      cursor = cursor.add({ days: 1 });
    }

    expect(missing.length).toBeGreaterThan(0);
  });
});

describe("makeDefaultShiftAnchor", () => {
  it("creates a wake anchor once the timezone delta has been absorbed", () => {
    const anchor = makeDefaultShiftAnchor(basePlan());
    expect(anchor.kind).toBe("wake");
    expect(anchor.zone).toBe("Asia/Taipei");
    const anchorZdt = Temporal.Instant.from(anchor.instant).toZonedDateTimeISO(
      anchor.zone
    );
    expect(anchorZdt.toPlainDate().toString()).toBe("2024-10-24");
    expect(
      anchorZdt
        .toPlainTime()
        .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 })
    ).toBe("09:30");
  });
});

describe("interpolateDailyWakeTimes", () => {
  it("interpolates using capped per-day shift constraints", () => {
    const start = Temporal.ZonedDateTime.from({
      timeZone: "Asia/Taipei",
      year: 2024,
      month: 10,
      day: 18,
      hour: 0,
      minute: 30,
    });
    const end = Temporal.ZonedDateTime.from({
      timeZone: "Asia/Taipei",
      year: 2024,
      month: 10,
      day: 24,
      hour: 9,
      minute: 30,
    });
    const dates = [
      "2024-10-18",
      "2024-10-19",
      "2024-10-20",
      "2024-10-21",
      "2024-10-22",
      "2024-10-23",
      "2024-10-24",
    ];
    const policy = { maxLaterPerDay: 1.5, maxEarlierPerDay: 1 };

    const wakes = interpolateDailyWakeTimes(start, end, dates, policy);

    expect(wakes).toHaveLength(dates.length);
    for (let i = 1; i < wakes.length; i += 1) {
      const diff = wakes[i].since(wakes[i - 1]);
      const totalMinutes = diff.total({ unit: "minutes" });
      const shiftMinutes = totalMinutes - 24 * 60;
      expect(Math.round(shiftMinutes)).toBe(90);
    }
  });
});

describe("computeBrightWindow", () => {
  it("produces a daylight window constrained by wake and sleep", () => {
    const wake = Temporal.ZonedDateTime.from({
      timeZone: "Asia/Taipei",
      year: 2024,
      month: 10,
      day: 20,
      hour: 9,
      minute: 30,
    });
    const brightEnd = computeBrightWindow(wake);
    expect(brightEnd).toBeInstanceOf(Temporal.ZonedDateTime);
    expect(
      brightEnd
        .toPlainTime()
        .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 })
    ).toBe("14:30");
  });

  it("clamps the bright window to the end of the day", () => {
    const wake = Temporal.ZonedDateTime.from({
      timeZone: "Asia/Taipei",
      year: 2024,
      month: 10,
      day: 20,
      hour: 23,
      minute: 30,
    });
    const brightEnd = computeBrightWindow(wake);
    expect(
      brightEnd
        .toPlainTime()
        .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 })
    ).toBe("00:00");
    expect(
      Temporal.PlainDate.compare(
        brightEnd.toPlainDate(),
        wake.toPlainDate().add({ days: 1 })
      )
    ).toBe(0);
  });
});

describe("computePlan", () => {
  it("derives daily schedule and metadata from core inputs", () => {
    const plan = basePlan();
    const computed = computePlan(plan);

    expect(computed.days).not.toHaveLength(0);
    const firstDay = computed.days[0];
    const lastDay = computed.days[computed.days.length - 1];
    const targetFirstSleep = firstDay.sleepStartLocal;

    expect(firstDay.sleepStartLocal).toBe("16:30");
    expect(lastDay.sleepStartLocal).toBe("01:30");
    expect(lastDay.wakeTimeLocal).toBe("09:30");
    expect(firstDay.anchors).toBeDefined();
    expect(Array.isArray(firstDay.anchors)).toBe(true);

    const homeDisplayPlan = {
      ...plan,
      prefs: { ...(plan.prefs ?? {}), displayZone: "home" },
    } satisfies CorePlan;
    const homeComputed = computePlan(homeDisplayPlan);
    expect(homeComputed.days[0]?.sleepStartLocal).not.toBe(targetFirstSleep);

    const anchoredPlan = {
      ...plan,
      anchors: [
        {
          id: "user-anchor",
          kind: "wake" as const,
          instant: "2024-10-19T01:00:00Z",
          zone: plan.params.targetZone,
          note: "Test anchor",
        },
      ],
    } satisfies CorePlan;
    const anchoredComputed = computePlan(anchoredPlan);
    const anchorIds = anchoredComputed.days.flatMap((day) =>
      day.anchors.map((anchor) => anchor.id)
    );
    const editableAnchorIds = anchoredComputed.days.flatMap((day) =>
      day.anchors.filter((anchor) => anchor.editable).map((anchor) => anchor.id)
    );
    expect(anchorIds).toContain("user-anchor");
    expect(editableAnchorIds).toContain("user-anchor");

    expect(computed.meta.direction).toBe("later");
    expect(computed.meta.perDayShifts[0]).toBe(0);

    const totalShift = computed.meta.perDayShifts.reduce(
      (sum, value) => sum + value,
      0
    );
    expect(totalShift).toBeCloseTo(9, 1);
  });

  it("emits Temporal instances for all computed timestamps", () => {
    const plan = basePlan();
    const computed = computePlan(plan);
    const firstDay = computed.days[0];
    expect(firstDay.wakeInstant).toBeInstanceOf(Temporal.Instant);
    expect(firstDay.wakeZoned).toBeInstanceOf(Temporal.ZonedDateTime);
    expect(firstDay.wakeDisplayDate).toBeInstanceOf(Temporal.PlainDate);
    expect(firstDay.sleepStartZoned).toBeInstanceOf(Temporal.ZonedDateTime);
    expect(firstDay.brightEndZoned).toBeInstanceOf(Temporal.ZonedDateTime);
    firstDay.anchors.forEach((anchor) => {
      expect(anchor.instant).toBeInstanceOf(Temporal.Instant);
    });
    computed.projectedEvents.forEach((event) => {
      expect(event.startZoned).toBeInstanceOf(Temporal.ZonedDateTime);
      if (event.endZoned) {
        expect(event.endZoned).toBeInstanceOf(Temporal.ZonedDateTime);
      }
    });
    computed.projectedAnchors.forEach((anchor) => {
      expect(anchor.zonedDateTime).toBeInstanceOf(Temporal.ZonedDateTime);
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
    const projected = computed.projectedEvents.find(
      (event) => event.id === "late-flight"
    );
    expect(projected).toBeDefined();
    expect(projected?.startZoned.timeZoneId).toBe(plan.params.targetZone);
    expect(
      projected?.startZoned.toInstant().toString()
    ).toBe("2024-10-19T09:00:00Z");
    expect(projected?.endZoned?.timeZoneId).toBe(plan.params.targetZone);
  });

  it("clamps bright window to the calendar boundary when a wake is near midnight", () => {
    const plan = {
      ...basePlan(),
      params: {
        ...basePlan().params,
        startSleepUtc: "2024-10-17T13:30:00Z", // 21:30 local in target zone
        sleepHours: 2,
      },
      events: [],
    } satisfies CorePlan;
    const computed = computePlan(plan);
    const firstDay = computed.days[0];
    expect(firstDay.wakeTimeLocal).toBe("23:30");
    expect(
      firstDay.brightEndZoned
        .toPlainTime()
        .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 })
    ).toBe("00:00");
    const brightDurationMinutes = firstDay.brightEndZoned
      .toInstant()
      .since(firstDay.wakeInstant)
      .total({ unit: "minutes" });
    expect(brightDurationMinutes).toBe(30);
    expect(
      Temporal.PlainDate.compare(
        firstDay.brightEndZoned.toPlainDate(),
        firstDay.wakeDisplayDate.add({ days: 1 })
      )
    ).toBe(0);
  });
});
