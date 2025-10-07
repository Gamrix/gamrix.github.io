import { Temporal } from "@js-temporal/polyfill";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { computePlan, type CorePlan } from "@/scripts/projects/zoneshift/model";
import { sampleCorePlan } from "@/scripts/projects/zoneshift/samplePlan";

import { ScheduleTable } from "./ScheduleTable";
import { CalendarView } from "./calendar/CalendarView";

const VIEW_LABEL: Record<"home" | "target", string> = {
  home: "Home Zone",
  target: "Target Zone",
};

const formatZoneLabel = (plan: CorePlan, key: "home" | "target") =>
  key === "home" ? plan.params.homeZone : plan.params.targetZone;

type DemoViewMode = "calendar" | "table";

const DEMO_VIEW_LABEL: Record<DemoViewMode, string> = {
  calendar: "Calendar",
  table: "Schedule",
};

const formatOffset = (hours: number) => {
  const sign = hours >= 0 ? "+" : "";
  return `${sign}${hours.toFixed(1).replace(/\.0$/, "")}h`;
};

const formatProjectedTime = (value: string) => {
  const zdt = Temporal.ZonedDateTime.from(value);
  const month = String(zdt.month).padStart(2, "0");
  const day = String(zdt.day).padStart(2, "0");
  const time = zdt.toPlainTime().toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });
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
          <li key={event.id} className="flex flex-col gap-1 rounded-lg border bg-card/50 p-4 text-sm">
            <span className="font-medium text-foreground">{event.title}</span>
            <span className="text-xs text-muted-foreground">
              {formatProjectedTime(event.startZoned)}
              {event.endZoned ? ` → ${formatProjectedTime(event.endZoned)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

function ZoneShiftDemoComponent() {
  const [planState, setPlanState] = useState<CorePlan>(() => sampleCorePlan);
  const displayZone = planState.prefs?.displayZone ?? "target";
  const [viewMode, setViewMode] = useState<DemoViewMode>("calendar");
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [formState, setFormState] = useState({ date: "", time: "", note: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const computed = useMemo(() => computePlan(planState), [planState]);

  const displayZoneId =
    displayZone === "home" ? planState.params.homeZone : planState.params.targetZone;
  const meta = computed.meta;
  const activeZoneLabel = formatZoneLabel(planState, displayZone);

  const activeAnchor = useMemo(
    () => planState.anchors.find((anchor) => anchor.id === activeAnchorId) ?? null,
    [planState.anchors, activeAnchorId],
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
    const anchorZdt = Temporal.Instant.from(activeAnchor.instant).toZonedDateTimeISO(
      activeAnchor.zone,
    );
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

  const handleAnchorFieldChange = (field: "date" | "time" | "note", value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
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
            : anchor,
        ),
      }));
      setActiveAnchorId(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to update wake time");
    }
  };

  const handleAnchorCancel = () => {
    setActiveAnchorId(null);
    setFormError(null);
  };

  return (
    <section className="space-y-10">
      <header className="flex flex-col gap-6 rounded-xl border bg-card/60 p-8 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-baseline md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Plan Summary
            </p>
            <h2 className="text-2xl font-semibold tracking-tight">Zoneshift Alignment Preview</h2>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Display zone
              </span>
              <div className="flex gap-2">
                {(Object.keys(VIEW_LABEL) as Array<"home" | "target">).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={option === displayZone ? "default" : "outline"}
                    className="text-xs"
                    onClick={() => handleDisplayZoneChange(option)}
                    aria-pressed={option === displayZone}
                  >
                    {VIEW_LABEL[option]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">View</span>
              <div className="flex gap-2">
                {(Object.keys(DEMO_VIEW_LABEL) as DemoViewMode[]).map((mode) => (
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
                ))}
              </div>
            </div>
          </div>
        </div>

        <dl className="grid gap-6 text-sm text-muted-foreground md:grid-cols-3">
          <div>
            <dt className="uppercase tracking-[0.16em]">Total Delta</dt>
            <dd className="text-lg font-medium text-foreground">
              {formatOffset(meta.totalDeltaHours)}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-[0.16em]">Shift Strategy</dt>
            <dd className="text-lg font-medium text-foreground">{meta.direction}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-[0.16em]">Viewing Zone</dt>
            <dd className="text-lg font-medium text-foreground">{activeZoneLabel}</dd>
          </div>
        </dl>
      </header>

      {viewMode === "calendar" ? (
        <CalendarView
          plan={planState}
          computed={computed}
          displayZoneId={displayZoneId}
          onEditEvent={() => undefined}
          onEditAnchor={setActiveAnchorId}
        />
      ) : (
        <ScheduleTable
          computed={computed}
          displayZoneId={displayZoneId}
          onEditAnchor={setActiveAnchorId}
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
                Adjust the {activeAnchorLabel ?? "wake time"} by choosing a new local date and time in
                {" "}
                {activeAnchor.zone}.
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={handleAnchorCancel}>
              Close
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Local date
              <input
                id="anchor-date"
                name="anchor-date"
                type="date"
                required
                value={formState.date}
                onChange={(event) => handleAnchorFieldChange("date", event.target.value)}
                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Local time
              <input
                id="anchor-time"
                name="anchor-time"
                type="time"
                required
                value={formState.time}
                onChange={(event) => handleAnchorFieldChange("time", event.target.value)}
                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground md:col-span-1 md:[grid-column:span_1_/_auto]">
              Note (optional)
              <input
                id="anchor-note"
                name="anchor-note"
                type="text"
                value={formState.note}
                onChange={(event) => handleAnchorFieldChange("note", event.target.value)}
                placeholder="Add a short reminder"
                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
          </div>

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" size="sm">
              Save {activeAnchorLabel ?? "wake time"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleAnchorCancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

export default ZoneShiftDemoComponent;
