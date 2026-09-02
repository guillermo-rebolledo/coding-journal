import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";
import { DeletedAccountNoticeView } from "@/components/deleted-account-notice";
import { ThemeProvider } from "@/components/theme-provider";

function renderHome() {
  render(
    <ThemeProvider storageKey={null}>
      <HomePage />
    </ThemeProvider>,
  );
}

describe("landing page", () => {
  it("lets a visitor read what access is used for before starting sign-in", () => {
    renderHome();

    expect(
      screen.getByRole("link", { name: "Start your journal" }),
    ).toHaveAttribute("href", "/sign-in");
    expect(
      screen.getByRole("link", { name: "what access is used for" }),
    ).toHaveAttribute("href", "/data-access");

    const footer = screen.getByRole("navigation", { name: "Trust pages" });
    for (const [name, href] of [
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Data access", "/data-access"],
    ] as const) {
      const link = within(footer).getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveClass("underline");
    }
  });

  it("keeps its claims to what the product actually does", () => {
    renderHome();

    // The record is honest about its own gaps, so the landing page must not
    // promise a complete or automatic one.
    expect(document.body.textContent).not.toMatch(
      /complete record|every( single)? commit|never miss|guarantee/i,
    );
    expect(document.body.textContent).toMatch(
      /Honest about what it can’t see|Honest about what it can't see/,
    );
  });
});

describe("deleted account notice", () => {
  it("confirms what was deleted and what the visitor still has to do on GitHub", () => {
    render(<DeletedAccountNoticeView account="deleted" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Your account is deleted");
    expect(status).toHaveTextContent(/GitHub App may still be installed/);
  });

  it("says nothing on an ordinary visit", () => {
    render(<DeletedAccountNoticeView account={null} />);

    expect(screen.queryByRole("status")).toBeNull();
  });
});
