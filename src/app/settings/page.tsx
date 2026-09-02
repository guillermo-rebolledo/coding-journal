import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { GitHubAccessOverview } from "@/components/github-access-overview";
import { AppShell } from "@/components/journal/app-shell";
import {
  ListSurface,
  SectionGroup,
  SettingsRow,
} from "@/components/journal/section-list";
import { PalettePicker } from "@/components/palette-picker";
import { ThemeModePicker } from "@/components/theme-mode-picker";
import { refreshGitHubConnections } from "@/lib/github-connection";
import { getJournalOnboarding } from "@/lib/journal";
import { getJournalSession } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * Settings — frame 1k of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * Grouped rows with section labels replace the card-per-installation gallery
 * and the explainer cards. Every palette keeps working in light and dark,
 * because everything here is a semantic role rather than a hue.
 */
export default async function SettingsPage() {
  const requestHeaders = await headers();
  const session = await getJournalSession(requestHeaders);
  if (!session) redirect("/sign-in?next=%2Fsettings");

  const [onboarding, installations] = await Promise.all([
    getJournalOnboarding(session.user.id),
    refreshGitHubConnections(requestHeaders, session.user.id),
  ]);

  return (
    <AppShell current="settings">
      <div className="max-w-[72ch]">
        <h1 className="text-m3-headline-lg text-balance m3-expanded:text-m3-display-sm">
          Settings
        </h1>

        <SectionGroup
          id="journal-settings-heading"
          title="Journal"
          className="mt-10"
        >
          <ListSurface>
            <SettingsRow
              label="Time zone"
              supporting={
                onboarding.timeZone
                  ? `Your journal follows calendar days in ${onboarding.timeZone}, including daylight-saving changes.`
                  : "Not confirmed yet. Open Today to finish onboarding."
              }
            />
          </ListSurface>
        </SectionGroup>

        <SectionGroup
          id="github-access-heading"
          title="GitHub access"
          description="Review exactly what GitHub has granted. Coding Journal never claims coverage outside these installations."
          className="mt-10"
        >
          <GitHubAccessOverview
            accessMode={onboarding.githubAccessMode}
            installations={installations}
          />
        </SectionGroup>

        <SectionGroup
          id="coverage-limits-heading"
          title="Coverage and privacy"
          description="What Coding Journal can and cannot see, and how it handles what it stores."
          className="mt-10"
        >
          <ListSurface>
            <SettingsRow
              label="Preview source"
              supporting="When available, organization Projects coverage depends on GitHub preview interfaces and is always labeled best-effort."
            />
            <SettingsRow
              label="Reconciliation only"
              supporting="User-authorized Gists and lightweight activity can arrive later because GitHub does not provide matching repository webhooks."
            />
            <SettingsRow
              label="Private by design"
              supporting="OAuth and installation credentials stay encrypted on the server. Repository names and private visibility are handled only on the signed-in server boundary and are excluded from telemetry."
            />
          </ListSurface>
        </SectionGroup>

        <SectionGroup
          id="appearance-heading"
          title="Appearance"
          description="Mode and palette apply to every screen, in this browser, right away."
          className="mt-10"
        >
          <ListSurface>
            <SettingsRow
              label="Mode"
              supporting="System follows your device setting."
            >
              <div className="mt-4">
                <ThemeModePicker />
              </div>
            </SettingsRow>
            <SettingsRow
              label="Palette"
              supporting="Swatches preview primary, secondary container and tertiary container in the current mode."
            >
              <div className="mt-4">
                <PalettePicker />
              </div>
            </SettingsRow>
          </ListSurface>
        </SectionGroup>
      </div>
    </AppShell>
  );
}
