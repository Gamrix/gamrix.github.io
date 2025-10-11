import { useMemo, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";

import { Button } from "@/components/ui/button";
import { CalendarView } from "./calendar/CalendarView";
import { CalendarListView } from "./calendar/CalendarListView";
import { MiniCalendarView } from "./calendar/MiniCalendarView";
import { PlanParamsForm } from "./forms/PlanParamsForm";
import { AnchorDialog } from "./dialogs/AnchorDialog";
import { EventDialog } from "./dialogs/EventDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialogs/DialogPrimitive";
import { ScheduleTable } from "./table/ScheduleTable";
import { ImportExport } from "./toolbar/ImportExport";
import { TzToggle } from "./toolbar/TzToggle";
import { computePlan } from "@/scripts/projects/zoneshift/model";
import {
  planActions,
  planStore,
  type ViewMode,
  usePlanStore,
} from "./planStore";

const VIEW_OPTIONS: Array<{ id: ViewMode; label: string }> = [
  { id: "calendar", label: "List View" },
  { id: "timeline", label: "Calendar View" },
  { id: "mini", label: "Mini View" },
  { id: "table", label: "Table View" },
];

export function PlanEditor() {
  const plan = usePlanStore((state) => state.plan);
  const viewMode = usePlanStore((state) => state.viewMode);
  const activeEventId = usePlanStore((state) => state.activeEventId);
  const activeAnchorId = usePlanStore((state) => state.activeAnchorId);
  const [paramsOpen, setParamsOpen] = useState(false);

  const displayZone = plan.prefs?.displayZone ?? "target";
  const displayZoneId =
    displayZone === "home" ? plan.params.homeZone : plan.params.targetZone;
  const timeStepMinutes = plan.prefs?.timeStepMinutes ?? 30;

  const computed = useMemo(() => computePlan(plan), [plan]);

  const activeEvent =
    plan.events.find((event) => event.id === activeEventId) ?? null;
  const activeAnchor =
    plan.anchors.find((anchor) => anchor.id === activeAnchorId) ?? null;

  const totalDeltaHours = computed.meta.totalDeltaHours
    .toFixed(1)
    .replace(/\.0$/, "");
  const firstDay = computed.days[0];
  const lastDay = computed.days[computed.days.length - 1];

  const firstSleepLabel = firstDay
    ? `${firstDay.wakeDisplayDate.toLocaleString("en-US", { weekday: "short" })} @ ${firstDay.sleepStartLocal}`
    : "--";
  const finalSleepLabel = lastDay
    ? `${lastDay.wakeDisplayDate.toLocaleString("en-US", { weekday: "short" })} @ ${lastDay.sleepStartLocal}`
    : "--";

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-4 rounded-xl border bg-card/70 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Plan overview
            </p>
            <h1 className="text-2xl font-semibold text-foreground">
              Zoneshift alignment
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setParamsOpen(true)}
            >
              Edit base parameters
            </Button>
            <fieldset className="flex gap-2">
              <legend className="sr-only">View mode</legend>
              {VIEW_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  size="sm"
                  variant={viewMode === option.id ? "default" : "outline"}
                  onClick={() => planActions.setViewMode(option.id)}
                  aria-pressed={viewMode === option.id}
                >
                  {option.label}
                </Button>
              ))}
            </fieldset>
          </div>
        </div>

        <dl className="grid gap-6 text-sm text-muted-foreground md:grid-cols-4">
          <div>
            <dt className="uppercase tracking-[0.16em]">Shift strategy</dt>
            <dd className="text-lg font-medium text-foreground">
              {computed.meta.direction}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-[0.16em]">Total delta</dt>
            <dd className="text-lg font-medium text-foreground">
              {totalDeltaHours}h
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-[0.16em]">Kickoff sleep</dt>
            <dd className="text-lg font-medium text-foreground">
              {firstSleepLabel}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-[0.16em]">Final alignment</dt>
            <dd className="text-lg font-medium text-foreground">
              {finalSleepLabel}
            </dd>
          </div>
        </dl>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="space-y-4 lg:w-80 lg:flex-shrink-0">
          <ImportExport
            onImport={planActions.importPlan}
            onReset={planActions.resetToSample}
            exportPlan={planActions.exportPlan}
          />
        </div>

        <div className="flex-1 space-y-4">
          <TzToggle
            displayZone={displayZone}
            homeZone={plan.params.homeZone}
            targetZone={plan.params.targetZone}
            onChange={planActions.setDisplayZone}
          />

          {viewMode === "calendar" ? (
            <CalendarListView
              plan={plan}
              computed={computed}
              displayZoneId={displayZoneId}
              onEditEvent={planActions.setActiveEvent}
              onEditAnchor={planActions.setActiveAnchor}
            />
          ) : viewMode === "timeline" ? (
            <CalendarView
              plan={plan}
              computed={computed}
              displayZoneId={displayZoneId}
              onEditEvent={planActions.setActiveEvent}
              onEditAnchor={planActions.setActiveAnchor}
              onEventChange={(eventId, payload) =>
                planActions.moveEvent(eventId, payload, timeStepMinutes)
              }
              onAnchorChange={(anchorId, payload) =>
                planActions.moveAnchor(anchorId, payload, timeStepMinutes)
              }
              onAddAnchor={(payload) => {
                const existingIds = new Set(
                  plan.anchors.map((anchor) => anchor.id)
                );
                planActions.addAnchorAt(payload);
                const nextAnchors = planStore.getState().plan.anchors;
                const created = nextAnchors.find(
                  (anchor) => !existingIds.has(anchor.id)
                );
                if (created) {
                  planActions.setActiveAnchor(created.id);
                }
              }}
            />
          ) : viewMode === "mini" ? (
            <MiniCalendarView
              computed={computed}
              displayZoneId={displayZoneId}
              onEditEvent={planActions.setActiveEvent}
              onEventChange={(eventId, payload) =>
                planActions.moveEvent(eventId, payload, timeStepMinutes)
              }
            />
          ) : (
            <ScheduleTable
              computed={computed}
              displayZoneId={displayZoneId}
              onEditAnchor={planActions.setActiveAnchor}
            />
          )}
        </div>
      </div>

      <Dialog open={paramsOpen} onOpenChange={setParamsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Adjust base parameters</DialogTitle>
            <DialogDescription>
              Configure the source and destination zones along with core sleep
              preferences for this plan.
            </DialogDescription>
          </DialogHeader>
          <PlanParamsForm
            plan={plan}
            onUpdateParams={planActions.updateParams}
            onSetTimeStep={planActions.setTimeStep}
            onSubmitSuccess={() => setParamsOpen(false)}
            onCancel={() => setParamsOpen(false)}
            submitLabel="Apply changes"
            className="space-y-3"
          />
        </DialogContent>
      </Dialog>

      <EventDialog
        plan={plan}
        event={activeEvent}
        open={Boolean(activeEvent)}
        onClose={() => planActions.setActiveEvent(null)}
        onUpdate={(eventId, payload) =>
          planActions.updateEvent(eventId, (event) => ({
            ...event,
            ...payload,
          }))
        }
        onRemove={planActions.removeEvent}
      />

      <AnchorDialog
        plan={plan}
        anchor={activeAnchor}
        open={Boolean(activeAnchor)}
        onClose={() => planActions.setActiveAnchor(null)}
        onUpdate={(anchorId, payload) =>
          planActions.updateAnchor(anchorId, (anchor) => ({
            ...anchor,
            ...payload,
          }))
        }
        onRemove={planActions.removeAnchor}
      />
    </section>
  );
}

export default PlanEditor;
