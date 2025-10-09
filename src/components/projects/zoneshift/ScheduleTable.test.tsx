import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { ScheduleTable } from "./ScheduleTable";
import { computePlan, type CorePlan } from "@/scripts/projects/zoneshift/model";
import { sampleCorePlan } from "@/scripts/projects/zoneshift/samplePlan";

const overnightPlan: CorePlan = {
  ...sampleCorePlan,
  params: {
    ...sampleCorePlan.params,
    homeZone: "UTC",
    targetZone: "UTC",
    startSleepUtc: "2024-01-01T22:00:00Z",
  },
  anchors: [],
  events: [
    {
      id: "overnight-session",
      title: "Overnight Session",
      start: "2024-01-02T23:30:00Z",
      end: "2024-01-03T02:00:00Z",
      zone: "UTC",
      colorHint: "blue",
    },
  ],
  prefs: {
    ...sampleCorePlan.prefs,
    displayZone: "target",
  },
};

describe("ScheduleTable", () => {
  it("renders one row per computed day", () => {
    const computed = computePlan(sampleCorePlan);
    render(
      <ScheduleTable
        computed={computed}
        displayZoneId={sampleCorePlan.params.targetZone}
      />
    );

    const table = screen.getByRole("table", {
      name: /Derived daily sleep, wake, and bright-light guidance/i,
    });

    const rows = table.querySelectorAll("tbody tr");
    expect(rows.length).toBe(computed.days.length);
    expect(table).toHaveTextContent("Sleep Start");
    expect(table).toHaveTextContent(computed.days[0]?.sleepStartLocal ?? "");
  });

  it("shows an empty-state message when no days are present", () => {
    render(
      <ScheduleTable
        computed={{
          days: [],
          projectedAnchors: [],
          projectedEvents: [],
          meta: { totalDeltaHours: 0, direction: "later", perDayShifts: [] },
        }}
        displayZoneId={sampleCorePlan.params.targetZone}
      />
    );

    expect(
      screen.getByText(
        /Schedule data becomes available once you provide core plan details./i
      )
    ).toBeInTheDocument();
  });

  it("calls the edit handler when an editable wake time is present", async () => {
    const computed = computePlan(sampleCorePlan);
    const handleEdit = vi.fn();
    const user = userEvent.setup();

    render(
      <ScheduleTable
        computed={computed}
        displayZoneId={sampleCorePlan.params.targetZone}
        onEditAnchor={handleEdit}
      />
    );

    const anchorButtons = await screen.findAllByRole("button", {
      name: /Wake time/i,
    });
    await user.click(anchorButtons[0]);

    await waitFor(() => expect(handleEdit).toHaveBeenCalledTimes(1));
  });

  it("annotates cross-day sleep and bright windows", () => {
    const computed = computePlan(overnightPlan);

    render(
      <ScheduleTable
        computed={computed}
        displayZoneId={overnightPlan.params.targetZone}
      />
    );

    expect(screen.getByText(/Sleep End/i).closest("table")).toHaveTextContent(
      "(+1 day)"
    );
    expect(
      screen.getByText(/Bright Window/i).closest("table")
    ).toHaveTextContent("(+1 day)");
  });
});
