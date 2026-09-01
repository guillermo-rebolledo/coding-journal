import { getUserGitHubInstallation } from "@/lib/github-app";
import {
  consumeGitHubInstallationState,
  disconnectGitHubInstallation,
  saveGitHubInstallation,
  savePendingGitHubInstallation,
} from "@/lib/github-installation";
import { getGitHubUserAccessToken } from "@/lib/github-user-token";
import { getJournalSession } from "@/lib/session";

type GitHubCallbackStatus =
  | "connected"
  | "invalid-callback"
  | "invalid-installation"
  | "invalid-state"
  | "pending"
  | "reauthorize";

function redirectWithStatus(
  requestUrl: URL,
  path: string,
  status: GitHubCallbackStatus,
) {
  const destination = new URL(path, requestUrl);
  destination.searchParams.set("github", status);
  return new Response(null, {
    status: 307,
    headers: { location: destination.toString(), "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const session = await getJournalSession(request.headers);

  if (!session) {
    const callbackPath = `${requestUrl.pathname}${requestUrl.search}`;
    const destination = new URL(
      `/sign-in?next=${encodeURIComponent(callbackPath)}`,
      requestUrl,
    );
    return new Response(null, {
      status: 307,
      headers: { location: destination.toString(), "cache-control": "no-store" },
    });
  }

  const stateToken = requestUrl.searchParams.get("state");
  const state = stateToken
    ? await consumeGitHubInstallationState(session.user.id, stateToken)
    : null;

  if (!state) {
    return redirectWithStatus(requestUrl, "/journal", "invalid-state");
  }

  const setupAction = requestUrl.searchParams.get("setup_action");
  if (
    setupAction &&
    setupAction !== "install" &&
    setupAction !== "update" &&
    setupAction !== "request"
  ) {
    return redirectWithStatus(requestUrl, state.returnTo, "invalid-callback");
  }

  if (setupAction === "request") {
    const accountId = requestUrl.searchParams.get("target_id");
    const accountType = requestUrl.searchParams.get("target_type");
    if (
      !accountId ||
      !/^[1-9]\d*$/.test(accountId) ||
      accountType !== "Organization"
    ) {
      return redirectWithStatus(requestUrl, state.returnTo, "invalid-callback");
    }

    await savePendingGitHubInstallation(session.user.id, accountId);
    return redirectWithStatus(requestUrl, state.returnTo, "pending");
  }

  const installationId = requestUrl.searchParams.get("installation_id");
  if (!installationId || !/^[1-9]\d*$/.test(installationId)) {
    return redirectWithStatus(requestUrl, state.returnTo, "invalid-callback");
  }

  const accessToken = await getGitHubUserAccessToken(
    request.headers,
    session.user.id,
  );
  if (!accessToken) {
    return redirectWithStatus(requestUrl, state.returnTo, "reauthorize");
  }

  const installation = await getUserGitHubInstallation(
    accessToken,
    installationId,
  );
  if (!installation) {
    await disconnectGitHubInstallation(session.user.id, installationId);
    return redirectWithStatus(
      requestUrl,
      state.returnTo,
      "invalid-installation",
    );
  }

  await saveGitHubInstallation(session.user.id, installation);
  return redirectWithStatus(requestUrl, state.returnTo, "connected");
}
