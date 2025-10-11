import { Temporal } from "@js-temporal/polyfill";
import { type FormEvent, useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { computePlan, type CorePlan } from "@/scripts/projects/zoneshift/model";
import { sampleCorePlan } from "@/scripts/projects/zoneshift/samplePlan";

import { ScheduleTable } from "./ScheduleTable";
import { CalendarView } from "./calendar/CalendarView";
import { CalendarListView } from "./calendar/CalendarListView";
import { MiniCalendarView } from "./calendar/MiniCalendarView";
import { ImportExport } from "./toolbar/ImportExport";
import {
  loadPlanFromStorage,
  normalizePlan,
  persistPlanToStorage,
} from "./planPersistence";

type DemoViewMode = "calendar" | "timeline" | "mini" | "table";

const DEMO_VIEW_LABEL: Record<DemoViewMode, string> = {
  calendar: "List View",
  timeline: "Calendar View",
  mini: "Mini View",
  table: "Table View",
};

const formatProjectedTime = (value: Temporal.ZonedDateTime) => {
  const zdt = value;
  const month = String(zdt.month).padStart(2, "0");
  const day = String(zdt.day).padStart(2, "0");
  const time = zdt
    .toPlainTime()
    .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });
  return `${month}/${day} ${time}`;
};

const ProjectedEvents = ({
  computed,
}: {
  computed: ReturnType<typeof computePlan>;
}) => {
  if (computed.projectedEvents.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Wake Time Activities
      </h3>
      <ul className="grid gap-3 md:grid-cols-2">
        {computed.projectedEvents.map((event) => (
          <li
            key={event.id}
            className="flex flex-col gap-1 rounded-lg border bg-card/50 p-4 text-sm"
          >
            <span className="font-medium text-foreground">{event.title}</span>
            <span className="text-xs text-muted-foreground">
              {formatProjectedTime(event.startZoned)}
              {event.endZoned
                ? ` → ${formatProjectedTime(event.endZoned)}`
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

function ZoneShiftDemoComponent() {
  const [planState, setPlanState] = useState<CorePlan>(() =>
    loadPlanFromStorage(sampleCorePlan)
  );
  const displayZone = planState.prefs?.displayZone ?? "target";
  const [viewMode, setViewMode] = useState<DemoViewMode>("calendar");
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [formState, setFormState] = useState({ date: "", time: "", note: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const anchorDateFieldId = useId();
  const anchorTimeFieldId = useId();
  const anchorNoteFieldId = useId();

  const computed = useMemo(() => computePlan(planState), [planState]);

  const displayZoneId =
    displayZone === "home"
      ? planState.params.homeZone
      : planState.params.targetZone;

  const activeAnchor = useMemo(
    () =>
      planState.anchors.find((anchor) => anchor.id === activeAnchorId) ?? null,
    [planState.anchors, activeAnchorId]
  );
  const activeAnchorTitle = activeAnchor
    ? activeAnchor.kind === "wake"
      ? "Wake Time"
      : "Sleep Time"
    : null;
  const activeAnchorLabel = activeAnchor
    ? activeAnchor.kind === "wake"
      ? "wake time"
      : "sleep time"
    : null;

  useEffect(() => {
    if (!activeAnchor) {
      setFormState({ date: "", time: "", note: "" });
      setFormError(null);
      return;
    }
    const anchorZdt = Temporal.Instant.from(
      activeAnchor.instant
    ).toZonedDateTimeISO(activeAnchor.zone);
    setFormState({
      date: anchorZdt.toPlainDate().toString(),
      time: anchorZdt
        .toPlainTime()
        .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 }),
      note: activeAnchor.note ?? "",
    });
    setFormError(null);
  }, [activeAnchor]);

  const handleDisplayZoneChange = (zone: "home" | "target") => {
    setPlanState((prev) => ({
      ...prev,
      prefs: { ...(prev.prefs ?? {}), displayZone: zone },
    }));
  };

  useEffect(() => {
    persistPlanToStorage(planState);
  }, [planState]);

  const handleAnchorFieldChange = (
    field: "date" | "time" | "note",
    value: string
  ) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleEventChange = (
    eventId: string,
    payload: {
      start: Temporal.ZonedDateTime;
      end?: Temporal.ZonedDateTime;
      zone: string;
    }
  ) => {
    setPlanState((prev) => {
      const step = prev.prefs?.timeStepMinutes ?? 30;
      const nextEvents = prev.events.map((event) => {
        if (event.id !== eventId) {
          return event;
        }
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
        const startSnapped = Math.round(startMinutesRaw / step) * step;
        const startMinutes = Math.max(0, Math.min(startSnapped, 24 * 60));
        const snappedStart = startOfDay.add({ minutes: startMinutes });

        let nextEndIso = event.end;
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
          const endSnapped = Math.round(endMinutesRaw / step) * step;
          const endMinutes = Math.max(0, Math.min(endSnapped, 24 * 60));
          const snappedEnd = endOfDay.add({
            minutes: Math.max(endMinutes, startMinutes + step),
          });
          nextEndIso = snappedEnd.toInstant().toString();
        }

        return {
          ...event,
          start: snappedStart.toInstant().toString(),
          ...(event.end && nextEndIso
            ? { end: nextEndIso }
            : event.end
              ? { end: event.end }
              : {}),
        };
      });
      return { ...prev, events: nextEvents } satisfies CorePlan;
    });
  };

  const handleAddEvent = (payload: {
    title: string;
    start: Temporal.ZonedDateTime;
    end?: Temporal.ZonedDateTime;
    zone: string;
  }) => {
    const newEventId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `event-${Date.now()}`;
    const step = planState.prefs?.timeStepMinutes ?? 30;
    const startInZone = payload.start.withTimeZone(payload.zone);
    const startOfDay = Temporal.ZonedDateTime.from({
      timeZone: startInZone.timeZoneId,
      year: startInZone.year,
      month: startInZone.month,
      day: startInZone.day,
    });
    const startMinutesRaw = startInZone
      .since(startOfDay)
      .total({ unit: "minutes" });
    const startSnapped = Math.round(startMinutesRaw / step) * step;
    const startMinutes = Math.max(0, Math.min(startSnapped, 24 * 60));
    const snappedStart = startOfDay.add({ minutes: startMinutes });

    let endInstant: string | undefined;
    if (payload.end) {
      const endInZone = payload.end.withTimeZone(payload.zone);
      const endOfDay = Temporal.ZonedDateTime.from({
        timeZone: endInZone.timeZoneId,
        year: endInZone.year,
        month: endInZone.month,
        day: endInZone.day,
      });
      const endMinutesRaw = endInZone
        .since(endOfDay)
        .total({ unit: "minutes" });
      const endSnapped = Math.round(endMinutesRaw / step) * step;
      const endMinutes = Math.max(0, Math.min(endSnapped, 24 * 60));
      const minEndMinutes = Math.max(endMinutes, startMinutes + step);
      const snappedEnd = endOfDay.add({ minutes: minEndMinutes });
      endInstant = snappedEnd.toInstant().toString();
    }

    const trimmedTitle = payload.title.trim();
    const finalTitle = trimmedTitle.length > 0 ? trimmedTitle : "New event";

    const newEvent = {
      id: newEventId,
      title: finalTitle,
      start: snappedStart.toInstant().toString(),
      end: (endInstant ?? snappedStart.add({ minutes: step }).toInstant().toString()),
      zone: payload.zone,
    };

    setPlanState(
      (prev) =>
        ({
          ...prev,
          events: [...prev.events, newEvent].sort((a, b) =>
            Temporal.Instant.compare(
              Temporal.Instant.from(a.start),
              Temporal.Instant.from(b.start)
            )
          ),
        }) satisfies CorePlan
    );
  };

  const handleAnchorChange = (
    anchorId: string,
    payload: { instant: Temporal.ZonedDateTime; zone: string }
  ) => {
    setPlanState((prev) => {
      const step = prev.prefs?.timeStepMinutes ?? 30;
      const nextAnchors = prev.anchors.map((anchor) => {
        if (anchor.id !== anchorId) {
          return anchor;
        }
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
        const totalSnapped = Math.round(totalMinutesRaw / step) * step;
        const totalMinutes = Math.max(0, Math.min(totalSnapped, 24 * 60));
        const snapped = startOfDay.add({ minutes: totalMinutes });
        return {
          ...anchor,
          instant: snapped.toInstant().toString(),
        };
      });
      return { ...prev, anchors: nextAnchors } satisfies CorePlan;
    });
  };

  const handleAddAnchor = (payload: {
    zoned: Temporal.ZonedDateTime;
    zone: string;
    note?: string;
    autoSelect?: boolean;
  }) => {
    const newAnchorId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `anchor-${Date.now()}`;
    const instantIso = payload.zoned
      .withTimeZone(payload.zone)
      .toInstant()
      .toString();
    setPlanState(
      (prev) =>
        ({
          ...prev,
          anchors: [
            ...prev.anchors,
            {
              id: newAnchorId,
              kind: "wake",
              zone: payload.zone,
              instant: instantIso,
              ...(payload.note
                ? {
                    note: payload.note.trim().length > 0 ? payload.note.trim() : undefined,
                  }
                : {}),
            },
          ],
        }) satisfies CorePlan
    );
    setActiveAnchorId(payload.autoSelect === false ? null : newAnchorId);
  };

  const handleAnchorSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeAnchor) {
      return;
    }
    try {
      const date = Temporal.PlainDate.from(formState.date);
      const time = Temporal.PlainTime.from(formState.time);
      const anchorZdt = Temporal.ZonedDateTime.from({
        timeZone: activeAnchor.zone,
        year: date.year,
        month: date.month,
        day: date.day,
        hour: time.hour,
        minute: time.minute,
        second: time.second,
      });
      const trimmedNote = formState.note.trim();
      const nextNote = trimmedNote.length > 0 ? trimmedNote : undefined;
      setPlanState((prev) => ({
        ...prev,
        anchors: prev.anchors.map((anchor) =>
          anchor.id === activeAnchor.id
            ? {
                ...anchor,
                instant: anchorZdt.toInstant().toString(),
                note: nextNote,
              }
            : anchor
        ),
      }));
      setActiveAnchorId(null);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Unable to update wake time"
      );
    }
  };

  const handleAnchorCancel = () => {
    setActiveAnchorId(null);
    setFormError(null);
  };

  const handleImportPlan = (plan: CorePlan) => {
    setPlanState(normalizePlan(plan));
    setActiveAnchorId(null);
  };

  const handleResetPlan = () => {
    setPlanState(normalizePlan(sampleCorePlan));
    setActiveAnchorId(null);
  };

  const handleExportPlan = () =>
    JSON.stringify(normalizePlan(planState), null, 2);

  return (
    <section className="space-y-10">
      <header className="rounded-xl border bg-card/60 p-8 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Display zone
                </span>
                <div className="flex gap-2">
                  {(["home", "target"] as const).map((option) => {
                    const zoneId =
                      option === "home"
                        ? planState.params.homeZone
                        : planState.params.targetZone;
                    return (
                      <Button
                        key={option}
                        type="button"
                        variant={option === displayZone ? "default" : "outline"}
                        className="text-xs"
                        onClick={() => handleDisplayZoneChange(option)}
                        aria-pressed={option === displayZone}
                        aria-label={zoneId}
                        >
                          {zoneId}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                View
              </span>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(DEMO_VIEW_LABEL) as DemoViewMode[]).map(
                  (mode) => (
                    <Button
                      key={mode}
                      type="button"
                      variant={mode === viewMode ? "default" : "outline"}
                      className="text-xs"
                      onClick={() => setViewMode(mode)}
                      aria-pressed={mode === viewMode}
                    >
                      {DEMO_VIEW_LABEL[mode]}
                    </Button>
                  )
                )}
              </div>
            </div>
          </div>
          <ImportExport
            onImport={handleImportPlan}
            onReset={handleResetPlan}
            exportPlan={handleExportPlan}
            className="items-end text-right"
          />
        </div>
      </header>

      {viewMode === "calendar" ? (
        <CalendarListView
          plan={planState}
          computed={computed}
          displayZoneId={displayZoneId}
          onEditEvent={() => undefined}
          onEditAnchor={setActiveAnchorId}
          onAddEvent={handleAddEvent}
          onAddAnchor={handleAddAnchor}
        />
      ) : viewMode === "timeline" ? (
        <CalendarView
          plan={planState}
          computed={computed}
          displayZoneId={displayZoneId}
          onEditEvent={() => undefined}
          onEditAnchor={setActiveAnchorId}
          onEventChange={handleEventChange}
          onAnchorChange={handleAnchorChange}
          onAddAnchor={handleAddAnchor}
          onAddEvent={handleAddEvent}
        />
      ) : viewMode === "mini" ? (
        <MiniCalendarView
          computed={computed}
          displayZoneId={displayZoneId}
          onEditEvent={() => undefined}
          onEditAnchor={setActiveAnchorId}
          onEventChange={handleEventChange}
          onAnchorChange={handleAnchorChange}
          onAddEvent={handleAddEvent}
          onAddAnchor={handleAddAnchor}
        />
      ) : (
        <ScheduleTable
          computed={computed}
          displayZoneId={displayZoneId}
          onEditAnchor={setActiveAnchorId}
          onAddEvent={handleAddEvent}
          onAddAnchor={handleAddAnchor}
        />
      )}

      <ProjectedEvents computed={computed} />

      {activeAnchor ? (
        <form
          onSubmit={handleAnchorSave}
          className="space-y-4 rounded-xl border bg-card/60 p-6 shadow-sm backdrop-blur"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Edit {activeAnchorTitle ?? "Wake Time"}
              </p>
              <h3 className="text-lg font-semibold text-foreground">
                {activeAnchor.note ?? activeAnchorTitle ?? "Wake Time"}
              </h3>
              <p className="text-xs text-muted-foreground">
                Adjust the {activeAnchorLabel ?? "wake time"} by choosing a new
                local date and time in {activeAnchor.zone}.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleAnchorCancel}
            >
              Close
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label
              className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
              htmlFor={anchorDateFieldId}
            >
              Local date
              <input
                id={anchorDateFieldId}
                name="anchor-date"
                type="date"
                required
                value={formState.date}
                onChange={(event) =>
                  handleAnchorFieldChange("date", event.target.value)
                }
                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
            <label
              className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
              htmlFor={anchorTimeFieldId}
            >
              Local time
              <input
                id={anchorTimeFieldId}
                name="anchor-time"
                type="time"
                required
                value={formState.time}
                onChange={(event) =>
                  handleAnchorFieldChange("time", event.target.value)
                }
                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
            <label
              className="flex flex-col gap-1 text-xs font-medium text-muted-foreground md:col-span-1 md:[grid-column:span_1_/_auto]"
              htmlFor={anchorNoteFieldId}
            >
              Note (optional)
              <input
                id={anchorNoteFieldId}
                name="anchor-note"
                type="text"
                value={formState.note}
                onChange={(event) =>
                  handleAnchorFieldChange("note", event.target.value)
                }
                placeholder="Add a short reminder"
                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
          </div>

          {formError ? (
            <p className="text-sm text-destructive">{formError}</p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" size="sm">
              Save {activeAnchorLabel ?? "wake time"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAnchorCancel}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

export default ZoneShiftDemoComponent;
