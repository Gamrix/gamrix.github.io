import type { Temporal } from "@js-temporal/polyfill";

import type { ComputedView, CorePlan } from "@/scripts/projects/zoneshift/model";
import { Timeline } from "./Timeline";

interface CalendarViewProps {
  plan: CorePlan;
  computed: ComputedView;
  displayZoneId: string;
  onEditEvent: (eventId: string) => void;
  onEditAnchor: (anchorId: string) => void;
  onEventChange?: CalendarEventChangeHandler;
  onAnchorChange?: CalendarAnchorChangeHandler;
  onAddAnchor?: CalendarAddAnchorHandler;
}

type CalendarEventChangeHandler = (
  eventId: string,
  payload: { start: Temporal.ZonedDateTime; end?: Temporal.ZonedDateTime; zone: string },
) => void;

type CalendarAnchorChangeHandler = (
  anchorId: string,
  payload: { instant: Temporal.ZonedDateTime; zone: string },
) => void;

type CalendarAddAnchorHandler = (payload: {
  kind: "wake" | "sleep";
  zoned: Temporal.ZonedDateTime;
  zone: string;
}) => void;

function noopEventChange(
  _eventId: string,
  _payload: { start: Temporal.ZonedDateTime; end?: Temporal.ZonedDateTime; zone: string },
): void {
  return;
}

function noopAnchorChange(
  _anchorId: string,
  _payload: { instant: Temporal.ZonedDateTime; zone: string },
): void {
  return;
}

function noopAddAnchor(_payload: {
  kind: "wake" | "sleep";
  zoned: Temporal.ZonedDateTime;
  zone: string;
}): void {
  return;
}

export function CalendarView({
  plan,
  computed,
  displayZoneId,
  onEditEvent,
  onEditAnchor,
  onEventChange,
  onAnchorChange,
  onAddAnchor,
}: CalendarViewProps) {
  const timeStepMinutes = plan.prefs?.timeStepMinutes ?? 30;

  return (
    <Timeline
      plan={plan}
      computed={computed}
      displayZoneId={displayZoneId}
      timeStepMinutes={timeStepMinutes}
      onEditEvent={onEditEvent}
      onEditAnchor={onEditAnchor}
      onEventChange={onEventChange ?? noopEventChange}
      onAnchorChange={onAnchorChange ?? noopAnchorChange}
      onAddAnchor={onAddAnchor ?? noopAddAnchor}
    />
  );
}

export default CalendarView;
