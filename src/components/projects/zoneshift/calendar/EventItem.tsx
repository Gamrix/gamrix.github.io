
import { Fragment, type PointerEvent, type MouseEvent } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { Button } from "@/components/ui/button";
import { MINUTES_IN_DAY, rangeDaySuffix, minutesSinceStartOfDay } from "../utils/timeSegments";

import type { MiniEvent } from "./MiniEvent";

type EventItemProps = {
    item: MiniEvent;
    isActive: boolean;
    onEditEvent?: (eventId: string) => void;
    onEditAnchor?: (anchorId: string) => void;
    onPointerDown: (e: PointerEvent<HTMLButtonElement>, item: MiniEvent) => void;
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLButtonElement>, itemId: string) => void;
    onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => void;
    onClick: (e: MouseEvent<HTMLButtonElement>, itemId: string) => void;
};

export function EventItem({
    item,
    isActive,
    onEditEvent,
    onEditAnchor,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClick,
}: EventItemProps) {
    const isWake = item.kind === "wake";
    const startMinutes = minutesSinceStartOfDay(item.start);
    const safeStartMinutes = Math.min(
        Math.max(0, startMinutes),
        MINUTES_IN_DAY
    );
    const topPercent = (safeStartMinutes / MINUTES_IN_DAY) * 100;

    let markerBackground = "bg-background";
    if (isWake) {
        markerBackground = "bg-emerald-500 border-emerald-600";
    } else if (item.title === "Sleep") {
        markerBackground = "bg-blue-600 border-blue-700";
    }

    const cursorClass = item.editable
        ? "cursor-grab active:cursor-grabbing"
        : "cursor-default";

    const eventDaySuffix = item.end
        ? rangeDaySuffix(item.start, item.end)
        : "";

    const ariaLabel = isWake
        ? `Wake up at ${item.summary} `
        : `${item.title} at ${item.summary}${eventDaySuffix} `;

    const focusRingClass = isWake
        ? "focus-visible:ring-emerald-500/70"
        : "focus-visible:ring-ring/60";

    return (
        <Fragment>
            <button
                type="button"
                onPointerDown={(e) => onPointerDown(e, item)}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => onPointerUp(e, item.id)}
                onPointerCancel={onPointerCancel}
                onClick={(e) => onClick(e, item.id)}
                className={`absolute left - 1 / 2 z - 20 h - 6 w - 6 - translate - x - 1 / 2 rounded - full border border - card shadow - sm ${markerBackground} ${cursorClass} touch - none focus - visible: outline - none focus - visible: ring - 2 ${focusRingClass} `}
                style={{
                    top: `calc(${topPercent} % - 12px)`,
                }}
                aria-label={ariaLabel}
            >
                {eventDaySuffix ? (
                    <span className="sr-only">{eventDaySuffix}</span>
                ) : null}
            </button>
            {isActive ? (
                <div
                    className={`absolute left - 1 / 2 z - 30 w - 48 - translate - x - 1 / 2 - translate - y - full rounded - lg border ${isWake ? "border-emerald-500/60" : "border-border"
                        } bg - card / 95 p - 3 text - xs shadow - lg`}
                    style={{
                        top: `calc(${topPercent} % - 16px)`,
                    }}
                >
                    <div className="font-semibold text-foreground">{item.title}</div>
                    <p className="text-muted-foreground">{item.summary}</p>
                    {!isWake && item.end
                        ? (() => {
                            const daySuffix = rangeDaySuffix(item.start, item.end).trim();
                            return daySuffix ? (
                                <p className="mt-1 text-muted-foreground">{daySuffix}</p>
                            ) : null;
                        })()
                        : null}
                    {isWake ? (
                        <div className="mt-2 space-y-1 text-muted-foreground">
                            <p>Local time: {item.displayTime ?? item.summary}</p>
                            <p>Zone: {item.zone}</p>
                            {item.note ? <p>Note: {item.note}</p> : null}
                        </div>
                    ) : null}
                    {onEditEvent && !isWake ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => onEditEvent(item.id)}
                        >
                            Edit event
                        </Button>
                    ) : null}
                    {onEditAnchor && isWake && item.anchorId ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => onEditAnchor(item.anchorId!)}
                        >
                            Edit wake anchor
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </Fragment>
    );
}
