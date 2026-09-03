import Link from "next/link";

import { ListSurface, SettingsRow } from "@/components/journal/section-list";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  describeMissingActivity,
  getGitHubInstallationCompleteness,
} from "@/lib/github-completeness";
import type { GitHubConnectionView } from "@/lib/github-completeness";
import type { GitHubAccessMode } from "@/lib/journal";

/**
 * GitHub access — frame 1k of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * Grouped rows replace the card-per-installation gallery. Connection state is
 * a label and a sentence in the same slot for every state, so nothing depends
 * on colour and the list reads top to bottom instead of as a gallery.
 */
function getInstallationStatus(installation: GitHubConnectionView) {
  const completeness = getGitHubInstallationCompleteness(installation);
  if (completeness.kind === "pending") {
    return {
      label: completeness.label,
      detail:
        "An organization owner must approve the request before Coding Journal can read repositories.",
    };
  }

  if (completeness.kind === "disconnected") {
    return {
      label: completeness.label,
      detail:
        "GitHub no longer reports this installation as available. Reinstall or review access on GitHub.",
    };
  }

  if (completeness.kind === "unavailable") {
    return {
      label: completeness.label,
      detail:
        "GitHub could not be reached just now. This is your last known access; try refreshing later.",
    };
  }

  if (completeness.kind === "partial") {
    const count = completeness.repositoryCount;
    return {
      label: completeness.label,
      detail: `${count} selected ${count === 1 ? "repository" : "repositories"} visible to your GitHub identity.${completeness.missingPermissions.length ? ` ${describeMissingActivity(completeness.missingPermissions)} until the App permissions are updated.` : ""}`,
    };
  }

  if (completeness.kind === "limited") {
    return {
      label: completeness.label,
      detail: `Granted repositories are visible. ${describeMissingActivity(completeness.missingPermissions)} until the App permissions are updated.`,
    };
  }

  return {
    label: completeness.label,
    detail:
      "All repositories granted to this installation are available for supported activity.",
  };
}

export function GitHubAccessOverview({
  accessMode,
  installations,
  connectExistingInstallation,
}: {
  accessMode: GitHubAccessMode | null;
  installations: GitHubConnectionView[];
  connectExistingInstallation: () => Promise<void>;
}) {
  const hasInstallation = installations.some(
    (installation) => installation.status === "active",
  );

  return (
    <ListSurface>
      {installations.length ? (
        installations.map((installation, index) => {
          const status = getInstallationStatus(installation);
          const key = installation.installationId ?? `pending-${index}`;
          const manageUrl = installation.installationId
            ? installation.accountType === "Organization" &&
              installation.accountLogin
              ? `https://github.com/organizations/${encodeURIComponent(installation.accountLogin)}/settings/installations/${installation.installationId}`
              : `https://github.com/settings/installations/${installation.installationId}`
            : null;

          return (
            <SettingsRow
              key={key}
              label={installation.accountLogin ?? "GitHub installation"}
              supporting={
                <>
                  <span className="block text-m3-label-lg text-m3-on-surface">
                    {status.label}
                  </span>
                  <span className="block">{status.detail}</span>
                </>
              }
              action={
                manageUrl ? (
                  <Link
                    href={manageUrl}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    Manage on GitHub
                  </Link>
                ) : null
              }
            />
          );
        })
      ) : (
        <SettingsRow
          label={accessMode === "best-effort" ? "Skipped" : "Not installed"}
          supporting={
            accessMode === "best-effort"
              ? "Repository installation was skipped. Your journal remains best-effort and may miss private or delayed activity."
              : "No repository access has been granted to Coding Journal."
          }
        />
      )}

      {!hasInstallation ? (
        <SettingsRow
          label="Existing installation"
          supporting="Already installed? Check GitHub for an installation accessible to your signed-in identity. Coding Journal will verify it without changing repository access."
          action={
            <form action={connectExistingInstallation}>
              <Button type="submit" variant="outline">
                Check existing installation
              </Button>
            </form>
          }
        />
      ) : null}

      <SettingsRow
        label={
          hasInstallation
            ? "Add another installation"
            : "Install the GitHub App"
        }
        supporting={
          hasInstallation
            ? "Grant read-only access to another account or organization, or change the repositories GitHub exposes."
            : "GitHub may show Configure when the App is already installed. You can return here and check the existing installation without changing its repositories."
        }
        action={
          <Link
            href="/api/github/install?from=settings"
            className={buttonVariants({ variant: "outline" })}
          >
            {hasInstallation
              ? "Add another installation"
              : "Install GitHub App"}
          </Link>
        }
      />
    </ListSurface>
  );
}
