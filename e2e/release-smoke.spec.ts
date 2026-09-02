import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

/**
 * The release gate's end-to-end proof — issue #17.
 *
 * One test walks the whole product in the order a new person meets it:
 * landing, the trust pages that must be readable before authorizing, sign-in,
 * time-zone onboarding, the optional installation and its skip, Today with a
 * reconciliation and a degraded narrative, History, Settings, and deletion.
 * It is deliberately one long journey rather than nine independent tests,
 * because what the gate needs proven is that the journey holds together.
 *
 * See `docs/release-gate.md` for how to run it against a real deployment.
 */
test("a new person can go from the landing page to a deleted account", async ({
  context,
  page,
}) => {
  await test.step("landing states what it is and links the trust pages", async () => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Your GitHub day, distilled." }),
    ).toBeVisible();

    await page
      .getByRole("link", { name: "what access is used for" })
      .first()
      .click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Data access and GitHub permissions",
      }),
    ).toBeVisible();
  });

  await test.step("every trust page is reachable before authorizing", async () => {
    const trustNav = page.getByRole("navigation", { name: "Trust pages" });
    await trustNav.getByRole("link", { name: "Privacy" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");

    await page
      .getByRole("navigation", { name: "Trust pages" })
      .getByRole("link", { name: "Terms" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Terms of use",
    );

    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(
      page.getByRole("button", { name: "Continue with GitHub" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Trust pages" })
        .getByRole("link", { name: "Data access" }),
    ).toBeVisible();
  });

  await test.step("an unauthenticated journal request is redirected to sign-in", async () => {
    await page.goto("/journal");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fjournal$/);
  });

  await signIn(context, "onboarding");

  await test.step("onboarding step 1 validates and stores the time zone", async () => {
    await page.goto("/journal");
    await expect(
      page.getByRole("heading", { name: "Start with your local day" }),
    ).toBeVisible();

    // The field is filled with the detected zone by an effect, so a non-empty
    // value is the signal that the step is hydrated and the form is wired to
    // the server action rather than to a native submit.
    const timeZone = page.getByLabel("Your time zone");
    await expect(timeZone).not.toHaveValue("");

    await timeZone.fill("Not/A_Zone");
    await page.getByRole("button", { name: "Confirm time zone" }).click();
    await expect(page.locator("#time-zone-error")).toHaveText(
      "Enter a valid IANA time zone.",
    );

    await timeZone.fill("Europe/Madrid");
    await page.getByRole("button", { name: "Confirm time zone" }).click();
    await expect(
      page.getByRole("heading", { name: "Choose what your journal can see" }),
    ).toBeVisible();
  });

  await test.step("onboarding step 2 offers installation and an unpunished skip", async () => {
    await expect(
      page.getByRole("link", { name: "Install GitHub App" }),
    ).toHaveAttribute("href", "/api/github/install?from=onboarding");
    await expect(
      page.getByRole("link", { name: "What each permission is used for" }),
    ).toHaveAttribute("href", "/data-access");

    await page
      .getByRole("button", { name: "Continue in best-effort mode" })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: /day, / }),
    ).toBeVisible();
  });

  await test.step("Today is honest about a best-effort record", async () => {
    await expect(
      page.getByText("Europe/Madrid", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Best-effort journal")).toBeVisible();
  });

  await signIn(context, "all");

  await test.step("Today reconciles and keeps stored facts on screen", async () => {
    await page.goto("/journal");
    await expect(
      page.getByText(/recorded events · .* categories with activity/),
    ).toBeVisible();

    await page.getByRole("button", { name: "Refresh Today" }).click();
    await expect(
      page.getByRole("status").filter({
        hasText: "Stored activity reloaded and GitHub reconciliation finished.",
      }),
    ).toHaveCount(1);
    await expect(page.getByText("Opened issue #51")).toBeVisible();
  });

  await test.step("a summary that is unavailable degrades without taking the day with it", async () => {
    // No summary exists for a fixture day, so the narrative slot must state
    // that and the deterministic record below it must stay complete.
    const narrative = page.getByRole("region", { name: "Written for you" });
    await expect(narrative).toBeVisible();
    await expect(narrative).toContainText("No narrative yet");
    await expect(page.getByText("Opened issue #51")).toBeVisible();
  });

  await test.step("History browses a finalized day and its corrections", async () => {
    await page.goto("/journal/history");
    await expect(
      page.getByRole("heading", { name: "Journal history" }),
    ).toBeVisible();
    await page.getByRole("link", { name: /Sunday, August 30/ }).click();
    await expect(
      page.getByRole("heading", { name: "Late corrections" }),
    ).toBeVisible();
  });

  await test.step("Settings states access, retention and the trust pages", async () => {
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "GitHub access" }),
    ).toBeVisible();
    await expect(page.getByText(/retained for 30 days/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Data access" }).first(),
    ).toHaveAttribute("href", "/data-access");
  });

  await test.step("deletion needs the typed word and ends the session", async () => {
    const confirmation = page.getByLabel("Type DELETE to confirm");
    await confirmation.fill("delete please");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL(/\/settings$/);

    await confirmation.fill("DELETE");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL(/\/\?account=deleted$/);
    await expect(page.getByRole("status")).toContainText(
      "Your account is deleted",
    );

    await page.goto("/journal");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fjournal$/);
  });
});
