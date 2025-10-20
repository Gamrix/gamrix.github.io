import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      />
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
      />
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
        onAddEvent={vi.fn()}
        onAddAnchor={vi.fn()}
        onAnchorChange={vi.fn()}
      />
    );

    await user.click(
      screen.getByRole("button", { name: /Overnight Session/i })
    );

    expect(screen.getAllByText(/\(\+1 day\)/i).length).toBeGreaterThan(0);
  });

  it("opens the event composer when clicking an empty slot", async () => {
    render(
      <MiniCalendarView
        computed={computedPlan}
        displayZoneId={boundaryPlan.params.targetZone}
        onEditEvent={vi.fn()}
        onAddEvent={vi.fn()}
        onAddAnchor={vi.fn()}
        onAnchorChange={vi.fn()}
      />
    );

    const interactiveAreas = Array.from(
      document.querySelectorAll("div.relative.flex-1.w-full.overflow-visible"),
    ) as HTMLDivElement[];

    expect(interactiveAreas.length).toBeGreaterThan(0);

    const target = interactiveAreas[0];

    target.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        width: 100,
        height: 200,
        right: 100,
        bottom: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.pointerDown(target, {
      pointerId: 1,
      pointerType: "mouse",
      clientY: 100,
    });

    expect(await screen.findByText(/Add event/i)).toBeInTheDocument();
  });

  it("shows hover affordance and opens composer when clicking the hover control", async () => {
    const user = userEvent.setup();

    render(
      <MiniCalendarView
        computed={computedPlan}
        displayZoneId={boundaryPlan.params.targetZone}
        onEditEvent={vi.fn()}
        onAddEvent={vi.fn()}
        onAddAnchor={vi.fn()}
        onAnchorChange={vi.fn()}
      />
    );

    const interactiveAreas = Array.from(
      document.querySelectorAll("div.relative.flex-1.w-full.overflow-visible"),
    ) as HTMLDivElement[];

    expect(interactiveAreas.length).toBeGreaterThan(0);

    const target = interactiveAreas[0];
    target.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        width: 100,
        height: 200,
        right: 100,
        bottom: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.pointerMove(target, {
      pointerId: 1,
      pointerType: "mouse",
      clientY: 80,
    });

    const hoverButton = await screen.findByLabelText(/Add event on/i);
    await user.click(hoverButton);

    expect(await screen.findByText(/Add event/i)).toBeInTheDocument();
  });

  it("allows dragging events with touch pointers", async () => {
    const onEventChange = vi.fn();

    render(
      <MiniCalendarView
        computed={computedPlan}
        displayZoneId={boundaryPlan.params.targetZone}
        onEditEvent={vi.fn()}
        onAddEvent={vi.fn()}
        onAddAnchor={vi.fn()}
        onAnchorChange={vi.fn()}
        onEventChange={onEventChange}
      />
    );

    const dayColumns = Array.from(
      document.querySelectorAll("div.relative.h-full.flex-shrink-0")
    ) as HTMLDivElement[];

    dayColumns.forEach((column, index) => {
      column.getBoundingClientRect = () =>
        ({
          top: 0,
          left: index * 120,
          width: 100,
          height: 200,
          right: index * 120 + 100,
          bottom: 200,
          x: index * 120,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    });

    const eventButton = screen.getByRole("button", {
      name: /Overnight Session/i,
    }) as HTMLButtonElement;

    eventButton.getBoundingClientRect = () =>
      ({
        top: 40,
        left: 40,
        width: 24,
        height: 24,
        right: 64,
        bottom: 64,
        x: 40,
        y: 40,
        toJSON: () => ({}),
      }) as DOMRect;

    await act(async () => {
      fireEvent.pointerDown(eventButton, {
        pointerId: 5,
        pointerType: "touch",
        clientX: 52,
        clientY: 52,
      });
    });

    await waitFor(() =>
      expect(eventButton.className).toMatch(/cursor-grabbing/)
    );

    await act(async () => {
      fireEvent.pointerMove(eventButton, {
        pointerId: 5,
        pointerType: "touch",
        clientX: 52,
        clientY: 140,
      });
    });

    await act(async () => {
      fireEvent.pointerUp(eventButton, {
        pointerId: 5,
        pointerType: "touch",
        clientX: 52,
        clientY: 140,
      });
    });

    await waitFor(() =>
      expect(eventButton.className).toMatch(/cursor-grab/)
    );
  });

  it("opens the composer when tapping an empty slot with touch", async () => {
    render(
      <MiniCalendarView
        computed={computedPlan}
        displayZoneId={boundaryPlan.params.targetZone}
        onEditEvent={vi.fn()}
        onAddEvent={vi.fn()}
        onAddAnchor={vi.fn()}
        onAnchorChange={vi.fn()}
      />
    );

    const interactiveAreas = Array.from(
      document.querySelectorAll("div.relative.flex-1.w-full.overflow-visible")
    ) as HTMLDivElement[];

    expect(interactiveAreas.length).toBeGreaterThan(0);

    const target = interactiveAreas[0];

    target.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        width: 100,
        height: 200,
        right: 100,
        bottom: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.pointerDown(target, {
      pointerId: 7,
      pointerType: "touch",
      clientY: 90,
    });

    expect(await screen.findByText(/Add event/i)).toBeInTheDocument();
  });

  it("marks touch-interactive elements with explicit touch-action rules", () => {
    render(
      <MiniCalendarView
        computed={computedPlan}
        displayZoneId={boundaryPlan.params.targetZone}
        onEditEvent={vi.fn()}
        onAddEvent={vi.fn()}
        onAddAnchor={vi.fn()}
        onAnchorChange={vi.fn()}
      />
    );

    const eventButton = screen.getByRole("button", {
      name: /Overnight Session/i,
    });

    expect(eventButton.className).toMatch(/touch-none/);

    const interactiveArea = document.querySelector(
      "div.relative.flex-1.w-full.overflow-visible"
    );

    expect(interactiveArea).not.toBeNull();
    expect((interactiveArea as HTMLElement).className).toMatch(/touch-pan-x/);
  });
});
