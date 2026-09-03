import {
  associateExistingGitHubInstallations,
  GitHubInstallationSaveError,
  type InstallationAssociationStore,
} from "@/lib/github-installation";
import type { GitHubConnectionOutcome } from "@/lib/github-connection-status";
import type { GitHubReadClient } from "@/lib/github-read-client";
import type { GitHubUserAccess } from "@/lib/github-user-token";
import type { JournalSession } from "@/lib/session";

export type ConnectExistingInstallationsDependencies = {
  requestHeaders: Headers;
  appSlug: string;
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  getUserAccess: (
    requestHeaders: Headers,
    userId: string,
  ) => Promise<GitHubUserAccess | null>;
  createClient: (accessToken: string) => GitHubReadClient;
  store: InstallationAssociationStore;
  redirect: (destination: string) => never;
};

export async function runConnectExistingGitHubInstallations({
  requestHeaders,
  appSlug,
  getSession,
  getUserAccess,
  createClient,
  store,
  redirect,
}: ConnectExistingInstallationsDependencies) {
  const session = await getSession(requestHeaders);
  if (!session) return redirect("/sign-in?next=%2Fsettings");

  let userAccess: GitHubUserAccess | null;
  try {
    userAccess = await getUserAccess(requestHeaders, session.user.id);
  } catch {
    return redirect("/settings?github=connection-failed");
  }
  if (!userAccess) return redirect("/settings?github=reauthorize");

  let status: GitHubConnectionOutcome;
  try {
    const result = await associateExistingGitHubInstallations(
      session.user.id,
      userAccess,
      appSlug,
      createClient(userAccess.accessToken),
      store,
    );
    status = !result.identityVerified
      ? "identity-mismatch"
      : result.connectedCount > 0
        ? "connected"
        : result.rejectedCount > 0
          ? "invalid-installation"
          : "not-found";
  } catch (error) {
    status =
      error instanceof GitHubInstallationSaveError
        ? "connection-failed"
        : "unavailable";
  }

  return redirect(`/settings?github=${status}`);
}
