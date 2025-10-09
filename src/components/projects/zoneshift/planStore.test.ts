import { beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";

import { planActions, planStore } from "./planStore";
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

    planActions.addAnchorAt({ kind: "wake", zoned, zone: targetZone });

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
});
