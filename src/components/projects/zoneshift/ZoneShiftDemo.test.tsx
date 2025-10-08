import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ZoneShiftDemo from "./ZoneShiftDemo";

describe("ZoneShiftDemo", () => {
  it("toggles viewing zone between target and home", async () => {
    const user = userEvent.setup();
    render(<ZoneShiftDemo />);

    expect(screen.getByText(/Asia\/Taipei/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List View" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Home Zone" }));

    expect(screen.getByText("America/Los_Angeles")).toBeInTheDocument();
  });

  it("allows updating wake times via the editor", async () => {
    const user = userEvent.setup();
    render(<ZoneShiftDemo />);

    const tableButtons = screen.getAllByRole("button", { name: "Table View" });
    await user.click(tableButtons[0]);

    const editButtons = await screen.findAllByRole("button", { name: /Wake time/i });
    await user.click(editButtons[0]);

    const timeInput = await screen.findByLabelText(/Local time/i);
    await user.clear(timeInput);
    await user.type(timeInput, "08:15");

    await user.click(screen.getByRole("button", { name: /Save wake time/i }));

    const updatedWakeButtons = await screen.findAllByRole("button", { name: /Wake time/i });
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

    expect(await screen.findByText(/Mini calendar/i)).toBeInTheDocument();
  });
});
