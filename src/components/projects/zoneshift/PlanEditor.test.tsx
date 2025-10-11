import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PlanEditor } from "./PlanEditor";
import { planActions } from "./planStore";

const resetPlanState = () => {
  window.localStorage.clear();
  planActions.resetToSample();
};

describe("PlanEditor", () => {
  beforeAll(() => {
    class MockIntersectionObserver implements IntersectionObserver {
      readonly root: Element | null = null;
      readonly rootMargin = "0px";
      readonly thresholds = [];
      constructor(callback: IntersectionObserverCallback) {
        this._callback = callback;
      }
      private readonly _callback: IntersectionObserverCallback;
      observe(_target: Element) {
        this._callback([], this);
      }
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: MockIntersectionObserver,
    });
  });

  beforeEach(() => {
    resetPlanState();
  });

  it("toggles between list and table views", async () => {
    const user = userEvent.setup();
    render(<PlanEditor />);

    expect(screen.getByRole("button", { name: "List View" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await user.click(screen.getByRole("button", { name: "Table View" }));

    expect(screen.getByRole("button", { name: "Table View" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      await screen.findByRole("table", { name: /Derived daily sleep/i })
    ).toBeInTheDocument();
  });

  it("activates the calendar timeline view", async () => {
    const user = userEvent.setup();
    render(<PlanEditor />);

    const calendarButtons = screen.getAllByRole("button", {
      name: "Calendar View",
    });
    await user.click(calendarButtons[0]);

    expect(calendarButtons[0]).toHaveAttribute("aria-pressed", "true");
    const timelineDays = await screen.findAllByTestId(/timeline-day-/i);
    expect(timelineDays.length).toBeGreaterThan(0);
  });

  it("displays the mini calendar view", async () => {
    const user = userEvent.setup();
    render(<PlanEditor />);

    const miniButtons = screen.getAllByRole("button", { name: "Mini View" });
    await user.click(miniButtons[0]);

    expect(miniButtons[0]).toHaveAttribute("aria-pressed", "true");
    const miniHeadings = await screen.findAllByText(/Mini calendar/i);
    expect(miniHeadings.length).toBeGreaterThan(0);
  });

  it("opens the event dialog when an event is selected", async () => {
    const user = userEvent.setup();
    render(<PlanEditor />);

    const eventCards = await screen.findAllByRole("button", {
      name: /Flight to Taipei/i,
    });
    await user.click(eventCards[0]);

    const eventHeadings = await screen.findAllByText(/Edit event/i);
    expect(eventHeadings.length).toBeGreaterThan(0);

    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    await user.click(cancelButtons[cancelButtons.length - 1]);
    expect(screen.queryByText(/Edit event/i)).not.toBeInTheDocument();
  });

  it("opens the wake time dialog from the schedule table", async () => {
    const user = userEvent.setup();
    render(<PlanEditor />);

    const viewGroups = screen.getAllByRole("group", { name: /View mode/i });
    const viewGroup = viewGroups[0];
    await user.click(
      within(viewGroup).getByRole("button", { name: "Table View" })
    );

    const anchorButtons = await screen.findAllByRole("button", {
      name: /Wake time/i,
    });
    await user.click(anchorButtons[0]);

    const wakeTimeHeadings = await screen.findAllByText(/Edit Wake Time/i);
    expect(wakeTimeHeadings.length).toBeGreaterThan(0);
  });

  it("updates plan parameters and reflects in the view", async () => {
    const user = userEvent.setup();
    render(<PlanEditor />);

    const editButtons = screen.getAllByRole("button", {
      name: "Edit base parameters",
    });
    await user.click(editButtons[0]);

    const sleepInput = await screen.findByLabelText(/Sleep hours/i);
    await user.clear(sleepInput);
    await user.type(sleepInput, "7.5");
    await user.click(screen.getByRole("button", { name: /Apply changes/i }));

    const wakeSummary = (await screen.findAllByText(/Kickoff sleep/i))[0];
    const valueNode = wakeSummary.parentElement?.querySelector("dd");
    expect(valueNode?.textContent).toContain("@ 16:30");
  });

  it("exports plan JSON to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<PlanEditor />);

    const exportButtons = screen.getAllByRole("button", {
      name: /Export JSON/i,
    });
    await user.click(exportButtons[0]);

    expect(writeText).toHaveBeenCalled();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
  });
});
