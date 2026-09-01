import {
  getGitHubUserAccessToken,
  getUserGitHubInstallation,
} from "@/lib/github-app";
import {
  consumeGitHubInstallationState,
  saveGitHubInstallation,
  savePendingGitHubInstallation,
} from "@/lib/github-installation";
import { getJournalSession } from "@/lib/session";

function redirectWithStatus(requestUrl: URL, path: string, status: string) {
  const destination = new URL(path, requestUrl);
  destination.searchParams.set("github", status);
  return Response.redirect(destination, 307);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const session = await getJournalSession(request.headers);

  if (!session) {
    const callbackPath = `${requestUrl.pathname}${requestUrl.search}`;
    return Response.redirect(
      new URL(`/sign-in?next=${encodeURIComponent(callbackPath)}`, requestUrl),
      307,
    );
  }

  const stateToken = requestUrl.searchParams.get("state");
  const state = stateToken
    ? await consumeGitHubInstallationState(session.user.id, stateToken)
    : null;

  if (!state) {
    return redirectWithStatus(requestUrl, "/journal", "invalid-state");
  }

  if (requestUrl.searchParams.get("setup_action") === "request") {
    await savePendingGitHubInstallation(session.user.id);
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
    return redirectWithStatus(
      requestUrl,
      state.returnTo,
      "invalid-installation",
    );
  }

  await saveGitHubInstallation(session.user.id, installation);
  return redirectWithStatus(requestUrl, state.returnTo, "connected");
}
