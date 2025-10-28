import { useEffect, useState, type FormEvent } from "react";
import { Temporal } from "@js-temporal/polyfill";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CorePlan } from "@/scripts/projects/zoneshift/model";

type PlanParamsFormProps = {
  plan: CorePlan;
  onUpdateParams: (partial: Partial<CorePlan["params"]>) => void;
  onSetTimeStep: (minutes: number) => void;
  onSubmitSuccess?: () => void;
  onCancel?: () => void;
  className?: string;
  submitLabel?: string;
};

const formatLocalDateTime = (instantIso: string, zone: string) =>
  Temporal.Instant.from(instantIso)
    .toZonedDateTimeISO(zone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute", fractionalSecondDigits: 0 });

const toInstant = (value: string, zone: string) => {
  const plain = Temporal.PlainDateTime.from(value);
  return Temporal.ZonedDateTime.from({
    timeZone: zone,
    year: plain.year,
    month: plain.month,
    day: plain.day,
    hour: plain.hour,
    minute: plain.minute,
  })
    .toInstant()
    .toString();
};

export function PlanParamsForm({
  plan,
  onUpdateParams,
  onSetTimeStep,
  onSubmitSuccess,
  onCancel,
  className,
  submitLabel,
}: PlanParamsFormProps) {
  const [startTimeZone, setStartTimeZone] = useState(plan.params.startTimeZone);
  const [endTimeZone, setEndTimeZone] = useState(plan.params.endTimeZone);
  const [startSleepLocal, setStartSleepLocal] = useState(
    formatLocalDateTime(plan.params.startSleepUtc, plan.params.endTimeZone)
  );
  const [endWakeLocal, setEndWakeLocal] = useState(
    formatLocalDateTime(plan.params.endWakeUtc, plan.params.endTimeZone)
  );
  const [sleepHours, setSleepHours] = useState(plan.params.sleepHours);
  const [maxLater, setMaxLater] = useState(
    plan.params.maxShiftLaterPerDayHours
  );
  const [maxEarlier, setMaxEarlier] = useState(
    plan.params.maxShiftEarlierPerDayHours
  );
  const [timeStep, setTimeStep] = useState(plan.prefs?.timeStepMinutes ?? 30);

  useEffect(() => {
    setStartTimeZone(plan.params.startTimeZone);
    setEndTimeZone(plan.params.endTimeZone);
    setStartSleepLocal(
      formatLocalDateTime(plan.params.startSleepUtc, plan.params.endTimeZone)
    );
    setEndWakeLocal(
      formatLocalDateTime(plan.params.endWakeUtc, plan.params.endTimeZone)
    );
    setSleepHours(plan.params.sleepHours);
    setMaxLater(plan.params.maxShiftLaterPerDayHours);
    setMaxEarlier(plan.params.maxShiftEarlierPerDayHours);
    setTimeStep(plan.prefs?.timeStepMinutes ?? 30);
  }, [plan]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      onUpdateParams({
        startTimeZone,
        endTimeZone,
        startSleepUtc: toInstant(startSleepLocal, endTimeZone),
        endWakeUtc: toInstant(endWakeLocal, endTimeZone),
        sleepHours,
        maxShiftLaterPerDayHours: maxLater,
        maxShiftEarlierPerDayHours: maxEarlier,
      });
      onSetTimeStep(timeStep);
      onSubmitSuccess?.();
    } catch (error) {
      console.error("Unable to persist parameters", error);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("space-y-3 text-sm", className)}
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          Plan parameters
        </h2>
        <p className="text-xs text-muted-foreground">
          Adjust the core sleep settings for this plan.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Start timezone
        <input
          type="text"
          value={startTimeZone}
          onChange={(event) => setStartTimeZone(event.target.value)}
          className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        End timezone
        <input
          type="text"
          value={endTimeZone}
          onChange={(event) => setEndTimeZone(event.target.value)}
          className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Start sleep block
        <input
          type="datetime-local"
          value={startSleepLocal}
          onChange={(event) => setStartSleepLocal(event.target.value)}
          className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        End wake time
        <input
          type="datetime-local"
          value={endWakeLocal}
          onChange={(event) => setEndWakeLocal(event.target.value)}
          className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          required
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Sleep hours
          <input
            type="number"
            min={0.25}
            max={18}
            step={0.25}
            value={sleepHours}
            onChange={(event) => setSleepHours(Number(event.target.value))}
            className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Time step (minutes)
          <select
            value={timeStep}
            onChange={(event) => setTimeStep(Number(event.target.value))}
            className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {[15, 30, 45, 60].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Max later shift / day
          <input
            type="number"
            min={0}
            max={12}
            step={0.25}
            value={maxLater}
            onChange={(event) => setMaxLater(Number(event.target.value))}
            className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Max earlier shift / day
          <input
            type="number"
            min={0}
            max={12}
            step={0.25}
            value={maxEarlier}
            onChange={(event) => setMaxEarlier(Number(event.target.value))}
            className="rounded-md border px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            required
          />
        </label>
      </div>

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="sm">
          {submitLabel ?? "Update plan"}
        </Button>
      </div>
    </form>
  );
}
