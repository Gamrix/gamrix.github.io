import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { ScheduleTable } from "./ScheduleTable";
import { computePlan } from "@/scripts/projects/zoneshift/model";
import { sampleCorePlan } from "@/scripts/projects/zoneshift/samplePlan";

describe("ScheduleTable", () => {
  it("renders one row per computed day", () => {
    const computed = computePlan(sampleCorePlan);
    render(
      <ScheduleTable
        computed={computed}
        displayZoneId={sampleCorePlan.params.targetZone}
      />,
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
      />,
    );

    expect(
      screen.getByText(/Schedule data becomes available once you provide core plan details./i),
    ).toBeInTheDocument();
  });

  it("calls the edit handler when an editable anchor is present", async () => {
    const computed = computePlan(sampleCorePlan);
    const handleEdit = vi.fn();
    const user = userEvent.setup();

    render(
      <ScheduleTable
        computed={computed}
        displayZoneId={sampleCorePlan.params.targetZone}
        onEditAnchor={handleEdit}
      />,
    );

    const editButton = await screen.findByRole("button", { name: /Edit anchor/i });
    await user.click(editButton);

    expect(handleEdit).toHaveBeenCalledTimes(1);
  });
});
