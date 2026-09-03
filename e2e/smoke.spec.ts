import { expect, test } from "@playwright/test";

import { chooseTheme } from "./support/theme";

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
  await chooseTheme(page, "Dark");

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
      page.getByRole("heading", { level: 1, name: /day, / }),
    ).toBeVisible();

    await chooseTheme(page, theme);

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
  await expect(
    page.getByText("America/Mexico_City", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Best-effort journal")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your day is ready to refresh" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Review repository access" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose what your journal can see" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Today" })).toBeVisible();
});

test("Today filters, groups, refreshes, and opens source evidence", async ({
  context,
  page,
}, testInfo) => {
  await context.addCookies([
    {
      name: "coding-journal-e2e-session",
      value: "all",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.route("https://github.com/**", async (route) => {
    await route.fulfill({ status: 200, body: "Evidence" });
  });

  await page.goto("/journal");
  await expect(
    page.getByText(/recorded events · .* categories with activity/),
  ).toBeVisible();
  await page.locator("summary", { hasText: "All 16 categories" }).click();
  const categories = page.getByRole("group", { name: "All 16 categories" });
  await expect(categories.getByText("Pushes", { exact: true })).toBeVisible();
  await expect(
    categories.getByText("Issue updates", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("today-light.png"),
    fullPage: true,
  });

  await chooseTheme(page, "Dark");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("today-dark.png"),
    fullPage: true,
  });

  await page
    .getByLabel("Activity filters: Activity type")
    .selectOption("issues");
  await expect(page.getByText("Opened issue #51")).toBeVisible();
  await expect(page.getByText("Push", { exact: true })).toHaveCount(0);
  await page.getByLabel("Activity filters: Activity type").selectOption("all");

  await page
    .getByLabel("Activity filters: Repository")
    .selectOption("acme/api");
  await page.getByRole("button", { name: "Group by repository" }).click();
  await expect(
    page.getByRole("heading", { name: "acme/api", level: 3 }),
  ).toBeVisible();
  await expect(page.getByText("Opened issue #51")).toHaveCount(0);

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "View push evidence" }).click();
  const evidence = await popupPromise;
  await expect(evidence).toHaveURL(
    "https://github.com/acme/api/compare/1111111...2222222",
  );

  await page.getByRole("button", { name: "Refresh Today" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Stored activity reloaded and GitHub reconciliation finished.",
    }),
  ).toHaveCount(1);
});

test("History browses finalized days and corrections without horizontal overflow", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "coding-journal-e2e-session",
      value: "all",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto("/journal/history");
  await expect(
    page.getByRole("heading", { name: "Journal history" }),
  ).toBeVisible();
  await expect(page.getByText("Corrected · 1 late event")).toBeVisible();
  await page.getByRole("link", { name: /Sunday, August 30/ }).click();
  await expect(
    page.getByRole("heading", { name: "Sunday, August 30" }),
  ).toBeVisible();
  await expect(page.getByText("Complete coverage")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Late corrections" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
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
  await expect(
    page.getByRole("button", { name: "Check existing installation" }),
  ).toBeVisible();
  await expect(page.getByText(/GitHub may show Configure/)).toBeVisible();

  await page
    .getByRole("button", { name: "Check existing installation" })
    .click();
  await expect(page).toHaveURL(/\/settings\?github=connected$/);
  await expect(page.getByText("GitHub App connected")).toBeVisible();
  await expect(page.getByText("Partial access", { exact: true })).toBeVisible();
  await expect(page.getByText("3 selected repositories")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Install GitHub App" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Manage on GitHub" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Today" }).click();
  await expect(page).toHaveURL("/journal");
  await expect(page.getByText("Partial access", { exact: true })).toBeVisible();
  await expect(page.getByText("3 selected repositories")).toBeVisible();
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
