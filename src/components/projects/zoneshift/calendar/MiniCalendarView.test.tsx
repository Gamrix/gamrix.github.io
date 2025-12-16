
import { render, screen, fireEvent, within } from "@testing-library/react";
import { vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MiniCalendarView } from "./MiniCalendarView";
import { Temporal } from "@js-temporal/polyfill";
import React from 'react';
import type { CorePlan, ComputedView, ScheduleEvent, DisplayEvent } from "@/scripts/projects/zoneshift/model";

// --- Mock Data Helpers ---

const mockZone = "America/Los_Angeles";

const createMockPlan = (events: any[] = []): CorePlan => ({
    id: "test-plan",
    version: 1,
    params: {
        startTimeZone: mockZone,
        endTimeZone: mockZone,
        startSleepUtc: "2024-01-01T08:00:00Z",
        endWakeUtc: "2024-01-02T08:00:00Z",
        sleepHours: 8,
        maxShiftLaterPerDayHours: 1,
        maxShiftEarlierPerDayHours: 1
    },
    anchors: [],
    events: events,
    prefs: {}
});

const createMockComputed = (wakeSchedule: any[], displayDays: any[] = []): ComputedView => ({
    wakeSchedule,
    displayDays,
    manualEvents: [],
    meta: { totalDeltaHours: 0 }
});

// Helper to create a DisplayEvent
const createDisplayEvent = (id: string, start: string, end: string, kind: "bright" | "sleep" | "wake" = "bright"): DisplayEvent => ({
    id,
    kind,
    startZoned: Temporal.ZonedDateTime.from(start),
    endZoned: Temporal.ZonedDateTime.from(end),
});

// Helper to create a ScheduleEvent (simplified)
const createScheduleEvent = (id: string, start: string, end?: string): ScheduleEvent => ({
    id,
    kind: id.includes("wake") ? "wake" : id.includes("sleep") ? "sleep" : "bright",
    startInstant: Temporal.Instant.from(start),
    endInstant: end ? Temporal.Instant.from(end) : undefined,
});

describe("MiniCalendarView - Complex Cases", () => {

    it("Test Case 4: Midnight-Crossing 'Ghost' Events", async () => {
        // START: 2024-01-01T22:00:00 [America/Los_Angeles]
        // END:   2024-01-02T02:00:00 [America/Los_Angeles]
        // This period spans across midnight local time.

        // We construct a ComputedView where the 'bright' period matches this.
        // NOTE: 'bright' segment rendering logic uses wakeEvent.startZoned as start, and brightEvent.endZoned as end.

        const startIso = "2024-01-01T22:00:00-08:00[America/Los_Angeles]";
        const endIso = "2024-01-02T02:00:00-08:00[America/Los_Angeles]";

        // We need corresponding ScheduleEntry and DisplayEvents
        const wakeEvent = createScheduleEvent("wake-1", "2024-01-02T06:00:00Z"); // 22:00 PST
        const brightEvent = createScheduleEvent("bright-1", "2024-01-02T06:00:00Z", "2024-01-02T10:00:00Z"); // 22:00 - 02:00 PST
        const sleepEvent = createScheduleEvent("sleep-1", "2024-01-01T22:00:00Z"); // Just placeholder logic

        // The component looks up events in displayDays to get ZonedDateTimes
        const displayEvents = [
            createDisplayEvent("wake-1", startIso, startIso, "wake"),
            // The bright event implies split in standard computation, but here we provide what the component might find
            // Component logic: allEvents.find(e => e.id === entry.brightEvent.id || ...)
            // If we provide the full range event here:
            createDisplayEvent("bright-1", startIso, endIso, "bright"),
            createDisplayEvent("sleep-1", "2024-01-01T14:00:00-08:00[America/Los_Angeles]", startIso, "sleep")
        ];

        const displayDay1 = {
            date: Temporal.PlainDate.from("2024-01-01"),
            events: displayEvents
        };

        // We also need a second day to check if it rendered there?
        // Usually a schedule entry corresponds to one day. Since we only have one entry, we only get one column.
        // If we want to test "Day N+1 shows...", we'd need a second schedule entry for Day N+1.
        // But let's verify visual state of Day N first.

        const computed = createMockComputed(
            [{
                wakeEvent,
                sleepEvent,
                brightEvent,
                shiftFromPreviousWakeHours: 0
            }],
            [displayDay1]
        );

        render(
            <MiniCalendarView
                plan={createMockPlan()}
                computed={computed}
                displayZoneId={mockZone}
            />
        );

        // Find the column for Jan 1
        const dayColumn = screen.getByText("Jan 1").closest(".relative");
        expect(dayColumn).toBeInTheDocument();

        // Inspect the "bright" segments (bg-yellow-300)
        // We have to use querySelector because they are divs without aria roles
        const segs = dayColumn?.querySelectorAll(".bg-yellow-300");
        const segments = Array.from(segs || []);

        // Helper to parse 'top' style
        const getTopPercent = (el: Element) => parseFloat((el as HTMLElement).style.top || "0");
        const getHeightPercent = (el: Element) => parseFloat((el as HTMLElement).style.height || "0");

        // EXPECTED (Visual Bug):
        // Segment 1: Bottom (22:00 to 24:00) -> Top ~91.6%, Height ~8.3%
        // Segment 2: Top (00:00 to 02:00) -> Top 0%, Height ~8.3%
        // The bug is that Segment 2 shouldn't be here on Jan 1st! (It's Jan 2nd data)

        const segmentAtTop = segments.find(el => getTopPercent(el) < 5);
        const segmentAtBottom = segments.find(el => getTopPercent(el) > 90);

        // Assertion 1: Should have segment at bottom (Correct)
        expect(segmentAtBottom).toBeDefined();
        if (segmentAtBottom) {
            expect(getTopPercent(segmentAtBottom)).toBeCloseTo(91.6, 0); // 22/24 * 100
        }

        // Assertion 2: "Day N shows a segment from 00:00-02:00" - Detecting the Bug
        // We assert that it DOES NOT exist now (Fix verification)
        expect(segmentAtTop).toBeUndefined();
    });

    it("Test Case 5: Composer 'Next Day' Heuristic", async () => {
        const user = userEvent.setup();
        const handleAddEvent = vi.fn();

        // Mock getBoundingClientRect
        const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = vi.fn(() => ({
            width: 100,
            height: 1000,
            top: 0,
            left: 0,
            bottom: 1000,
            right: 100,
            x: 0,
            y: 0,
            toJSON: () => { }
        }));

        try {
            // Basic setup to render the grid
            const startIso = "2024-01-31T08:00:00-08:00[America/Los_Angeles]";
            const wakeEvent = createScheduleEvent("wake-1", "2024-01-31T16:00:00Z"); // 08:00 PST
            const sleepEvent = createScheduleEvent("sleep-1", "2024-01-31T08:00:00Z"); // 00:00 PST
            const brightEvent = createScheduleEvent("bright-1", "2024-01-31T21:00:00Z"); // 13:00 PST

            const displayEvents = [
                createDisplayEvent("wake-1", startIso, startIso, "wake"),
                createDisplayEvent("sleep-1", "2024-01-31T00:00:00-08:00[America/Los_Angeles]", startIso, "sleep"),
                createDisplayEvent("bright-1", startIso, "2024-01-31T13:00:00-08:00[America/Los_Angeles]", "bright")
            ];

            const computed = createMockComputed(
                [{
                    wakeEvent,
                    sleepEvent,
                    brightEvent,
                    shiftFromPreviousWakeHours: 0
                }],
                [{
                    date: Temporal.PlainDate.from("2024-01-31"),
                    events: displayEvents
                }]
            );

            render(
                <MiniCalendarView
                    plan={createMockPlan()}
                    computed={computed}
                    displayZoneId={mockZone}
                    onAddEvent={handleAddEvent}
                />
            );

            // 1. Open Composer by clicking on the column
            const dayColumn = screen.getByText("Jan 31").closest(".relative");
            // Click somewhere in the middle
            await user.click(dayColumn!.querySelector(".touch-pan-x")!);

            // 2. Composer should appear
            const composer = await screen.findByText("Add event");
            expect(composer).toBeInTheDocument();

            // 3. Set Start: "23:00"
            const startInput = screen.getByLabelText("Starts");
            await user.clear(startInput);
            await user.type(startInput, "23:00");

            // 4. Set End: "01:00" (implies next day)
            const endInput = screen.getByLabelText("Ends");
            await user.clear(endInput);
            await user.type(endInput, "01:00");

            // 5. Submit
            await user.click(screen.getByRole("button", { name: "Save event" }));

            // 6. Verify result
            expect(handleAddEvent).toHaveBeenCalledTimes(1);
            const payload = handleAddEvent.mock.calls[0][0];

            // Start: 2024-01-31 T 23:00
            // End:   2024-02-01 T 01:00
            // Verify date rollover
            expect(payload.start.toString()).toContain("2024-01-31T23:00");
            expect(payload.end.toString()).toContain("2024-02-01T01:00");
        } finally {
            Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
        }
    });

});
