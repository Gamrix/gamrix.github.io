# Model Calculation Order Overview

## Actual Calculation Flow in `model.ts`

The main entry point is `computePlan(core: CorePlan): ComputedView`. Here's the order:

### 1. Context Resolution (`resolvePlanContext`)
- Compute sleep duration from params
- Calculate timezone offset delta between home and target
- [REMOVE] Determine shift strategy (later vs earlier) and days needed

### 2. Anchor Preparation (in UTC)
- Copy user-defined anchors from core plan
- [REMOVE] Convert startSleepUtc to the start time zone
- Calculate startWake and endWake times
- Auto-generate start wake anchor if no anchor exists on start day **In Start Time Zone**
- Auto-generate end wake anchor  if no anchor exists on end day **In End Time Zone**
    - The start and end wake anchors are explicit anchor that is editable and persisted in Core Data Model
- Convert all anchors to **UTC** (`resolvedAnchors`)
- Build anchor lookup map by instant (is this needed?)

### 3. Date Range Calculation -- Removed as the end date is now explicit in the CoreParamsSchema

### 4. Wake Schedule Interpolation **(in UTC)**
- Sort anchors chronologically
- Place explicit anchor wake times (I don't think this is needed anymore)
- Interpolate wake times between anchors respecting max shift constraints
    - Only add a interpolated wake time if the wake time will be before (the next sleep start time of an explicit anchor - 6 hours)
    - 6 hours is a buffer to allow for some awake time before the next sleep start time
- Do not fill past the last explicit anchor

### 5. Sleep and Bright Light Computation **(in UTC)**
- For each wake time in schedule:
  - Compute sleep start (wake - sleep duration) -- Store as event in the computation chain but not persisted as an event in the Core Data Model
  - Compute bright light end (wake + 5 hours, **Do not do clamping at this step**) -- Store as event in the computation chain but not persisted as an event in the Core Data Model
  - [NOT NEEDED] Calculate shift amount from previous day
  - Store wake instant, and anchor references **No date splitting at this step**

### 6. Display Zone Projection
- Convert sleep/wake/bright times from **UTC** to display zone
- Project manual events to display zone
- Project anchors to display zone
- **Split all events into display zone days** (aka events that cross the display day boundary get split in two)
  - They should track the event they're split from
  - They need IDs only so that React has a way to track the display objects

### 7. Return ComputedView
- Return days array, projected events, projected anchors, and metadata

## Comparison with AGENTS.md Pipeline

### AGENTS.md Expected Pipeline:
1. Core Data Model
2. Automatic Event Generation
3. Conversion to display time zone
4. Day Bucketing by display zone
5. Rendering in UI

### What Aligns:
✅ Starts with Core Data Model (CorePlan)
✅ Manual events preserve their original time zones
✅ Final output converts to display zone
✅ All calculations use UTC internally via Temporal.Instant

### What Doesn't Align:
❌ **Day bucketing happens in TARGET zone, not display zone** - Days are organized by wake time in target zone (step 5), then converted to display zone (step 6) -- See changes to plan, we only work with Days starting in step 6
❌ **Sleep and bright light are NOT modeled as separate events** - They're computed as fields on DayComputed, not as EventItem objects -- Fix This
❌ **Automatic events aren't truly "generated"** - Sleep/bright times are calculated per-day inline, not created as reusable event objects -- They are not persisted as events in the Core Data Model, but are calculated in the computation chain
❌ **Manual events aren't used in wake calculations** - They're only projected for display, not integrated into the scheduling logic -- This is intended.
❌ **No backfill for initial gaps** - Forward-fill only (removed in simplification), so early dates may be missing -- Backfilling is done through always generating a wake time for the first day.

### Key Architectural Decision:
The model prioritizes wake times as the source of truth, computing everything else (sleep, bright light) derivatively per day. This differs from the event-centric model described in AGENTS.md where sleep and bright light would be first-class events.


## Other changes:
- Rename Home Zone to Start Time Zone
- Rename Target Zone to End Time Zone
- change Per Day Shifts to instead be shift from previous anchor wake time
- Rename AnchorPoint to WakeAnchor as they are all wake anchors

## Questions and Answers

Lines 10 vs 15: You marked "REMOVE shift strategy" but then kept "Calculate startWake and alignedWake times". Currently, alignedWake is calculated using strategy.daysNeeded and strategy.shiftAmountHours. How should alignedWake be calculated without the strategy? Or should we remove alignedWake entirely?
This should be based on a new parameter in the CoreParamsSchema called "endWakeUtc".

Line 14 vs 16: You marked "REMOVE Convert startSleepUtc to the start time zone" but then say "Auto-generate start anchor In Start Time Zone". If we don't convert to the start time zone, how do we know what day it is in that zone to check if an anchor exists?
Convert midnight to midnight + 1 day of the start time zone to UTC and then check against all anchors.


Line 18 - Remove anchor conversion: If we're keeping anchors in their original zones and working in UTC, don't we still need to convert them to UTC for chronological sorting and interpolation? Or do you mean something else?
Yes, we still need to convert them to UTC for chronological sorting and interpolation.

Unclear Concepts:

Line 17 - "End Time Zone": What is the "end time zone"? Is this the target zone? Or are you adding a new parameter to the model?
The end time zone is the target zone.

Line 22 - "configured end date": What is this? Currently there's no end date parameter. Do you mean:
A new explicit end date parameter? Yes, a new explicit end date parameter in the CoreParamsSchema.

Line 34 - Remove bright light clamping: We just fixed tests that verify clamping to midnight. Should we:
Keep it in some other form?
We want to change it to check that there are two events for the bright light time, one for the day before and one for the day after.

Line 35 - "Calculate shift amount not needed": The perDayShifts array is returned in metadata. Should we:
Stop calculating it entirely? Yes

Is something in the UI using this that needs to change? Check but there should not be

Line 42 - Event splitting: This is new functionality. For an event from 11pm-1am, should it become two events: 11pm-12am (day 1) and 12am-1am (day 2)? Do we need a new event type or flag to track split events?
They should be split events in the Display Zone projection of the data, but persisted as a single event in the Core Data Model.



## Recommended New Structure

```typescript
// Step 5 output: Events in UTC (before display zone projection)
export type ScheduleEvent = {
  id: string;
  kind: "sleep" | "bright" | "wake";
  startInstant: Temporal.Instant;
  endInstant?: Temporal.Instant;
  anchorId?: string;  // reference to persisted anchor if this wake event has one
};

export type WakeScheduleEntry = {
  wakeEvent: ScheduleEvent;  // the wake event (kind: "wake")
  sleepEvent: ScheduleEvent;  // the sleep event (kind: "sleep")
  brightEvent: ScheduleEvent;  // the bright light event (kind: "bright")
  anchor?: WakeAnchor;  // only if this wake has a persisted anchor
  shiftFromPreviousWakeHours: number;  // shift from previous wake (0 for first)
};

// Step 6 output: Events projected to display zone
export type DisplayEvent = {
  id: string;
  kind: "sleep" | "bright" | "wake" | "manual";
  startZoned: Temporal.ZonedDateTime;
  endZoned?: Temporal.ZonedDateTime;
  splitFrom?: string;  // ID of original event if this is a split
  splitPart?: "start" | "end";  // which part of the original event
  anchorId?: string;  // reference to persisted anchor (for wake events)
  // For wake events only:
  shiftFromPreviousWakeHours?: number;
  // For manual events only:
  title?: string;
  colorHint?: string;
  originalZone?: string;  // the zone the manual event was created in
};

// Step 6 output: Day bucket in display zone
export type DisplayDay = {
  date: Temporal.PlainDate;  // in display zone
  events: DisplayEvent[];  // all events on this day (including split)
};

export type ComputedView = {
  wakeSchedule: WakeScheduleEntry[];  // wake schedule with computed events
  displayDays: DisplayDay[];  // events bucketed by display zone day
  manualEvents: DisplayEvent[];  // manual events projected to display zone
  meta: {
    totalDeltaHours: number;
    direction: ShiftDirection;
    // perDayShifts: REMOVED
  };
};
```

### Key Improvements:

1. **Step 5 generates events, not just instants**: `ScheduleEvent` objects are created with `startInstant` and `endInstant`, eliminating the need to pass raw instants around.

2. **One anchor per wake**: `WakeScheduleEntry.anchor` is optional and singular, only present when the wake corresponds to a persisted `WakeAnchor`.

3. **Manual events separate**: `ComputedView.manualEvents` keeps user-created events distinct from auto-generated sleep/wake/bright events.

4. **Split tracking simplified**: `splitPart` is either `"start"` or `"end"`, not `"middle"`.

5. **Wake metadata on events**: `shiftFromPreviousWakeHours` lives on the wake `DisplayEvent` itself, not on the day bucket.

6. **Anchor references preserved**: `anchorId` on both `ScheduleEvent` and `DisplayEvent` maintains the link to persisted anchors throughout the pipeline.

7. **Display zone bucketing clean**: `DisplayDay` is purely organizational - just a date and events list, no computed metadata.

### Implementation Details:

- **ScheduleEvent IDs**: Derived from anchors: `${anchorId}-wake`, `${anchorId}-sleep`, `${anchorId}-bright`
- **Split event IDs**: `${originalId}-start` and `${originalId}-end`
- **Meta.direction**: REMOVED (no longer using shift strategy)
