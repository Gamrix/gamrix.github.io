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
        this.callback = callback;
      }
      private readonly callback: IntersectionObserverCallback;
      observe() {}
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

  it("toggles between calendar and schedule views", async () => {
    const user = userEvent.setup();
    render(<PlanEditor />);

    expect(screen.getByRole("button", { name: "Calendar" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Schedule" }));

    expect(screen.getByRole("button", { name: "Schedule" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("table", { name: /Derived daily sleep/i })).toBeInTheDocument();
  });

  it("opens the event dialog when an event is selected", async () => {
    const user = userEvent.setup();
    render(<PlanEditor />);

    const eventCards = await screen.findAllByRole("button", { name: /Flight to Taipei/i });
    await user.click(eventCards[0]);

    expect(await screen.findByText(/Edit event/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Edit event/i)).not.toBeInTheDocument();
  });

  it("opens the anchor dialog from the schedule table", async () => {
    const user = userEvent.setup();
    render(<PlanEditor />);

    const viewGroup = screen.getByRole("group", { name: /View mode/i });
    await user.click(within(viewGroup).getByRole("button", { name: "Schedule" }));

    const anchorButton = await screen.findByRole("button", { name: /Wake anchor/i });
    await user.click(anchorButton);

    expect(await screen.findByText(/Edit wake anchor/i)).toBeInTheDocument();
  });

  it("updates plan parameters and reflects in the view", async () => {
    const user = userEvent.setup();
    render(<PlanEditor />);

    const editButtons = screen.getAllByRole("button", { name: "Edit base parameters" });
    await user.click(editButtons[0]);

    const sleepInput = await screen.findByLabelText(/Sleep hours/i);
    await user.clear(sleepInput);
    await user.type(sleepInput, "7.5");
    await user.click(screen.getByRole("button", { name: /Apply changes/i }));

    const wakeSummary = await screen.findByText(/Kickoff sleep/i);
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

    const exportButtons = screen.getAllByRole("button", { name: /Export JSON/i });
    await user.click(exportButtons[0]);

    expect(writeText).toHaveBeenCalled();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
  });
});
