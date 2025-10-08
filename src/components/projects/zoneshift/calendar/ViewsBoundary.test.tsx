import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import CalendarView from "./CalendarView";
import { CalendarListView } from "./CalendarListView";
import { MiniCalendarView } from "./MiniCalendarView";
import { computePlan, type CorePlan } from "@/scripts/projects/zoneshift/model";
import { sampleCorePlan } from "@/scripts/projects/zoneshift/samplePlan";

const boundaryPlan: CorePlan = {
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

const computedPlan = computePlan(boundaryPlan);

describe("Zoneshift day-boundary handling", () => {
  it("Calendar list view annotates cross-day ranges", () => {
    render(
      <CalendarListView
        plan={boundaryPlan}
        computed={computedPlan}
        displayZoneId={boundaryPlan.params.targetZone}
        onEditAnchor={vi.fn()}
        onEditEvent={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/\(\+1 day\)/i).length).toBeGreaterThan(0);
  });

  it("Calendar timeline view exposes cross-day event labels", () => {
    render(
      <CalendarView
        plan={boundaryPlan}
        computed={computedPlan}
        displayZoneId={boundaryPlan.params.targetZone}
        onEditAnchor={vi.fn()}
        onEditEvent={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/\(\+1 day\)/i).length).toBeGreaterThan(0);
  });

  it("Mini calendar view includes cross-day descriptors", async () => {
    const user = userEvent.setup();

    render(
      <MiniCalendarView
        computed={computedPlan}
        displayZoneId={boundaryPlan.params.targetZone}
        onEditEvent={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Overnight Session/i }));

    expect(screen.getAllByText(/\(\+1 day\)/i).length).toBeGreaterThan(0);
  });
});
