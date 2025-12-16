import { useState, type FormEvent } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { Button } from "@/components/ui/button";

// Only output simple signal that we are done/cancelled
export type ComposerOutput = void;

type MiniCalendarComposerProps = {
    mode: "event" | "wake";
    dayKey: string;
    dayLabel: string;
    displayZoneId: string;
    initialValues: {
        startOrTime: string;
        end?: string;
    };
    onAddEvent?: (payload: {
        title: string;
        start: Temporal.ZonedDateTime;
        end: Temporal.ZonedDateTime;
        zone: string;
    }) => void;
    onAddAnchor?: (payload: {
        zoned: Temporal.ZonedDateTime;
        zone: string;
        note?: string;
        autoSelect?: boolean;
    }) => void;
    onCancel: () => void;
    className?: string;
};

export function MiniCalendarComposer({
    mode,
    dayKey,
    dayLabel,
    displayZoneId,
    initialValues,
    onAddEvent,
    onAddAnchor,
    onCancel,
    className,
}: MiniCalendarComposerProps) {
    const [eventDraft, setEventDraft] = useState({
        title: "",
        start: initialValues.startOrTime,
        end: initialValues.end ?? "",
    });

    const [wakeDraft, setWakeDraft] = useState({
        time: initialValues.startOrTime,
        note: "",
    });

    const [composerError, setComposerError] = useState<string | null>(null);

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        setComposerError(null);

        try {
            const date = Temporal.PlainDate.from(dayKey);

            if (mode === "event") {
                if (!onAddEvent) {
                    onCancel();
                    return;
                }
                if (!eventDraft.start || !eventDraft.end) {
                    throw new Error("Start and end times are required");
                }

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

                // Heuristic: if end time is earlier than start time, assume next day
                if (Temporal.ZonedDateTime.compare(endZoned, startZoned) <= 0) {
                    endZoned = endZoned.add({ days: 1 });
                }

                onAddEvent({
                    title: eventDraft.title,
                    start: startZoned,
                    end: endZoned,
                    zone: displayZoneId,
                });
                onCancel();
            } else {
                if (!onAddAnchor) {
                    onCancel();
                    return;
                }
                if (!wakeDraft.time) {
                    throw new Error("Time is required");
                }

                const timeObj = Temporal.PlainTime.from(wakeDraft.time);
                const zoned = Temporal.ZonedDateTime.from({
                    timeZone: displayZoneId,
                    year: date.year,
                    month: date.month,
                    day: date.day,
                    hour: timeObj.hour,
                    minute: timeObj.minute,
                    second: timeObj.second,
                });

                onAddAnchor({
                    zoned,
                    zone: displayZoneId,
                    note: wakeDraft.note.trim().length > 0 ? wakeDraft.note : undefined,
                    autoSelect: false,
                });
                onCancel();
            }
        } catch (err) {
            console.error(err);
            setComposerError(err instanceof Error ? err.message : "Invalid input");
        }
    };

    return (
        <div
            className={`absolute left-0 top-0 z-20 w-full min-w-[240px] max-w-sm rounded-lg border bg-card p-4 shadow-xl ring-1 ring-border ${className ?? ""
                }`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <div className="mb-3 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {mode === "event" ? "Add Event" : "Add Wake Anchor"}
                </h4>
                <span className="text-xs text-muted-foreground">{dayLabel}</span>
            </div>

            {mode === "event" ? (
                <form className="space-y-3" onSubmit={handleSubmit}>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-foreground">Title</span>
                        <input
                            type="text"
                            value={eventDraft.title}
                            onChange={(e) =>
                                setEventDraft((prev) => ({ ...prev, title: e.target.value }))
                            }
                            placeholder="Event title"
                            autoFocus
                            className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-foreground">Start</span>
                            <input
                                type="time"
                                required
                                value={eventDraft.start}
                                onChange={(e) =>
                                    setEventDraft((prev) => ({ ...prev, start: e.target.value }))
                                }
                                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-foreground">End</span>
                            <input
                                type="time"
                                required
                                value={eventDraft.end}
                                onChange={(e) =>
                                    setEventDraft((prev) => ({ ...prev, end: e.target.value }))
                                }
                                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            />
                        </label>
                    </div>
                    {composerError ? (
                        <p className="text-xs text-destructive">{composerError}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2 pt-2">
                        <Button type="submit" size="sm" className="h-8">
                            Save event
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={onCancel}
                        >
                            Cancel
                        </Button>
                    </div>
                </form>
            ) : (
                <form className="space-y-3" onSubmit={handleSubmit}>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-foreground">Time</span>
                            <input
                                type="time"
                                required
                                value={wakeDraft.time}
                                onChange={(e) =>
                                    setWakeDraft((prev) => ({ ...prev, time: e.target.value }))
                                }
                                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-foreground">Note</span>
                            <input
                                type="text"
                                value={wakeDraft.note}
                                onChange={(e) =>
                                    setWakeDraft((prev) => ({ ...prev, note: e.target.value }))
                                }
                                className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            />
                        </label>
                    </div>
                    {composerError ? (
                        <p className="text-xs text-destructive">{composerError}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2 pt-2">
                        <Button type="submit" size="sm" className="h-8">
                            Save anchor
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={onCancel}
                        >
                            Cancel
                        </Button>
                    </div>
                </form>
            )}
        </div>
    );
}
