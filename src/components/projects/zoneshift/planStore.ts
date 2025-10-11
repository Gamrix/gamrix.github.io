import { useSyncExternalStore } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import {
  type AnchorPoint,
  type CorePlan,
  type EventItem,
  CorePlanSchema,
  computePlan,
} from "@/scripts/projects/zoneshift/model";
import { sampleCorePlan } from "@/scripts/projects/zoneshift/samplePlan";
import {
  loadPlanFromStorage,
  normalizePlan,
  persistPlanToStorage,
} from "./planPersistence";

export type ViewMode = "calendar" | "timeline" | "mini" | "table";

type PlanStoreState = {
  plan: CorePlan;
  viewMode: ViewMode;
  activeEventId: string | null;
  activeAnchorId: string | null;
};

let state: PlanStoreState = {
  plan: loadPlanFromStorage(sampleCorePlan),
  viewMode: "calendar",
  activeEventId: null,
  activeAnchorId: null,
};

const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) {
    listener();
  }
};

const setState = (updater: (prev: PlanStoreState) => PlanStoreState) => {
  const next = updater(state);
  if (next === state) {
    return;
  }
  state = next;
  persistPlanToStorage(state.plan);
  emit();
};

export const planStore = {
  getState: () => state,
  setState,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const usePlanStore = <T>(selector: (state: PlanStoreState) => T): T =>
  useSyncExternalStore(
    planStore.subscribe,
    () => selector(state),
    () => selector(state)
  );

export const planActions = {
  setViewMode: (mode: ViewMode) =>
    setState((prev) => ({ ...prev, viewMode: mode }) satisfies PlanStoreState),
  setDisplayZone: (zone: "home" | "target") =>
    setState(
      (prev) =>
        ({
          ...prev,
          plan: {
            ...prev.plan,
            prefs: {
              ...(prev.plan.prefs ?? {}),
              displayZone: zone,
              timeStepMinutes: prev.plan.prefs?.timeStepMinutes ?? 30,
            },
          },
        }) satisfies PlanStoreState
    ),
  setTimeStep: (minutes: number) =>
    setState(
      (prev) =>
        ({
          ...prev,
          plan: {
            ...prev.plan,
            prefs: {
              ...(prev.plan.prefs ?? {}),
              displayZone: prev.plan.prefs?.displayZone ?? "target",
              timeStepMinutes: minutes,
            },
          },
        }) satisfies PlanStoreState
    ),
  setActiveEvent: (id: string | null) =>
    setState(
      (prev) => ({ ...prev, activeEventId: id }) satisfies PlanStoreState
    ),
  setActiveAnchor: (id: string | null) =>
    setState(
      (prev) => ({ ...prev, activeAnchorId: id }) satisfies PlanStoreState
    ),
  updateParams: (partial: Partial<CorePlan["params"]>) =>
    setState(
      (prev) =>
        ({
          ...prev,
          plan: normalizePlan({
            ...prev.plan,
            params: {
              ...prev.plan.params,
              ...partial,
            },
          }),
        }) satisfies PlanStoreState
    ),
  updateEvent: (eventId: string, updater: (event: EventItem) => EventItem) =>
    setState(
      (prev) =>
        ({
          ...prev,
          plan: {
            ...prev.plan,
            events: prev.plan.events.map((event) =>
              event.id === eventId ? updater(event) : event
            ),
          },
        }) satisfies PlanStoreState
    ),
  removeEvent: (eventId: string) =>
    setState(
      (prev) =>
        ({
          ...prev,
          plan: {
            ...prev.plan,
            events: prev.plan.events.filter((event) => event.id !== eventId),
          },
          activeEventId:
            prev.activeEventId === eventId ? null : prev.activeEventId,
        }) satisfies PlanStoreState
    ),
  addEvent: (event: Omit<EventItem, "id"> & { id?: string }) =>
    setState((prev) => {
      const nextId =
        event.id ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `event-${Date.now()}`);
      return {
        ...prev,
        plan: {
          ...prev.plan,
          events: [
            ...prev.plan.events,
            {
              ...event,
              id: nextId,
            },
          ],
        },
      } satisfies PlanStoreState;
    }),
  moveEvent: (
    eventId: string,
    payload: {
      start: Temporal.ZonedDateTime;
      end?: Temporal.ZonedDateTime;
      zone: string;
    },
    stepMinutes: number
  ) =>
    planActions.updateEvent(eventId, (event) => {
      const startInZone = payload.start.withTimeZone(event.zone);
      const startOfDay = Temporal.ZonedDateTime.from({
        timeZone: startInZone.timeZoneId,
        year: startInZone.year,
        month: startInZone.month,
        day: startInZone.day,
      });
      const startMinutesRaw = startInZone
        .since(startOfDay)
        .total({ unit: "minutes" });
      const startSnapped =
        Math.round(startMinutesRaw / stepMinutes) * stepMinutes;
      const startMinutes = Math.max(0, Math.min(startSnapped, 24 * 60));
      const snappedStart = startOfDay.add({ minutes: startMinutes });
      let endIso: string | undefined;
      if (event.end && payload.end) {
        const endInZone = payload.end.withTimeZone(event.zone);
        const endOfDay = Temporal.ZonedDateTime.from({
          timeZone: endInZone.timeZoneId,
          year: endInZone.year,
          month: endInZone.month,
          day: endInZone.day,
        });
        const endMinutesRaw = endInZone
          .since(endOfDay)
          .total({ unit: "minutes" });
        const endSnapped =
          Math.round(endMinutesRaw / stepMinutes) * stepMinutes;
        const endMinutes = Math.max(0, Math.min(endSnapped, 24 * 60));
        const snappedEnd = endOfDay.add({
          minutes: Math.max(endMinutes, startMinutes + stepMinutes),
        });
        endIso = snappedEnd.toInstant().toString();
      }
      return {
        ...event,
        start: snappedStart.toInstant().toString(),
        ...(endIso ? { end: endIso } : {}),
      } satisfies EventItem;
    }),
  updateAnchor: (
    anchorId: string,
    updater: (anchor: AnchorPoint) => AnchorPoint
  ) =>
    setState(
      (prev) =>
        ({
          ...prev,
          plan: {
            ...prev.plan,
            anchors: prev.plan.anchors.map((anchor) =>
              anchor.id === anchorId ? updater(anchor) : anchor
            ),
          },
        }) satisfies PlanStoreState
    ),
  removeAnchor: (anchorId: string) =>
    setState(
      (prev) =>
        ({
          ...prev,
          plan: {
            ...prev.plan,
            anchors: prev.plan.anchors.filter(
              (anchor) => anchor.id !== anchorId
            ),
          },
          activeAnchorId:
            prev.activeAnchorId === anchorId ? null : prev.activeAnchorId,
        }) satisfies PlanStoreState
    ),
  addAnchorAt: (payload: {
    kind: AnchorPoint["kind"];
    zoned: Temporal.ZonedDateTime;
    zone: string;
    note?: string;
  }) =>
    setState((prev) => {
      const anchorId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `anchor-${Date.now()}`;
      return {
        ...prev,
        plan: {
          ...prev.plan,
          anchors: [
            ...prev.plan.anchors,
            {
              id: anchorId,
              kind: payload.kind,
              zone: payload.zone,
              note: payload.note,
              instant: payload.zoned
                .withTimeZone(payload.zone)
                .toInstant()
                .toString(),
            },
          ],
        },
      } satisfies PlanStoreState;
    }),
  moveAnchor: (
    anchorId: string,
    payload: { instant: Temporal.ZonedDateTime; zone: string },
    stepMinutes: number
  ) =>
    planActions.updateAnchor(anchorId, (anchor) => {
      const instantInZone = payload.instant.withTimeZone(anchor.zone);
      const startOfDay = Temporal.ZonedDateTime.from({
        timeZone: instantInZone.timeZoneId,
        year: instantInZone.year,
        month: instantInZone.month,
        day: instantInZone.day,
      });
      const totalMinutesRaw = instantInZone
        .since(startOfDay)
        .total({ unit: "minutes" });
      const totalSnapped =
        Math.round(totalMinutesRaw / stepMinutes) * stepMinutes;
      const totalMinutes = Math.max(0, Math.min(totalSnapped, 24 * 60));
      const snapped = startOfDay.add({ minutes: totalMinutes });
      return {
        ...anchor,
        instant: snapped.toInstant().toString(),
      } satisfies AnchorPoint;
    }),
  importPlan: (plan: CorePlan) =>
    setState(
      () =>
        ({
          plan: normalizePlan(plan),
          activeEventId: null,
          activeAnchorId: null,
          viewMode: "calendar",
        }) satisfies PlanStoreState
    ),
  exportPlan: (): string => JSON.stringify(normalizePlan(state.plan), null, 2),
  resetToSample: () =>
    setState(
      () =>
        ({
          plan: normalizePlan(sampleCorePlan),
          viewMode: "calendar",
          activeAnchorId: null,
          activeEventId: null,
        }) satisfies PlanStoreState
    ),
  projectInstantToDisplay: (iso: string): string => {
    const plan = state.plan;
    const displayZone =
      plan.prefs?.displayZone === "home"
        ? plan.params.homeZone
        : plan.params.targetZone;
    return Temporal.Instant.from(iso)
      .toZonedDateTimeISO(plan.params.targetZone)
      .withTimeZone(displayZone)
      .toInstant()
      .toString();
  },
};

export const selectComputedPlan = () => computePlan(state.plan);

export const selectPlan = () => state.plan;

export const selectViewState = () => ({
  viewMode: state.viewMode,
  activeEventId: state.activeEventId,
  activeAnchorId: state.activeAnchorId,
});

export const PlanImportSchema = z.object({ plan: CorePlanSchema });

export type PlanStore = typeof planStore;
