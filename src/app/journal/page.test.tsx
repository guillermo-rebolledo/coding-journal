import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authBoundary = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getJournalSession: authBoundary.getSession,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: authBoundary.signOut },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/navigation", () => ({
  redirect: navigation.redirect,
  useRouter: () => ({
    replace: navigation.replace,
    refresh: navigation.refresh,
  }),
}));

import JournalPage from "@/app/journal/page";
import { ThemeProvider } from "@/components/theme-provider";

describe("protected journal boundary", () => {
  beforeEach(() => {
    authBoundary.getSession.mockReset();
    authBoundary.signOut.mockReset();
    navigation.replace.mockReset();
    navigation.refresh.mockReset();
  });

  it("renders the application shell after successful authentication", async () => {
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Welcome, Ada." }),
    ).toBeInTheDocument();
    expect(screen.queryByText("server-only-token")).not.toBeInTheDocument();

    authBoundary.signOut.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(authBoundary.signOut).toHaveBeenCalledOnce());
    expect(navigation.replace).toHaveBeenCalledWith("/");
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("redirects a signed-out visitor to the recoverable sign-in route", async () => {
    authBoundary.getSession.mockResolvedValue(null);

    await expect(JournalPage()).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?next=%2Fjournal",
    );
  });
});
