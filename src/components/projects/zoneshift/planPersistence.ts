import { Temporal } from "@js-temporal/polyfill";
import {
  CorePlanSchema,
  type CorePlan,
  resolvePlanContext,
} from "@/scripts/projects/zoneshift/model";

export const STORAGE_KEY = "zoneshift-core-plan";

const makeDayKey = (instantIso: string, zone: string) =>
  Temporal.Instant.from(instantIso)
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();

export const normalizePlan = (
  plan: CorePlan,
  previous?: CorePlan
): CorePlan => {
  const prefs = plan.prefs ?? {};
  const normalized: CorePlan = {
    ...plan,
    prefs: {
      displayZone: prefs.displayZone ?? "target",
      timeStepMinutes: prefs.timeStepMinutes ?? 30,
    },
  };
  const context = resolvePlanContext(normalized);
  const targetZone = normalized.params.targetZone;
  const dayKeys = new Set(
    normalized.anchors.map((anchor) => makeDayKey(anchor.instant, targetZone))
  );

  let anchors = normalized.anchors;

  const maybeAddAnchor = (dayKey: string, instantIso: string, id: string) => {
    if (dayKeys.has(dayKey)) {
      return;
    }
    if (anchors === normalized.anchors) {
      anchors = [...anchors];
    }
    anchors.push({
      id,
      kind: "wake",
      instant: instantIso,
      zone: targetZone,
    });
    dayKeys.add(dayKey);
  };

  maybeAddAnchor(
    context.startWake.toPlainDate().toString(),
    context.startWake.toInstant().toString(),
    "__auto-start"
  );
  maybeAddAnchor(
    context.alignedWake.toPlainDate().toString(),
    context.alignedWake.toInstant().toString(),
    "__auto-end"
  );

  if (anchors === normalized.anchors) {
    return normalized;
  }

  return {
    ...normalized,
    anchors,
  };
};

export const loadPlanFromStorage = (fallback: CorePlan): CorePlan => {
  if (typeof window === "undefined") {
    return normalizePlan(fallback);
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return normalizePlan(fallback);
  }

  try {
    const parsed = JSON.parse(raw);
    return normalizePlan(CorePlanSchema.parse(parsed));
  } catch (error) {
    console.error("Failed to load plan from storage", error);
    return normalizePlan(fallback);
  }
};

export const persistPlanToStorage = (plan: CorePlan) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch (error) {
    console.error("Failed to persist plan", error);
  }
};
