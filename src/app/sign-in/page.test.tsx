import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SignInPage from "@/app/sign-in/page";
import { ThemeProvider } from "@/components/theme-provider";

describe("sign-in page", () => {
  it("makes a cancelled GitHub journey understandable and recoverable", async () => {
    render(
      <ThemeProvider storageKey={null}>
        {await SignInPage({
          searchParams: Promise.resolve({ error: "access_denied" }),
        })}
      </ThemeProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "sign-in was cancelled",
    );
    expect(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    ).toBeEnabled();
  });

  it("explains a missing GitHub profile", async () => {
    render(
      <ThemeProvider storageKey={null}>
        {await SignInPage({
          searchParams: Promise.resolve({ error: "email_not_found" }),
        })}
      </ThemeProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "did not provide a usable profile",
    );
  });
});
