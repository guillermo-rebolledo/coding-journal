import { defineConfig, devices } from "@playwright/test";

const localBrowser = process.env.CI ? {} : { channel: "chrome" as const };
const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], ...localBrowser } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...localBrowser } },
  ],
  webServer: process.env.E2E_EXTERNAL_SERVER
    ? undefined
    : {
        command: `pnpm dev --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        env: {
          DATABASE_URL: "postgresql://test:test@localhost:5432/test",
          BETTER_AUTH_SECRET: "e2e-secret-with-at-least-thirty-two-characters",
          BETTER_AUTH_URL: baseURL,
          GITHUB_CLIENT_ID: "test-client-id",
          GITHUB_CLIENT_SECRET: "test-client-secret",
          GITHUB_APP_SLUG: "coding-journal-test",
          E2E_AUTH_MODE: "true",
        },
      },
});
