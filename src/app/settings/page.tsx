import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { deleteAccount } from "@/app/settings/actions";
import { LimitNotice } from "@/components/journal/limit-notice";
import { GitHubAccessOverview } from "@/components/github-access-overview";
import { AppShell } from "@/components/journal/app-shell";
import {
  ListSurface,
  SectionGroup,
  SettingsRow,
} from "@/components/journal/section-list";
import { PalettePicker } from "@/components/palette-picker";
import { ThemeModePicker } from "@/components/theme-mode-picker";
import { Button } from "@/components/ui/button";
import { refreshGitHubConnections } from "@/lib/github-connection";
import { rateLimitPolicyMessage } from "@/lib/rate-limit";
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
export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const limited = (await searchParams)?.limited === "deletion";
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
          id="coverage-heading"
          title="Coverage limits"
          description="Two sources are always labelled best-effort, because GitHub does not expose them reliably."
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
          </ListSurface>
        </SectionGroup>

        <SectionGroup
          id="privacy-heading"
          title="Access and retention"
          className="mt-10"
        >
          <ListSurface>
            <SettingsRow
              label="What is processed"
              supporting="Coding Journal processes only the GitHub account and active App installations shown above. OAuth and installation credentials stay encrypted on the server, and repository names and private visibility never leave the signed-in server boundary."
            />
            <SettingsRow
              label="Retention"
              supporting="Normalized GitHub activity is retained for 30 days. Final daily summaries and aggregate counts remain so journal history still works without repository-level details."
            />
            <SettingsRow
              label="Revoking access on GitHub"
              supporting={
                <>
                  Suspending or removing access stops new processing;
                  inaccessible private details are removed from stored activity
                  and replaced by a neutral marker in history. You can revoke
                  installation access in{" "}
                  <a
                    href="https://github.com/settings/installations"
                    target="_blank"
                    rel="noreferrer"
                    className="text-m3-primary underline underline-offset-4"
                  >
                    GitHub App settings
                  </a>{" "}
                  or revoke the OAuth grant in{" "}
                  <a
                    href="https://github.com/settings/applications"
                    target="_blank"
                    rel="noreferrer"
                    className="text-m3-primary underline underline-offset-4"
                  >
                    GitHub application settings
                  </a>
                  .
                </>
              }
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

        {/*
         * The destructive zone — frame 1k and pattern 12. It is the only
         * outlined-error element in the product, it sits last, and a full
         * section break separates it so it never shares a row group with a
         * routine setting. The typed confirmation is the friction the
         * reference asks for: this destroys 30 days of irreplaceable record.
         */}
        <section
          aria-labelledby="delete-account-heading"
          className="mt-16 border-t border-m3-outline-variant pt-10"
        >
          <div className="rounded-m3-md border border-m3-error p-5 sm:p-6">
            <h2
              id="delete-account-heading"
              className="text-m3-title-md text-m3-error"
            >
              Delete account
            </h2>
            <p className="mt-2 max-w-[62ch] text-m3-body-md text-m3-on-surface-variant">
              This permanently deletes your journal, summaries, settings, and
              every session. Coding Journal will also revoke its GitHub OAuth
              grant when GitHub is reachable. This cannot be undone.
            </p>
            {limited ? (
              <LimitNotice
                message={rateLimitPolicyMessage("account-deletion")}
                className="mt-5"
              />
            ) : null}
            <form
              action={deleteAccount}
              className="mt-5 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end"
            >
              <label className="flex-1 text-m3-label-lg text-m3-on-surface">
                Type DELETE to confirm
                <input
                  name="confirmation"
                  required
                  pattern="DELETE"
                  autoComplete="off"
                  className="mt-2 min-h-12 w-full rounded-m3-xs border border-m3-error bg-transparent px-4 text-m3-body-md text-m3-on-surface"
                />
              </label>
              <Button type="submit" variant="destructive" className="sm:mb-0.5">
                Delete my account
              </Button>
            </form>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
