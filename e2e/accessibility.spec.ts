import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/session";
import { chooseTheme } from "./support/theme";

/**
 * Automated WCAG 2.2 AA coverage of every primary flow — issue #17.
 *
 * axe catches the machine-checkable half of the standard: contrast, names,
 * roles, landmarks, labels, heading order. The half it cannot check — focus
 * order, target size, whether a status is stated in words as well as colour —
 * is reviewed by hand and recorded in `docs/accessibility.md`. The keyboard
 * assertions below are the parts of that review worth locking down.
 */

const standard = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function violations(page: Page) {
  await page.locator("details:not([open])").evaluateAll((disclosures) => {
    for (const disclosure of disclosures) {
      disclosure.setAttribute("open", "");
    }
  });

  const { violations } = await new AxeBuilder({ page })
    .withTags(standard)
    .analyze();

  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

const palettes = [
  { name: "Lavender", value: null },
  { name: "Warm ink", value: "warm-ink" },
  { name: "Tide", value: "tide" },
  { name: "Moss & clay", value: "moss" },
] as const;

test("the category table clears the contrast floor in every palette and theme", async ({
  context,
  isMobile,
  page,
}) => {
  test.skip(Boolean(isMobile), "The palette matrix is viewport-independent.");
  await signIn(context, "all");
  await page.goto("/journal");
  await expect(
    page.getByRole("button", { name: "Refresh Today" }),
  ).toBeVisible();
  await page.locator("summary", { hasText: "All 16 categories" }).click();

  for (const palette of palettes) {
    await page.locator("html").evaluate((root, value) => {
      if (value) root.dataset.palette = value;
      else delete root.dataset.palette;
    }, palette.value);

    for (const theme of ["Light", "Dark"] as const) {
      await chooseTheme(page, theme);
      const { violations: contrastViolations } = await new AxeBuilder({ page })
        .include('[role="group"][aria-label="All 16 categories"]')
        .withRules(["color-contrast"])
        .analyze();
      expect(
        contrastViolations,
        `${palette.name} in the ${theme.toLowerCase()} theme`,
      ).toEqual([]);
    }
  }
});

test("compact form controls keep iOS-safe text sizing", async ({
  context,
  isMobile,
  page,
}) => {
  test.skip(Boolean(isMobile), "This check sets its own compact viewport.");
  await signIn(context, "all");
  await page.setViewportSize({ width: 375, height: 812 });

  for (const path of ["/journal", "/settings"]) {
    await page.goto(path);
    const undersized = await page
      .locator("input:not([type=hidden]):not([type=radio]), select, textarea")
      .filter({ visible: true })
      .evaluateAll((controls) =>
        controls
          .filter(
            (control) =>
              Number.parseFloat(getComputedStyle(control).fontSize) < 16,
          )
          .map((control) => ({
            name:
              control.getAttribute("aria-label") ??
              control.getAttribute("name") ??
              control.tagName,
            fontSize: getComputedStyle(control).fontSize,
          })),
      );
    expect(undersized, path).toEqual([]);
  }
});

test("Today refresh keeps keyboard focus while it is in flight", async ({
  context,
  page,
}) => {
  await signIn(context, "all");
  await page.goto("/journal");
  const refresh = page.getByRole("button", { name: "Refresh Today" });
  await expect(refresh).toBeVisible();
  await refresh.evaluate((button) => {
    button.id = "focus-retention-refresh";
  });

  const stableRefresh = page.locator("#focus-retention-refresh");
  await stableRefresh.focus();
  await stableRefresh.click();

  await expect(stableRefresh).toBeFocused();
  await expect(stableRefresh).toHaveAttribute("aria-busy", "true");
  await expect(stableRefresh).toHaveText("Refresh Today");
});

const publicRoutes = [
  { name: "landing", path: "/" },
  { name: "sign-in", path: "/sign-in" },
  { name: "privacy", path: "/privacy" },
  { name: "terms", path: "/terms" },
  { name: "data access", path: "/data-access" },
] as const;

for (const route of publicRoutes) {
  for (const theme of ["Light", "Dark"] as const) {
    test(`${route.name} has no accessibility violations in the ${theme.toLowerCase()} theme`, async ({
      page,
    }) => {
      await page.goto(route.path);
      await chooseTheme(page, theme);
      expect(await violations(page)).toEqual([]);
    });
  }
}

const journalRoutes = [
  { name: "onboarding step 1", session: "onboarding", path: "/journal" },
  { name: "Today", session: "all", path: "/journal" },
  { name: "best-effort Today", session: "valid", path: "/journal" },
  {
    name: "onboarding step 2",
    session: "valid",
    path: "/journal?setup=repositories",
  },
  { name: "History", session: "all", path: "/journal/history" },
  {
    name: "a finalized day",
    session: "all",
    path: "/journal/history/2026-08-30",
  },
  {
    name: "a missing journal day",
    session: "all",
    path: "/journal/history/not-a-date",
  },
  {
    name: "a journal day render error",
    session: "all",
    path: "/journal/history/2026-08-29",
  },
  { name: "Settings", session: "all", path: "/settings" },
] as const;

for (const route of journalRoutes) {
  for (const theme of ["Light", "Dark"] as const) {
    test(`${route.name} has no accessibility violations in the ${theme.toLowerCase()} theme`, async ({
      context,
      page,
    }) => {
      await signIn(context, route.session);
      await page.goto(route.path);
      await chooseTheme(page, theme);
      expect(await violations(page)).toEqual([]);
    });
  }
}

test("the skip link is the first thing a keyboard reaches on Today", async ({
  browserName,
  context,
  page,
}) => {
  // Safari only lets Tab reach links when "Press Tab to highlight each item"
  // is enabled, which is off by default and is a system preference rather than
  // something the page controls. The skip link is verified by hand on Safari
  // instead — see docs/accessibility.md.
  test.skip(
    browserName === "webkit",
    "Tab does not traverse links in WebKit by default.",
  );

  await signIn(context, "all");
  await page.goto("/journal");
  // The loading composition is a different tree with its own heading, so wait
  // for the settled page rather than for any h1.
  await expect(
    page.getByRole("button", { name: "Refresh Today" }),
  ).toBeVisible();

  // Press against the document rather than the raw keyboard, so the first Tab
  // cannot land before the page owns focus.
  await page.locator("html").press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#journal-main")).toBeVisible();
});

test("the trust pages open with a skip link and a reachable section index", async ({
  browserName,
  page,
}) => {
  // Safari only lets Tab reach links when "Press Tab to highlight each item"
  // is enabled, which is off by default and is a system preference rather than
  // something the page controls. The skip link is verified by hand on Safari
  // instead — see docs/accessibility.md.
  test.skip(
    browserName === "webkit",
    "Tab does not traverse links in WebKit by default.",
  );

  await page.goto("/data-access");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.locator("html").press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();

  const index = page.getByRole("navigation", { name: "On this page" });
  // Compact composes the index as a collapsed disclosure; expanded shows it
  // standing. Both have to reach the same section.
  const disclosure = index.getByText("On this page", { exact: true }).first();
  if (await disclosure.isVisible()) await disclosure.click();
  await index
    .getByRole("link", { name: "Revoking access" })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL(/#revoking-access$/);
  await expect(
    page.getByRole("heading", { level: 2, name: "Revoking access" }),
  ).toBeVisible();
});

test("the theme menu is operable and dismissable from the keyboard", async ({
  browserName,
  page,
  isMobile,
}) => {
  test.skip(
    Boolean(isMobile),
    "Arrow-key menu navigation is the pointer-less desktop path.",
  );
  // Same WebKit limitation as the skip-link checks: without Safari full
  // keyboard access, arrow keys do not move focus through menu items.
  test.skip(
    browserName === "webkit",
    "Menu items are not keyboard-reachable in WebKit by default.",
  );
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Choose color theme" });
  const dark = page.getByRole("menuitem", { name: "Dark" });

  async function openFromKeyboard() {
    // Retry the open: a key pressed before hydration is swallowed, which says
    // nothing about whether the menu is keyboard-operable once it is live.
    await expect(async () => {
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      await expect(dark).toBeVisible({ timeout: 1_000 });
    }).toPass();
  }

  await openFromKeyboard();
  await page.keyboard.press("Escape");
  await expect(dark).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Opening with ArrowDown focuses the first item; the menu is System, Light,
  // Dark, so two more presses land on Dark and Enter chooses it.
  await openFromKeyboard();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(dark).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveClass(/dark/);
});
