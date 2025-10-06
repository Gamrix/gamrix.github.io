import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ZoneShiftDemo from "./ZoneShiftDemo";

describe("ZoneShiftDemo", () => {
  it("toggles viewing zone between target and home", async () => {
    const user = userEvent.setup();
    render(<ZoneShiftDemo />);

    expect(screen.getByText("Asia/Taipei")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Home Zone" }));

    expect(screen.getByText("America/Los_Angeles")).toBeInTheDocument();
  });

  it("allows updating anchor times via the editor", async () => {
    const user = userEvent.setup();
    render(<ZoneShiftDemo />);

    const editButtons = await screen.findAllByRole("button", { name: /Wake anchor/i });
    await user.click(editButtons[0]);

    const timeInput = await screen.findByLabelText(/Anchor time/i);
    await user.clear(timeInput);
    await user.type(timeInput, "08:15");

    await user.click(screen.getByRole("button", { name: /Save anchor/i }));

    expect(await screen.findByText(/Wake anchor @ 08:15/)).toBeInTheDocument();
  });
});
