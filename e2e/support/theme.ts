import { expect, type Page } from "@playwright/test";

export type ThemeChoice = "System" | "Light" | "Dark";

/**
 * Choose a theme through the real menu.
 *
 * The trigger is a client component, so a click that lands before hydration is
 * swallowed — reliably so in WebKit. Retrying the open keeps that timing out of
 * every test that only wants to be in a given theme. The menu is a portal with
 * its own focus guards, so this also waits for it to unmount: scanning or
 * screenshotting mid-close would capture the menu rather than the page.
 */
export async function chooseTheme(page: Page, theme: ThemeChoice) {
  const item = page.getByRole("menuitem", { name: theme });

  await expect(async () => {
    await page.getByRole("button", { name: "Choose color theme" }).click();
    await expect(item).toBeVisible({ timeout: 1_000 });
  }).toPass();

  await item.click();
  await page.keyboard.press("Escape");
  await expect(item).toHaveCount(0);

  if (theme !== "System") {
    await expect(page.locator("html")).toHaveClass(
      theme === "Dark" ? /dark/ : /^(?!.*dark).*$/,
    );
  }
}
