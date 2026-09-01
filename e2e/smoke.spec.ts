import { expect, test } from "@playwright/test";

test("visitor can understand the product and reach GitHub sign-in", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Your GitHub day, distilled." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Start your journal" }).click();
  await expect(
    page.getByRole("heading", { name: "Pick up the thread of your day." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with GitHub" }),
  ).toBeVisible();
});

test("visitor can persistently override the system theme", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Choose color theme" }).click();
  await page.getByRole("menuitem", { name: "Dark" }).click();

  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

for (const theme of ["Light", "Dark"] as const) {
  test(`signed-in user can sign out in the ${theme.toLowerCase()} theme`, async ({
    context,
    page,
  }) => {
    await context.addCookies([
      {
        name: "coding-journal-e2e-session",
        value: "valid",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/journal");
    await expect(
      page.getByRole("heading", { name: "Today, Monday, August 31" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Choose color theme" }).click();
    await page.getByRole("menuitem", { name: theme }).click();

    await page.route("**/api/auth/sign-out", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "set-cookie":
            "coding-journal-e2e-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
        },
        body: JSON.stringify({ success: true }),
      });
    });

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/");

    await page.goto("/journal");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fjournal$/);
  });
}

test("best-effort Today keeps its completeness and next action clear on a phone", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await context.addCookies([
    {
      name: "coding-journal-e2e-session",
      value: "valid",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto("/journal");
  await expect(page.getByText("America/Mexico_City")).toBeVisible();
  await expect(page.getByText("Best-effort journal")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your day is ready to take shape" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Review repository access" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose what your journal can see" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Today" })).toBeVisible();
});

test("Settings keeps GitHub access guidance within the viewport", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "coding-journal-e2e-session",
      value: "valid",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "GitHub access" }),
  ).toBeVisible();
  await expect(page.getByText("Skipped", { exact: true })).toBeVisible();
  await expect(page.getByText("Preview source")).toBeVisible();
  await expect(page.getByText("Reconciliation only")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Install GitHub App" }),
  ).toHaveAttribute("href", "/api/github/install?from=settings");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});

for (const connection of [
  {
    session: "all",
    label: "Installed",
    manageUrl: "https://github.com/settings/installations/10",
  },
  {
    session: "partial",
    label: "Partial access",
    manageUrl:
      "https://github.com/organizations/example-org/settings/installations/42",
  },
  { session: "pending", label: "Pending approval", manageUrl: null },
  {
    session: "disconnected",
    label: "Disconnected",
    manageUrl:
      "https://github.com/organizations/old-org/settings/installations/11",
  },
] as const) {
  test(`Settings shows ${connection.label.toLowerCase()} GitHub coverage`, async ({
    context,
    page,
  }) => {
    await context.addCookies([
      {
        name: "coding-journal-e2e-session",
        value: connection.session,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/settings");
    await expect(
      page.getByText(connection.label, { exact: true }),
    ).toBeVisible();

    if (connection.manageUrl) {
      await expect(
        page.getByRole("link", { name: "Manage on GitHub" }),
      ).toHaveAttribute("href", connection.manageUrl);
      await expect(
        page.getByRole("link", {
          name:
            connection.session === "disconnected"
              ? "Install GitHub App"
              : "Add another installation",
        }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("link", { name: "Manage on GitHub" }),
      ).toHaveCount(0);
    }
  });
}
