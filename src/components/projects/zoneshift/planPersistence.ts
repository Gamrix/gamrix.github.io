import { CorePlanSchema, type CorePlan } from "@/scripts/projects/zoneshift/model";

export const STORAGE_KEY = "zoneshift-core-plan";

const withPlanDefaults = (plan: CorePlan): CorePlan => {
  const prefs = plan.prefs ?? {};
  return {
    ...plan,
    prefs: {
      displayZone: prefs.displayZone ?? "target",
      timeStepMinutes: prefs.timeStepMinutes ?? 30,
    },
  };
};

export const normalizePlan = (plan: CorePlan): CorePlan => withPlanDefaults(plan);

export const loadPlanFromStorage = (fallback: CorePlan): CorePlan => {
  if (typeof window === "undefined") {
    return withPlanDefaults(fallback);
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return withPlanDefaults(fallback);
  }

  try {
    const parsed = JSON.parse(raw);
    return withPlanDefaults(CorePlanSchema.parse(parsed));
  } catch (error) {
    console.error("Failed to load plan from storage", error);
    return withPlanDefaults(fallback);
  }
};

export const persistPlanToStorage = (plan: CorePlan) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(withPlanDefaults(plan)));
  } catch (error) {
    console.error("Failed to persist plan", error);
  }
};
