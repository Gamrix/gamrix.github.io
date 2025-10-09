import {
  CorePlanSchema,
  type CorePlan,
} from "@/scripts/projects/zoneshift/model";

export const STORAGE_KEY = "zoneshift-core-plan";

export const normalizePlan = (plan: CorePlan): CorePlan => {
  const prefs = plan.prefs ?? {};
  return {
    ...plan,
    prefs: {
      displayZone: prefs.displayZone ?? "target",
      timeStepMinutes: prefs.timeStepMinutes ?? 30,
    },
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
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizePlan(plan))
    );
  } catch (error) {
    console.error("Failed to persist plan", error);
  }
};
