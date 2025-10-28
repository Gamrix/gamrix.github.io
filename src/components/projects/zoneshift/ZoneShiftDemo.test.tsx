import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ZoneShiftDemo from "./ZoneShiftDemo";
import { sampleCorePlan } from "@/scripts/projects/zoneshift/samplePlan";

describe("ZoneShiftDemo", () => {
  it("toggles viewing zone between target and home", async () => {
    const user = userEvent.setup();
    render(<ZoneShiftDemo />);

    // Wait for component to render and verify default timezone is displayed
    const endZoneButton = await screen.findByRole("button", { name: sampleCorePlan.params.endTimeZone });
    expect(endZoneButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "List View" })).toHaveAttribute("aria-pressed", "true");

    // Click to switch to home timezone
    const startZoneButton = screen.getByRole("button", { name: sampleCorePlan.params.startTimeZone });
    await user.click(startZoneButton);

    // Verify the home timezone button is now pressed
    expect(startZoneButton).toHaveAttribute("aria-pressed", "true");
  });

  it("allows updating wake times via the editor", async () => {
    const user = userEvent.setup();
    render(<ZoneShiftDemo />);

    const tableButtons = screen.getAllByRole("button", { name: "Table View" });
    await user.click(tableButtons[0]);

    const editButtons = await screen.findAllByRole("button", { name: /Wake time/i });
    const firstEnabledButton = editButtons.find((button) => !button.hasAttribute("disabled"));
    expect(firstEnabledButton).toBeDefined();
    await user.click(firstEnabledButton!);

    const timeInput = await screen.findByLabelText(/Local time/i);
    await user.clear(timeInput);
    await user.type(timeInput, "08:15");

    await user.click(screen.getByRole("button", { name: /Save wake time/i }));

    const updatedWakeButtons = await screen.findAllByRole("button", {
      name: /Wake time/i,
    });
    await user.click(updatedWakeButtons[0]);

    const updatedTimeInput = await screen.findByLabelText(/Local time/i);
    expect(updatedTimeInput).toHaveValue("08:15");

    const cancelButtons = screen.getAllByRole("button", { name: /Cancel/i });
    await user.click(cancelButtons[cancelButtons.length - 1]);
  });

  it("reveals the mini calendar view", async () => {
    const user = userEvent.setup();
    render(<ZoneShiftDemo />);

    const miniButtons = screen.getAllByRole("button", { name: "Mini View" });
    await user.click(miniButtons[0]);

    const miniHeadings = await screen.findAllByText(/Mini calendar/i);
    expect(miniHeadings.length).toBeGreaterThan(0);
  });
});
