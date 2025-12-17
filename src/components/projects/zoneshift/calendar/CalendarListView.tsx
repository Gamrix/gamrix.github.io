import { useMemo, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type {
  ComputedView,
  CorePlan,
} from "@/scripts/projects/zoneshift/model";
import { formatRangeLabel } from "../utils/timeSegments";

type CalendarListViewProps = {
  plan: CorePlan;
  computed: ComputedView;
  displayZoneId: string;
  onEditEvent: (eventId: string) => void;
  onEditAnchor: (anchorId: string) => void;
  onAddEvent?: (payload: {
    title: string;
    start: Temporal.ZonedDateTime;
    end?: Temporal.ZonedDateTime;
    zone: string;
  }) => void;
  onAddAnchor?: (payload: {
    zoned: Temporal.ZonedDateTime;
    zone: string;
    note?: string;
    autoSelect?: boolean;
  }) => void;
};

type CalendarEvent = {
  id: string;
  title: string;
  start: Temporal.ZonedDateTime;
  end?: Temporal.ZonedDateTime;
  splitFrom?: string;
};

type CalendarAnchor = {
  id: string;
  note?: string;
  zoned: Temporal.ZonedDateTime;
  editable: boolean;
};

export function CalendarListView({
  plan,
  computed,
  displayZoneId,
  onEditEvent,
  onEditAnchor,
  onAddEvent,
  onAddAnchor,
}: CalendarListViewProps) {
  const editableAnchorIds = useMemo(
    () => new Set(plan.anchors.map((anchor) => anchor.id)),
    [plan.anchors]
  );

  const eventsByDay = useMemo(() => {
    const mapping = new Map<string, CalendarEvent[]>();
    computed.manualEvents.forEach((event) => {
      try {
        const start = event.startZoned.withTimeZone(displayZoneId);
        const end = event.endZoned
          ? event.endZoned.withTimeZone(displayZoneId)
          : undefined;
        const key = start.toPlainDate().toString();
        const bucket = mapping.get(key) ?? [];
        bucket.push({ id: event.id, title: event.title ?? "", start, end, splitFrom: event.splitFrom });
        mapping.set(key, bucket);
      } catch (error) {
        console.error(
          "Failed to project event for calendar list",
          event.id,
          error
        );
      }
    });

    for (const bucket of mapping.values()) {
      bucket.sort((a, b) => Temporal.ZonedDateTime.compare(a.start, b.start));
    }

    return mapping;
  }, [computed.manualEvents, displayZoneId]);

  const anchorsByDay = useMemo(() => {
    const mapping = new Map<string, CalendarAnchor[]>();
    plan.anchors.forEach((anchor) => {
      try {
        const zoned = Temporal.Instant.from(anchor.instant).toZonedDateTimeISO(displayZoneId);
        const key = zoned.toPlainDate().toString();
        const bucket = mapping.get(key) ?? [];
        bucket.push({
          id: anchor.id,
          note: anchor.note,
          zoned,
          editable: editableAnchorIds.has(anchor.id),
        });
        mapping.set(key, bucket);
      } catch (error) {
        console.error(
          "Failed to project anchor for calendar list",
          anchor.id,
          error
        );
      }
    });

    for (const bucket of mapping.values()) {
      bucket.sort((a, b) => Temporal.ZonedDateTime.compare(a.zoned, b.zoned));
    }

    return mapping;
  }, [plan.anchors, displayZoneId, editableAnchorIds]);

  const [composer, setComposer] = useState<
    | null
    | {
      type: "event" | "wake";
      dayKey: string;
    }
  >(null);
  const [eventDraft, setEventDraft] = useState({
    title: "",
    start: "",
    end: "",
  });
  const [wakeDraft, setWakeDraft] = useState({
    time: "",
    note: "",
  });
  const [composerError, setComposerError] = useState<string | null>(null);

  const closeComposer = () => {
    setComposer(null);
    setComposerError(null);
  };

  const openEventComposer = (
    wakeZoned: Temporal.ZonedDateTime,
    brightEndZoned: Temporal.ZonedDateTime | undefined,
    dayKey: string
  ) => {
    const startDisplay = wakeZoned.withTimeZone(displayZoneId);
    const endDisplay = brightEndZoned
      ? brightEndZoned.withTimeZone(displayZoneId)
      : startDisplay.add({ hours: 1 }); // Fallback duration

    setEventDraft({
      title: "",
      start: startDisplay
        .toPlainTime()
        .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 }),
      end: endDisplay
        .toPlainTime()
        .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 }),
    });
    setComposer({ type: "event", dayKey });
    setComposerError(null);
  };

  const openWakeComposer = (
    wakeTimeLocal: string,
    dayKey: string
  ) => {
    setWakeDraft({
      time: wakeTimeLocal,
      note: "",
    });
    setComposer({ type: "wake", dayKey });
    setComposerError(null);
  };

  const handleEventSubmit = (
    event: FormEvent<HTMLFormElement>,
    wakeDate: Temporal.PlainDate
  ) => {
    event.preventDefault();
    if (!composer || composer.type !== "event") {
      return;
    }
    if (!onAddEvent) {
      closeComposer();
      return;
    }
    try {
      const date = wakeDate;
      const startTime = Temporal.PlainTime.from(eventDraft.start);
      const startZoned = Temporal.ZonedDateTime.from({
        timeZone: displayZoneId,
        year: date.year,
        month: date.month,
        day: date.day,
        hour: startTime.hour,
        minute: startTime.minute,
        second: startTime.second,
      });
      let endZoned: Temporal.ZonedDateTime | undefined;
      if (eventDraft.end.trim().length > 0) {
        const endTime = Temporal.PlainTime.from(eventDraft.end);
        const baseEnd = Temporal.ZonedDateTime.from({
          timeZone: displayZoneId,
          year: date.year,
          month: date.month,
          day: date.day,
          hour: endTime.hour,
          minute: endTime.minute,
          second: endTime.second,
        });
        endZoned =
          Temporal.ZonedDateTime.compare(baseEnd, startZoned) <= 0
            ? baseEnd.add({ days: 1 })
            : baseEnd;
      } else {
        endZoned = startZoned.add({ minutes: 60 });
      }
      onAddEvent({
        title: eventDraft.title,
        start: startZoned,
        end: endZoned,
        zone: displayZoneId,
      });
      closeComposer();
    } catch (error) {
      setComposerError(
        error instanceof Error ? error.message : "Unable to add event"
      );
    }
  };

  const handleWakeSubmit = (
    event: FormEvent<HTMLFormElement>,
    wakeDate: Temporal.PlainDate
  ) => {
    event.preventDefault();
    if (!composer || composer.type !== "wake") {
      return;
    }
    if (!onAddAnchor) {
      closeComposer();
      return;
    }
    try {
      const time = Temporal.PlainTime.from(wakeDraft.time);
      const zoned = Temporal.ZonedDateTime.from({
        timeZone: displayZoneId,
        year: wakeDate.year,
        month: wakeDate.month,
        day: wakeDate.day,
        hour: time.hour,
        minute: time.minute,
        second: time.second,
      });
      onAddAnchor({
        zoned,
        zone: displayZoneId,
        note: wakeDraft.note.trim().length > 0 ? wakeDraft.note : undefined,
        autoSelect: false,
      });
      closeComposer();
    } catch (error) {
      setComposerError(
        error instanceof Error ? error.message : "Unable to add wake time"
      );
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {computed.wakeSchedule.map((entry, index) => {
        const allEvents = computed.displayDays.flatMap(d => d.events);
        const wakeEvent = allEvents.find(e =>
          e.id === entry.wakeEvent.id || e.splitFrom === entry.wakeEvent.id
        );
        const sleepEvent = allEvents.find(e =>
          e.id === entry.sleepEvent.id || e.splitFrom === entry.sleepEvent.id
        );
        const brightEvent = allEvents.find(e =>
          e.id === entry.brightEvent.id || e.splitFrom === entry.brightEvent.id
        );

        if (!wakeEvent || !sleepEvent || !brightEvent) return null;

        const wakeDate = wakeEvent.startZoned.toPlainDate();
        const dayKey = wakeDate.toString();
        const events = eventsByDay.get(dayKey) ?? [];
        const anchors = anchorsByDay.get(dayKey) ?? [];
        const weekday = wakeDate.toLocaleString("en-US", { weekday: "short" });
        const dateLabel = wakeDate.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
        });

        return (
          <article
            key={entry.wakeEvent.startInstant.toString()}
            className="flex h-full flex-col gap-4 rounded-lg border bg-card/70 p-4 shadow-sm"
          >
            <header className="flex items-baseline justify-between text-sm text-foreground">
              <span className="font-semibold">{weekday}</span>
              <span className="text-muted-foreground">{dateLabel}</span>
            </header>

            <dl className="grid gap-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <dt className="uppercase tracking-[0.16em]">Sleep</dt>
                <dd className="font-medium text-foreground">
                  {formatRangeLabel(sleepEvent.startZoned, wakeEvent.startZoned)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="uppercase tracking-[0.16em]">Wake</dt>
                <dd className="font-medium text-foreground">
                  {wakeEvent.startZoned.toPlainTime().toString({
                    smallestUnit: "minute",
                    fractionalSecondDigits: 0
                  })}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="uppercase tracking-[0.16em]">Bright</dt>
                <dd className="font-medium text-foreground">
                  {brightEvent.endZoned ? formatRangeLabel(wakeEvent.startZoned, brightEvent.endZoned) : "--"}
                </dd>
              </div>
            </dl>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Wake Times
              </h3>
              {anchors.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No wake times scheduled.
                </p>
              ) : (
                anchors.map((anchor) => (
                  <Button
                    key={anchor.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-between text-left"
                    onClick={() => onEditAnchor(anchor.id)}
                    disabled={!anchor.editable}
                  >
                    <span className="font-medium text-foreground">
                      Wake time @
                      {anchor.zoned
                        .toPlainTime()
                        .toString({
                          smallestUnit: "minute",
                          fractionalSecondDigits: 0,
                        })}
                    </span>
                    {anchor.note ? (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {anchor.note}
                      </span>
                    ) : null}
                  </Button>
                ))
              )}
              {composer?.type === "wake" && composer.dayKey === dayKey ? (
                <form
                  onSubmit={(event) => handleWakeSubmit(event, wakeDate)}
                  className="space-y-2 rounded-lg border border-dashed bg-card/80 p-3 text-xs text-muted-foreground"
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      Time
                      <input
                        type="time"
                        required
                        value={wakeDraft.time}
                        onChange={(event) =>
                          setWakeDraft((prev) => ({
                            ...prev,
                            time: event.target.value,
                          }))
                        }
                        className="rounded-md border px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      Note
                      <input
                        type="text"
                        value={wakeDraft.note}
                        onChange={(event) =>
                          setWakeDraft((prev) => ({
                            ...prev,
                            note: event.target.value,
                          }))
                        }
                        placeholder="Optional label"
                        className="rounded-md border px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      />
                    </label>
                  </div>
                  {composerError ? (
                    <p className="text-xs text-destructive">{composerError}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm">
                      Save wake time
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={closeComposer}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : onAddAnchor ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => openWakeComposer(wakeEvent.startZoned.toPlainTime().toString({ smallestUnit: "minute", fractionalSecondDigits: 0 }), dayKey)}
                >
                  Add wake anchor
                </Button>
              ) : null}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Events
              </h3>
              {events.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No events scheduled.
                </p>
              ) : (
                events.map((event) => {
                  const startLabel = event.start
                    .toPlainTime()
                    .toString({
                      smallestUnit: "minute",
                      fractionalSecondDigits: 0,
                    });
                  const endLabel = event.end
                    ? event.end
                      .toPlainTime()
                      .toString({
                        smallestUnit: "minute",
                        fractionalSecondDigits: 0,
                      })
                    : null;
                  const rangeLabel = event.end
                    ? formatRangeLabel(event.start, event.end, {
                      separator: " → ",
                    })
                    : startLabel;
                  return (
                    <Button
                      key={event.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-left"
                      onClick={() => onEditEvent(event.splitFrom ?? event.id)}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {event.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {rangeLabel}
                        </span>
                      </div>
                    </Button>
                  );
                })
              )}
              {composer?.type === "event" && composer.dayKey === dayKey ? (
                <form
                  onSubmit={(event) => handleEventSubmit(event, wakeDate)}
                  className="space-y-2 rounded-lg border border-dashed bg-card/80 p-3 text-xs text-muted-foreground"
                >
                  <label className="flex flex-col gap-1">
                    Title
                    <input
                      type="text"
                      value={eventDraft.title}
                      onChange={(event) =>
                        setEventDraft((prev) => ({
                          ...prev,
                          title: event.target.value,
                        }))
                      }
                      placeholder="Name this event"
                      className="rounded-md border px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      Starts
                      <input
                        type="time"
                        required
                        value={eventDraft.start}
                        onChange={(event) =>
                          setEventDraft((prev) => ({
                            ...prev,
                            start: event.target.value,
                          }))
                        }
                        className="rounded-md border px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      Ends
                      <input
                        type="time"
                        required
                        value={eventDraft.end}
                        onChange={(event) =>
                          setEventDraft((prev) => ({
                            ...prev,
                            end: event.target.value,
                          }))
                        }
                        className="rounded-md border px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      />
                    </label>
                  </div>
                  {composerError ? (
                    <p className="text-xs text-destructive">{composerError}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm">
                      Save event
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={closeComposer}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : onAddEvent ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => openEventComposer(wakeEvent.startZoned, brightEvent.endZoned, dayKey)}
                >
                  Add event
                </Button>
              ) : null}
            </section>
          </article>
        );
      })}
    </div>
  );
}

export default CalendarListView;
