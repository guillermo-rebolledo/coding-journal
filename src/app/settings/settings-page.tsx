import Link from "next/link";

import {
  connectExistingGitHubAppInstallation,
  deleteAccount,
} from "@/app/settings/actions";
import { LimitNotice } from "@/components/journal/limit-notice";
import { GitHubAccessOverview } from "@/components/github-access-overview";
import { GitHubConnectionNotice } from "@/components/github-connection-notice";
import { AppShell } from "@/components/journal/app-shell";
import {
  ListSurface,
  SectionGroup,
  SettingsRow,
} from "@/components/journal/section-list";
import { PalettePicker } from "@/components/palette-picker";
import { ThemeModePicker } from "@/components/theme-mode-picker";
import { DestructiveConfirmation } from "@/components/journal/destructive-confirmation";
import type { GitHubConnection } from "@/lib/github-connection";
import { readGitHubConnectionOutcome } from "@/lib/github-connection-status";
import { rateLimitPolicyMessage } from "@/lib/rate-limit";
import type { JournalOnboarding } from "@/lib/journal";
import type { JournalSession } from "@/lib/session";

/**
 * The boundaries this page reaches. They are parameters rather than module
 * imports so a test can supply real stand-ins and still render the page it is
 * describing.
 */
export type SettingsPageDependencies = {
  requestHeaders: Headers;
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  getOnboarding: (
    userId: string,
    requestHeaders: Headers,
  ) => Promise<JournalOnboarding>;
  refreshConnections: (
    requestHeaders: Headers,
    userId: string,
  ) => Promise<GitHubConnection[]>;
  redirect: (destination: string) => never;
};

/**
 * Settings — frame 1k of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * Grouped rows with section labels replace the card-per-installation gallery
 * and the explainer cards. Every palette keeps working in light and dark,
 * because everything here is a semantic role rather than a hue.
 */
export async function renderSettingsPage(
  searchParams:
    | Promise<Record<string, string | string[] | undefined>>
    | undefined,
  {
    requestHeaders,
    getSession,
    getOnboarding,
    refreshConnections,
    redirect,
  }: SettingsPageDependencies,
) {
  const query = await searchParams;
  const limited = query?.limited === "deletion";
  const githubStatus = readGitHubConnectionOutcome(query?.github);
  const session = await getSession(requestHeaders);
  if (!session) return redirect("/sign-in?next=%2Fsettings");

  const [onboarding, installations] = await Promise.all([
    getOnboarding(session.user.id, requestHeaders),
    refreshConnections(requestHeaders, session.user.id),
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
                  ? `Your journal follows calendar days in ${onboarding.timeZone}, including daylight-saving changes. This choice is fixed after onboarding because changing it would move activity between dated journal days.`
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
          <GitHubConnectionNotice status={githubStatus} className="mb-3" />
          <GitHubAccessOverview
            accessMode={onboarding.githubAccessMode}
            installations={installations}
            connectExistingInstallation={connectExistingGitHubAppInstallation}
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
              supporting="When available, organization Projects coverage depends on GitHub preview interfaces and is always labelled best-effort."
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
              label="The full account"
              supporting={
                <>
                  Every permission, processor, retention window and quota is
                  written out in{" "}
                  <Link
                    href="/data-access"
                    className="text-m3-primary underline underline-offset-4"
                  >
                    Data access
                  </Link>
                  , alongside{" "}
                  <Link
                    href="/privacy"
                    className="text-m3-primary underline underline-offset-4"
                  >
                    Privacy
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/terms"
                    className="text-m3-primary underline underline-offset-4"
                  >
                    Terms
                  </Link>
                  .
                </>
              }
            />
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
            {limited ? (
              <LimitNotice
                message={rateLimitPolicyMessage("account-deletion")}
                className="mt-5"
              />
            ) : null}
            <div className="mt-5">
              <DestructiveConfirmation
                action={deleteAccount}
                literal="DELETE"
                fieldLabel="Type DELETE to confirm"
                submitLabel="Delete my account"
                description="This permanently deletes your journal, summaries, settings, and every session. Coding Journal will also revoke its GitHub OAuth grant when GitHub is reachable. This cannot be undone."
                initiallyOpen
              />
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
