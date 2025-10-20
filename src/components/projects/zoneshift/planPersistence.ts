import {
  CorePlanSchema,
  type CorePlan,
  resolvePlanContext,
} from "@/scripts/projects/zoneshift/model";

export const STORAGE_KEY = "zoneshift-core-plan";

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
  const autoAnchors = context.autoAnchors;
  const autoIds = new Set(autoAnchors.map((anchor) => anchor.id));
  const previousAutoMap = new Map(
    (previous?.anchors ?? [])
      .filter((anchor) => autoIds.has(anchor.id))
      .map((anchor) => [anchor.id, anchor] as const)
  );
  const anchorEntries = new Map(
    normalized.anchors.map(
      (anchor, index) => [anchor.id, { anchor, index }] as const
    )
  );
  let anchors = normalized.anchors;
  let changed = false;

  for (const autoAnchor of autoAnchors) {
    const entry = anchorEntries.get(autoAnchor.id);
    if (!entry) {
      if (!changed) {
        anchors = [...anchors];
        changed = true;
      }
      anchors.push(autoAnchor);
      continue;
    }

    if (previous === undefined) {
      continue;
    }

    const previousAnchor = previousAutoMap.get(autoAnchor.id);
    const anchorUnchanged =
      previousAnchor !== undefined &&
      previousAnchor.instant === entry.anchor.instant &&
      previousAnchor.zone === entry.anchor.zone &&
      previousAnchor.note === entry.anchor.note;
    if (previousAnchor !== undefined && !anchorUnchanged) {
      continue;
    }

    const needsUpdate =
      entry.anchor.instant !== autoAnchor.instant ||
      entry.anchor.zone !== autoAnchor.zone ||
      entry.anchor.note !== autoAnchor.note;
    if (!needsUpdate) {
      continue;
    }

    if (!changed) {
      anchors = [...anchors];
      changed = true;
    }
    anchors[entry.index] = {
      ...entry.anchor,
      instant: autoAnchor.instant,
      zone: autoAnchor.zone,
      note: autoAnchor.note,
    };
  }

  if (!changed) {
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
