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
      page.getByRole("heading", { name: "Welcome, Ada." }),
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
