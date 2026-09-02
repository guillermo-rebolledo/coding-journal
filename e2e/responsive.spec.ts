import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/session";
import { chooseTheme } from "./support/theme";

/**
 * Responsive regression coverage — issue #17 and frame 1p of the look-and-feel
 * reference.
 *
 * The regressions this guards are structural rather than pixel-perfect: no
 * horizontal page scroll, nothing clipped outside the viewport, one display
 * heading per route, and the navigation composition the reference specifies at
 * each size class. Pixel baselines are deliberately not committed — they are
 * bound to the renderer that produced them, so a macOS baseline fails on CI's
 * Linux and vice versa, and the failure says nothing about the layout. Full
 * page screenshots are attached to every run instead, so a reviewer can see
 * what each width and theme actually looked like.
 */

// This spec drives its own viewport at every size class, so running it under
// the mobile device project as well would only duplicate the same four widths.
test.skip(({ isMobile }) => Boolean(isMobile), "Sets its own viewport.");

const widths = [
  { name: "320px", width: 320, height: 720, sizeClass: "compact" },
  { name: "375px", width: 375, height: 812, sizeClass: "compact" },
  { name: "840px", width: 840, height: 900, sizeClass: "expanded" },
  { name: "1280px", width: 1280, height: 900, sizeClass: "expanded" },
] as const;

const routes = [
  { name: "landing", session: null, path: "/" },
  { name: "data access", session: null, path: "/data-access" },
  { name: "Today", session: "all", path: "/journal" },
  { name: "History", session: "all", path: "/journal/history" },
  {
    name: "missing journal day",
    session: "all",
    path: "/journal/history/not-a-date",
  },
  {
    name: "journal day error",
    session: "all",
    path: "/journal/history/2026-08-29",
  },
  { name: "Settings", session: "all", path: "/settings" },
] as const;

/** Every element that sticks out past the right edge of the viewport. */
async function clippedElements(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1;
    return [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const { right, width, height } = element.getBoundingClientRect();
        if (width === 0 || height === 0) return false;
        // A horizontally scrollable strip is allowed to be wider than the
        // viewport; the reference asks for filter chips to scroll.
        let node: HTMLElement | null = element.parentElement;
        while (node) {
          const overflowX = getComputedStyle(node).overflowX;
          if (overflowX === "auto" || overflowX === "scroll") return false;
          node = node.parentElement;
        }
        return right > limit;
      })
      .map((element) => element.tagName + "." + element.className)
      .slice(0, 10);
  });
}

for (const route of routes) {
  for (const size of widths) {
    for (const theme of ["Light", "Dark"] as const) {
      test(`${route.name} holds together at ${size.name} in the ${theme.toLowerCase()} theme`, async ({
        context,
        page,
      }, testInfo) => {
        if (route.session) await signIn(context, route.session);
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto(route.path);
        await chooseTheme(page, theme);

        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          )
          .toBe(true);
        expect(await clippedElements(page)).toEqual([]);

        await testInfo.attach(
          `${route.name}-${size.name}-${theme.toLowerCase()}.png`,
          {
            body: await page.screenshot({ fullPage: true }),
            contentType: "image/png",
          },
        );
      });
    }
  }
}

test("Today's navigation is a bottom bar on compact and a rail from medium", async ({
  context,
  page,
}) => {
  await signIn(context, "all");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/journal");
  const navigation = page.getByRole("navigation", { name: "Primary" });
  const compact = await navigation.boundingBox();
  expect(compact).not.toBeNull();
  expect(compact!.width).toBeGreaterThan(300);
  expect(compact!.y).toBeGreaterThan(600);

  await page.setViewportSize({ width: 1280, height: 900 });
  const expanded = await navigation.boundingBox();
  expect(expanded).not.toBeNull();
  expect(expanded!.width).toBeLessThan(120);
  expect(expanded!.x).toBeLessThan(20);
});

test("Today keeps the refresh action ahead of the activity list in reading order", async ({
  context,
  page,
}) => {
  await signIn(context, "all");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/journal");

  const refreshBeforeList = await page.evaluate(() => {
    const refresh = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Refresh Today"),
    );
    const list = document
      .querySelector(
        'section[aria-labelledby]:has(select[aria-label="Activity filters: Activity type"])',
      )
      ?.querySelector("ol");
    if (!refresh || !list) return null;
    return Boolean(
      refresh.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  expect(refreshBeforeList).toBe(true);
});

test("200% zoom collapses to the medium composition instead of scrolling sideways", async ({
  context,
  page,
}) => {
  // Frame 1p: 200% zoom on a 1280px window is equivalent to a 640px logical
  // width, and must compose like medium rather than scroll horizontally.
  await signIn(context, "all");
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/journal");

  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  expect(await clippedElements(page)).toEqual([]);
});
