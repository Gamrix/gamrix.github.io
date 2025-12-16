import { useState, type FormEvent } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { Button } from "@/components/ui/button";
import type { ComputedView } from "@/scripts/projects/zoneshift/model";
import { formatRangeLabel, rangeDaySuffix } from "./utils/timeSegments";

const formatChange = (value: number) => {
  if (Math.abs(value) < 0.05) {
    return "0";
  }
  return value.toFixed(1).replace(/\.0$/, "");
};

const formatDayLabel = (date: Temporal.PlainDate) => {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  const weekday = date.toLocaleString("en-US", { weekday: "short" });
  return {
    dateLabel: `${month}/${day}`,
    weekday,
  };
};

type ScheduleTableProps = {
  computed: ComputedView;
  displayZoneId: string;
  onEditAnchor?: (anchorId: string) => void;
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

export function ScheduleTable({
  computed,
  displayZoneId,
  onEditAnchor,
  onAddEvent,
  onAddAnchor,
}: ScheduleTableProps) {
  const [composer, setComposer] = useState<
    | null
    | { type: "event"; dayKey: string }
    | { type: "wake"; dayKey: string }
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

  if (computed.wakeSchedule.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Schedule data becomes available once you provide core plan details.
      </div>
    );
  }

  const closeComposer = () => {
    setComposer(null);
    setComposerError(null);
  };

  const openEventComposer = (wakeDate: Temporal.PlainDate, wakeZoned: Temporal.ZonedDateTime, brightEndZoned: Temporal.ZonedDateTime) => {
    const dayKey = wakeDate.toString();
    const startDisplay = wakeZoned.withTimeZone(displayZoneId);
    const endDisplay = brightEndZoned.withTimeZone(displayZoneId);
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

  const openWakeComposer = (wakeDate: Temporal.PlainDate, wakeTimeLocal: string) => {
    const dayKey = wakeDate.toString();
    setWakeDraft({
      time: wakeTimeLocal,
      note: "",
    });
    setComposer({ type: "wake", dayKey });
    setComposerError(null);
  };

  const handleEventSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!composer || composer.type !== "event") {
      return;
    }
    if (!onAddEvent) {
      closeComposer();
      return;
    }
    try {
      const date = Temporal.PlainDate.from(composer.dayKey);
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
      const endTime = Temporal.PlainTime.from(eventDraft.end);
      let endZoned = Temporal.ZonedDateTime.from({
        timeZone: displayZoneId,
        year: date.year,
        month: date.month,
        day: date.day,
        hour: endTime.hour,
        minute: endTime.minute,
        second: endTime.second,
      });
      if (Temporal.ZonedDateTime.compare(endZoned, startZoned) <= 0) {
        endZoned = endZoned.add({ days: 1 });
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

  const handleWakeSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!composer || composer.type !== "wake") {
      return;
    }
    if (!onAddAnchor) {
      closeComposer();
      return;
    }
    try {
      const date = Temporal.PlainDate.from(composer.dayKey);
      const time = Temporal.PlainTime.from(wakeDraft.time);
      const zoned = Temporal.ZonedDateTime.from({
        timeZone: displayZoneId,
        year: date.year,
        month: date.month,
        day: date.day,
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

  const composerScheduleEntry = composer
    ? computed.wakeSchedule.find((entry) => {
      const allEvents = computed.displayDays.flatMap(d => d.events);
      const wakeEvent = allEvents.find(e =>
        e.id === entry.wakeEvent.id || e.splitFrom === entry.wakeEvent.id
      );
      return wakeEvent?.startZoned.toPlainDate().toString() === composer.dayKey;
    })
    : null;
  const composerLabel = composerScheduleEntry
    ? (() => {
      const allEvents = computed.displayDays.flatMap(d => d.events);
      const wakeEvent = allEvents.find(e =>
        e.id === composerScheduleEntry.wakeEvent.id || e.splitFrom === composerScheduleEntry.wakeEvent.id
      );
      return wakeEvent?.startZoned.toPlainDate().toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    })()
    : null;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <table className="w-full border-spacing-0 text-left text-sm">
        <caption className="bg-muted/60 px-6 py-4 text-left text-sm font-medium text-muted-foreground">
          Derived daily sleep, wake, and bright-light guidance.
        </caption>
        <thead className="bg-muted/50 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <tr>
            <th scope="col" className="px-6 py-3 font-medium">
              Date
            </th>
            <th scope="col" className="px-6 py-3 font-medium">
              Shift Δ (h)
            </th>
            <th scope="col" className="px-6 py-3 font-medium">
              Sleep Start
            </th>
            <th scope="col" className="px-6 py-3 font-medium">
              Sleep End
            </th>
            <th scope="col" className="px-6 py-3 font-medium">
              Wake
            </th>
            <th scope="col" className="px-6 py-3 font-medium">
              Bright Window
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {computed.wakeSchedule.map((entry) => {
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

            if (!wakeEvent || !sleepEvent || !brightEvent || !brightEvent.endZoned) return null;

            const wakeDate = wakeEvent.startZoned.toPlainDate();
            const { dateLabel, weekday } = formatDayLabel(wakeDate);
            const wakeTimeLocal = wakeEvent.startZoned.toPlainTime().toString({
              smallestUnit: "minute",
              fractionalSecondDigits: 0
            });
            const anchor = entry.anchor;

            return (
              <tr key={entry.wakeEvent.startInstant.toString()} className="hover:bg-muted/20">
                <td className="px-6 py-4 align-middle">
                  <div className="font-medium text-foreground">{dateLabel}</div>
                  <div className="text-xs text-muted-foreground">{weekday}</div>
                  {anchor && (
                    <div className="mt-2 space-y-1">
                      {(() => {
                        const anchorTime = Temporal.Instant.from(anchor.instant)
                          .toZonedDateTimeISO(displayZoneId)
                          .toPlainTime()
                          .toString({
                            smallestUnit: "minute",
                            fractionalSecondDigits: 0,
                          });
                        const label = `Wake time @ ${anchorTime}`;
                        const badgeClass =
                          "inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
                        const editable = !anchor.id.startsWith("__auto");

                        const anchorBadge =
                          editable && onEditAnchor ? (
                            <button
                              type="button"
                              onClick={() => onEditAnchor(anchor.id)}
                              className={`${badgeClass} hover:bg-primary/20`}
                            >
                              {label}
                            </button>
                          ) : (
                            <span className={badgeClass}>{label}</span>
                          );

                        return (
                          <div
                            key={anchor.id}
                            className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                          >
                            {anchorBadge}
                            {anchor.note ? <span>{anchor.note}</span> : null}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {onAddAnchor ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openWakeComposer(wakeDate, wakeTimeLocal)}
                      >
                        Add wake anchor
                      </Button>
                    ) : null}
                    {onAddEvent ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (brightEvent.endZoned) {
                            openEventComposer(wakeDate, wakeEvent.startZoned, brightEvent.endZoned);
                          }
                        }}
                      >
                        Plan event
                      </Button>
                    ) : null}
                  </div>
                </td>
                <td className="px-6 py-4 align-middle font-mono text-sm text-muted-foreground">
                  {formatChange(entry.shiftFromPreviousWakeHours)}
                </td>
                <td className="px-6 py-4 align-middle font-mono text-sm">
                  {sleepEvent.startZoned.toPlainTime().toString({
                    smallestUnit: "minute",
                    fractionalSecondDigits: 0
                  })}
                </td>
                <td className="px-6 py-4 align-middle font-mono text-sm">
                  {wakeTimeLocal}
                  {rangeDaySuffix(sleepEvent.startZoned, wakeEvent.startZoned)}
                </td>
                <td className="px-6 py-4 align-middle font-mono text-sm">
                  {wakeTimeLocal}
                </td>
                <td className="px-6 py-4 align-middle font-mono text-sm">
                  {formatRangeLabel(wakeEvent.startZoned, brightEvent.endZoned)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {composer ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-xl border bg-card p-4 text-sm shadow-xl">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {composer.type === "event" ? "Add event" : "Add wake time"}
            </div>
            {composerLabel ? (
              <div className="text-sm font-semibold text-foreground">
                {composerLabel}
              </div>
            ) : null}
            {composer.type === "event" ? (
              <form className="space-y-3" onSubmit={handleEventSubmit}>
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
                    placeholder="Describe the event"
                    className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                      className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                      className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                    size="sm"
                    variant="outline"
                    onClick={closeComposer}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <form className="space-y-3" onSubmit={handleWakeSubmit}>
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
                      className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                      placeholder="Optional context"
                      className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                    size="sm"
                    variant="outline"
                    onClick={closeComposer}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
