import { beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";

import { planActions, planStore } from "./planStore";
import { computePlan, resolvePlanContext } from "@/scripts/projects/zoneshift/model";
import { sampleCorePlan } from "@/scripts/projects/zoneshift/samplePlan";

const targetZone = sampleCorePlan.params.targetZone;

describe("planStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    planActions.resetToSample();
  });

  it("adds anchors via addAnchorAt", () => {
    const beforeCount = planStore.getState().plan.anchors.length;
    const zoned = Temporal.ZonedDateTime.from({
      timeZone: targetZone,
      year: 2024,
      month: 10,
      day: 22,
      hour: 9,
      minute: 0,
    });

    planActions.addAnchorAt({ zoned, zone: targetZone });

    const after = planStore.getState().plan.anchors;
    expect(after.length).toBe(beforeCount + 1);
    expect(after.at(-1)?.kind).toBe("wake");
  });

  it("moves events respecting the configured step", () => {
    const plan = planStore.getState().plan;
    const eventId = plan.events[0]?.id;
    expect(eventId).toBeDefined();
    if (!eventId) return;

    const computed = Temporal.Instant.from(
      plan.events[0]!.start
    ).toZonedDateTimeISO(plan.events[0]!.zone);
    const start = computed.add({ minutes: 37 });

    planActions.moveEvent(
      eventId,
      { start, zone: plan.events[0]!.zone },
      plan.prefs?.timeStepMinutes ?? 30
    );

    const updated = planStore
      .getState()
      .plan.events.find((event) => event.id === eventId);
    expect(updated).toBeDefined();
    if (!updated) return;

    const updatedStart = Temporal.Instant.from(
      updated.start
    ).toZonedDateTimeISO(updated.zone);
    expect(updatedStart.minute % 30).toBe(0);
  });

  it("persists plan changes to localStorage", () => {
    const nextPlan = {
      ...sampleCorePlan,
      id: "persist-check",
    };
    planActions.importPlan(nextPlan);
    const raw = window.localStorage.getItem("zoneshift-core-plan");
    expect(raw).toBeTruthy();
  });

  const makeDayKey = (instantIso: string, zone: string) =>
    Temporal.Instant.from(instantIso)
      .toZonedDateTimeISO(zone)
      .toPlainDate()
      .toString();

  it("keeps edits to the start-day anchor through export and import", () => {
    const plan = planStore.getState().plan;
    const context = resolvePlanContext(plan);
    const targetZone = plan.params.targetZone;
    const startDayKey = context.startWake.toPlainDate().toString();
    const startDayAnchor =
      plan.anchors.find(
        (anchor) => makeDayKey(anchor.instant, targetZone) === startDayKey
      ) ?? null;
    expect(startDayAnchor).not.toBeNull();
    if (!startDayAnchor) return;

    const updatedInstant = Temporal.Instant.from(startDayAnchor.instant)
      .toZonedDateTimeISO(targetZone)
      .add({ minutes: 45 })
      .toInstant()
      .toString();

    planActions.updateAnchor(startDayAnchor.id, (anchor) => ({
      ...anchor,
      instant: updatedInstant,
      note: "Custom alignment wake",
    }));

    const storedAnchor =
      planStore
        .getState()
        .plan.anchors.find(
          (anchor) => makeDayKey(anchor.instant, targetZone) === startDayKey
        ) ?? null;
    expect(storedAnchor).not.toBeNull();
    if (!storedAnchor) return;
    expect(storedAnchor.instant).toBe(updatedInstant);
    expect(storedAnchor.note).toBe("Custom alignment wake");

    const exported = planActions.exportPlan();
    const parsed = JSON.parse(exported);
    const parsedAnchor =
      parsed.anchors.find(
        (anchor: { instant: string; zone: string }) =>
          makeDayKey(anchor.instant, targetZone) === startDayKey
      ) ?? null;
    expect(parsedAnchor).not.toBeNull();
    if (!parsedAnchor) return;
    expect(parsedAnchor.instant).toBe(updatedInstant);
    expect(parsedAnchor.note).toBe("Custom alignment wake");

    planActions.importPlan(parsed);

    const reloadedAnchor =
      planStore
        .getState()
        .plan.anchors.find(
          (anchor) => makeDayKey(anchor.instant, targetZone) === startDayKey
        ) ?? null;
    expect(reloadedAnchor).not.toBeNull();
    if (!reloadedAnchor) return;
    expect(reloadedAnchor.instant).toBe(updatedInstant);
    expect(reloadedAnchor.note).toBe("Custom alignment wake");
  });

  it.skip("reproduces early-home-zone anchor drag issue", () => {
    planActions.setDisplayZone("home");
    const basePlan = planStore.getState().plan;
    const homeZone = basePlan.params.homeZone;

    const newAnchorZdt = Temporal.ZonedDateTime.from({
      timeZone: homeZone,
      year: 2024,
      month: 10,
      day: 20,
      hour: 10,
      minute: 0,
    });

    planActions.addAnchorAt({ zoned: newAnchorZdt, zone: homeZone });
    const createdAnchor =
      planStore
        .getState()
        .plan.anchors.find(
          (anchor) =>
            anchor.zone === homeZone &&
            Temporal.Instant.from(anchor.instant)
              .toZonedDateTimeISO(homeZone)
              .equals(newAnchorZdt.withPlainTime({ hour: 10, minute: 0 }))
        ) ?? null;
    expect(createdAnchor).not.toBeNull();
    if (!createdAnchor) return;

    const moveTo = newAnchorZdt.with({ hour: 6, minute: 30 });

    planActions.moveAnchor(
      createdAnchor.id,
      { instant: moveTo, zone: homeZone },
      planStore.getState().plan.prefs?.timeStepMinutes ?? 30
    );

    expect(planStore.getState().plan.anchors.length).toBe(4);
    const computed = computePlan(planStore.getState().plan);
    const hasNaN = computed.days.some((day) =>
      Number.isNaN(day.sleepStartZoned.epochMilliseconds)
    );
    expect(hasNaN).toBe(false);
    expect(
      new Set(computed.days.map((day) => day.wakeInstant.toString())).size
    ).toBe(computed.days.length);
    const displayDates = computed.days.map((day) =>
      day.wakeDisplayDate.toString()
    );
    const uniqueDates = new Set(displayDates);
    expect(uniqueDates.size).toBe(displayDates.length); });

  it("keeps wake dates unique when adjusting anchor in target zone view", () => {
    planActions.resetToSample();
    planActions.setDisplayZone("target");
    const plan = planStore.getState().plan;
    const targetZone = plan.params.targetZone;
    const anchor = plan.anchors.find((item) => item.zone === targetZone);
    expect(anchor).not.toBeUndefined();
    if (!anchor) return;

    const originalZdt = Temporal.Instant.from(anchor.instant).toZonedDateTimeISO(
      targetZone
    );

    const moveTo = originalZdt.with({ hour: 6, minute: 30 });
    planActions.moveAnchor(
      anchor.id,
      { instant: moveTo, zone: targetZone },
      planStore.getState().plan.prefs?.timeStepMinutes ?? 30
    );

    const computed = computePlan(planStore.getState().plan);
    const displayDates = computed.days.map((day) =>
      day.wakeDisplayDate.toString()
    );
    const uniqueDates = new Set(displayDates);
    expect(uniqueDates.size).toBe(displayDates.length);
  });
});
