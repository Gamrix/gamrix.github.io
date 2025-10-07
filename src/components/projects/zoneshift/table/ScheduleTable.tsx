import { useEffect, useMemo, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";

import type { ComputedView } from "@/scripts/projects/zoneshift/model";

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const formatChange = (value: number) => {
  if (Math.abs(value) < 0.05) {
    return "0";
  }
  return value.toFixed(1).replace(/\.0$/, "");
};

const formatDayLabel = (isoDate: string) => {
  const date = Temporal.PlainDate.from(isoDate);
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  const weekday = WEEKDAY[(date.dayOfWeek + 6) % 7];
  return {
    dateLabel: `${month}/${day}`,
    weekday,
  };
};

interface ScheduleTableProps {
  computed: ComputedView;
  displayZoneId: string;
  onEditAnchor?: (anchorId: string) => void;
}

const anchorKindLabel = {
  wake: "Wake time",
  sleep: "Sleep time",
} as const;

export function ScheduleTable({ computed, displayZoneId, onEditAnchor }: ScheduleTableProps) {
  if (computed.days.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Schedule data becomes available once you provide core plan details.
      </div>
    );
  }

  const [visibleCount, setVisibleCount] = useState(() => Math.min(7, computed.days.length));
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + 5, computed.days.length));
        }
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [computed.days.length]);

  useEffect(() => {
    setVisibleCount((prev) => Math.min(Math.max(prev, 7), computed.days.length));
  }, [computed.days.length]);

  const days = useMemo(() => computed.days.slice(0, visibleCount), [computed.days, visibleCount]);

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full border-spacing-0 text-left text-sm">
          <caption className="sticky top-0 z-10 bg-muted/90 px-6 py-4 text-left text-sm font-medium text-muted-foreground backdrop-blur">
            Derived daily sleep, wake, and bright-light guidance.
          </caption>
          <thead className="sticky top-[64px] z-10 bg-muted/95 text-xs uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
          <tr>
            <th scope="col" className="px-6 py-3 font-medium">Date</th>
            <th scope="col" className="px-6 py-3 font-medium">Shift Δ (h)</th>
            <th scope="col" className="px-6 py-3 font-medium">Sleep Start</th>
            <th scope="col" className="px-6 py-3 font-medium">Sleep End</th>
            <th scope="col" className="px-6 py-3 font-medium">Wake</th>
            <th scope="col" className="px-6 py-3 font-medium">Bright Window</th>
          </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
          {days.map((day) => {
            const { dateLabel, weekday } = formatDayLabel(day.dateTargetZone);
            return (
              <tr key={day.dateTargetZone} className="hover:bg-muted/20">
                <td className="px-6 py-4 align-middle">
                  <div className="font-medium text-foreground">{dateLabel}</div>
                  <div className="text-xs text-muted-foreground">{weekday}</div>
                  {day.anchors.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {day.anchors.map((anchor) => {
                        const anchorTime = Temporal.Instant.from(anchor.instant)
                          .toZonedDateTimeISO(displayZoneId)
                          .toPlainTime()
                          .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });
                        const label = `${anchorKindLabel[anchor.kind]} @ ${anchorTime}`;
                        const badgeClass =
                          "inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

                        const anchorBadge =
                          anchor.editable && onEditAnchor ? (
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
                      })}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 align-middle font-mono text-sm text-muted-foreground">
                  {formatChange(day.changeThisDayHours)}
                </td>
                <td className="px-6 py-4 align-middle font-mono text-sm">{day.sleepStartLocal}</td>
                <td className="px-6 py-4 align-middle font-mono text-sm">{day.sleepEndLocal}</td>
                <td className="px-6 py-4 align-middle font-mono text-sm">{day.wakeTimeLocal}</td>
                <td className="px-6 py-4 align-middle font-mono text-sm">
                  {day.brightStartLocal === "--:--" || day.brightEndLocal === "--:--"
                    ? "--"
                  : `${day.brightStartLocal} – ${day.brightEndLocal}`}
                </td>
              </tr>
            );
          })}
          <tr ref={sentinelRef}>
            <td colSpan={6} className="px-6 py-3 text-center text-xs text-muted-foreground">
              {visibleCount >= computed.days.length ? "End of schedule" : "Loading more days…"}
            </td>
          </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
