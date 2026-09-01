import { AlertTriangle, CheckCircle2, Clock3, RefreshCw } from "lucide-react";

import type { StoredGitHubInstallation } from "@/lib/github-installation";
import type { GitHubAccessMode } from "@/lib/journal";

function getInstallationStatus(installation: StoredGitHubInstallation) {
  if (installation.status === "pending") {
    return {
      icon: Clock3,
      label: "Pending approval",
      detail:
        "An organization owner must approve the request before Coding Journal can read repositories.",
    };
  }

  if (installation.status === "disconnected") {
    return {
      icon: AlertTriangle,
      label: "Disconnected",
      detail:
        "GitHub no longer reports this installation as available. Reinstall or review access on GitHub.",
    };
  }

  if (installation.repositorySelection === "selected") {
    const count = installation.repositoryCount ?? 0;
    return {
      icon: CheckCircle2,
      label: "Partial access",
      detail: `${count} selected ${count === 1 ? "repository" : "repositories"} visible to your GitHub identity.`,
    };
  }

  return {
    icon: CheckCircle2,
    label: "Installed",
    detail:
      "All repositories granted to this installation are available for supported activity.",
  };
}

export function GitHubAccessOverview({
  accessMode,
  installations,
}: {
  accessMode: GitHubAccessMode | null;
  installations: StoredGitHubInstallation[];
}) {
  return (
    <div className="grid gap-4">
      {installations.length ? (
        installations.map((installation, index) => {
          const status = getInstallationStatus(installation);
          const StatusIcon = status.icon;
          const key = installation.installationId ?? `pending-${index}`;

          return (
            <article
              key={key}
              className="rounded-m3-xl bg-m3-surface-container-low p-5 sm:p-6"
            >
              <div className="flex items-start gap-4">
                <span className="bg-primary-container grid size-11 shrink-0 place-items-center rounded-m3-lg text-primary">
                  <StatusIcon aria-hidden className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-m3-label-lg-emphasized text-primary">
                    {status.label}
                  </p>
                  {installation.accountLogin ? (
                    <h2 className="text-m3-title-lg-emphasized mt-1 truncate">
                      {installation.accountLogin}
                    </h2>
                  ) : null}
                  <p className="mt-2 text-m3-body-md text-muted-foreground">
                    {status.detail}
                  </p>
                </div>
              </div>
            </article>
          );
        })
      ) : (
        <article className="rounded-m3-xl bg-m3-surface-container-low p-5 sm:p-6">
          <p className="text-m3-label-lg-emphasized text-primary">
            {accessMode === "best-effort" ? "Skipped" : "Not installed"}
          </p>
          <p className="mt-2 text-m3-body-md text-muted-foreground">
            {accessMode === "best-effort"
              ? "Repository installation was skipped. Your journal remains best-effort and may miss private or delayed activity."
              : "No repository access has been granted to Coding Journal."}
          </p>
        </article>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-m3-xl border border-border p-5">
          <p className="text-m3-label-lg-emphasized">Preview source</p>
          <p className="mt-2 text-m3-body-sm text-muted-foreground">
            Organization Projects coverage depends on GitHub preview interfaces
            and is always labeled best-effort.
          </p>
        </article>
        <article className="rounded-m3-xl border border-border p-5">
          <div className="flex items-center gap-2">
            <RefreshCw aria-hidden className="size-4 text-primary" />
            <p className="text-m3-label-lg-emphasized">Reconciliation only</p>
          </div>
          <p className="mt-2 text-m3-body-sm text-muted-foreground">
            Gists and lightweight GitHub activity can arrive later because
            GitHub does not provide matching repository webhooks.
          </p>
        </article>
      </div>
    </div>
  );
}
