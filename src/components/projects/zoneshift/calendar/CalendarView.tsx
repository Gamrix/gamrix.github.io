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

const noopEventChange: CalendarEventChangeHandler = () => undefined;
const noopAnchorChange: CalendarAnchorChangeHandler = () => undefined;
const noopAddAnchor: CalendarAddAnchorHandler = () => undefined;

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
