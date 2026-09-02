import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";

describe("button busy state", () => {
  it("stays focusable and named while blocking pointer and keyboard activation", () => {
    const activate = vi.fn();
    render(
      <Button loading onClick={activate}>
        Refresh Today
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Refresh Today" });
    button.focus();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });
    expect(activate).not.toHaveBeenCalled();
  });
});
