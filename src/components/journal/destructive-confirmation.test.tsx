import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DestructiveConfirmation } from "@/components/journal/destructive-confirmation";

describe("destructive confirmation", () => {
  it("blocks account deletion until the exact literal matches", async () => {
    const action = vi
      .fn<(formData: FormData) => Promise<undefined>>()
      .mockResolvedValue(undefined);

    render(
      <DestructiveConfirmation
        action={action}
        literal="DELETE"
        fieldLabel="Type DELETE to confirm"
        submitLabel="Delete my account"
        description="This removes the account and its journal."
        initiallyOpen
      />,
    );

    const field = screen.getByRole("textbox", {
      name: "Type DELETE to confirm",
    });
    fireEvent.change(field, { target: { value: "delete" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));

    expect(action).not.toHaveBeenCalled();
    expect(field).toHaveAccessibleDescription(
      "This removes the account and its journal. Type DELETE exactly as shown to continue.",
    );

    fireEvent.change(field, { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0]?.[0].get("confirmation")).toBe("DELETE");
  });

  it("reveals redaction at the field and dismissal returns it to rest", async () => {
    render(
      <DestructiveConfirmation
        action={vi.fn(async () => undefined)}
        literal="REDACT"
        fieldLabel="Type REDACT to confirm"
        submitLabel="Redact narrative"
        triggerLabel="Redact narrative"
        cancelLabel="Keep narrative"
        description="This removes the narrative. Recorded facts and metrics remain."
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Redact narrative" }));

    const field = screen.getByRole("textbox", {
      name: "Type REDACT to confirm",
    });
    expect(field).toHaveFocus();
    expect(screen.getByText(/Recorded facts and metrics remain/)).toBeVisible();

    fireEvent.change(field, { target: { value: "REDACT" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep narrative" }));

    expect(
      screen.queryByRole("textbox", { name: "Type REDACT to confirm" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Redact narrative" }),
      ).toHaveFocus(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Redact narrative" }));
    expect(
      screen.getByRole("textbox", { name: "Type REDACT to confirm" }),
    ).toHaveValue("");
  });
});
