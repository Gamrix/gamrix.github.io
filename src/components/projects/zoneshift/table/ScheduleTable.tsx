import { useEffect, useMemo, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";

import type { ComputedView } from "@/scripts/projects/zoneshift/model";
import { formatRangeLabel, rangeDaySuffix } from "../utils/timeSegments";

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
};

export function ScheduleTable({
  computed,
  displayZoneId,
  onEditAnchor,
}: ScheduleTableProps) {
  const hasDays = computed.days.length > 0;
  const [visibleCount, setVisibleCount] = useState(() =>
    hasDays ? Math.min(7, computed.days.length) : 0
  );
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (!hasDays) {
      return undefined;
    }
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
  }, [computed.days.length, hasDays]);

  useEffect(() => {
    if (!hasDays) {
      setVisibleCount(0);
      return;
    }
    setVisibleCount((prev) =>
      Math.min(Math.max(prev, 7), computed.days.length)
    );
  }, [computed.days.length, hasDays]);

  const days = useMemo(
    () => (hasDays ? computed.days.slice(0, visibleCount) : []),
    [computed.days, visibleCount, hasDays]
  );

  if (!hasDays) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Schedule data becomes available once you provide core plan details.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full border-spacing-0 text-left text-sm">
          <caption className="sticky top-0 z-10 bg-muted/90 px-6 py-4 text-left text-sm font-medium text-muted-foreground backdrop-blur">
            Derived daily sleep, wake, and bright-light guidance.
          </caption>
          <thead className="sticky top-[64px] z-10 bg-muted/95 text-xs uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
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
            {days.map((day) => {
              const { dateLabel, weekday } = formatDayLabel(day.wakeDisplayDate);
              return (
                <tr key={day.wakeInstant.toString()} className="hover:bg-muted/20">
                  <td className="px-6 py-4 align-middle">
                    <div className="font-medium text-foreground">
                      {dateLabel}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {weekday}
                    </div>
                    {day.anchors.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {day.anchors.map((anchor) => {
                          const anchorTime = anchor.instant
                            .toZonedDateTimeISO(displayZoneId)
                            .toPlainTime()
                            .toString({
                              smallestUnit: "minute",
                              fractionalSecondDigits: 0,
                            });
                          const label = `Wake time @ ${anchorTime}`;
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
                  <td className="px-6 py-4 align-middle font-mono text-sm">
                    {day.sleepStartLocal}
                  </td>
                  <td className="px-6 py-4 align-middle font-mono text-sm">
                    {day.wakeTimeLocal}
                    {rangeDaySuffix(day.sleepStartZoned, day.wakeZoned)}
                  </td>
                  <td className="px-6 py-4 align-middle font-mono text-sm">
                    {day.wakeTimeLocal}
                  </td>
                  <td className="px-6 py-4 align-middle font-mono text-sm">
                    {formatRangeLabel(day.wakeZoned, day.brightEndZoned)}
                  </td>
                </tr>
              );
            })}
            <tr ref={sentinelRef}>
              <td
                colSpan={6}
                className="px-6 py-3 text-center text-xs text-muted-foreground"
              >
                {visibleCount >= computed.days.length
                  ? "End of schedule"
                  : "Loading more days…"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
