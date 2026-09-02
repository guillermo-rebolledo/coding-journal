import type { GitHubInstallationDetails } from "@/lib/github-app";
import type { JournalSession } from "@/lib/session";

type GitHubCallbackStatus =
  | "connected"
  | "invalid-callback"
  | "invalid-installation"
  | "invalid-state"
  | "pending"
  | "reauthorize";

/**
 * The boundaries this route reaches. They are parameters rather than module
 * imports so a test can supply real stand-ins and still exercise the state
 * consumption, parameter validation and redirect statuses the route owns.
 */
export type CallbackDependencies = {
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  consumeState: (
    userId: string,
    token: string,
  ) => Promise<{ returnTo: "/journal" | "/settings" } | null>;
  getAccessToken: (
    requestHeaders: Headers,
    userId: string,
  ) => Promise<string | null>;
  getInstallation: (
    accessToken: string,
    installationId: string,
  ) => Promise<GitHubInstallationDetails | null>;
  saveInstallation: (
    userId: string,
    details: GitHubInstallationDetails,
  ) => Promise<void>;
  savePendingInstallation: (userId: string, accountId: string) => Promise<void>;
  disconnectInstallation: (
    userId: string,
    installationId: string,
  ) => Promise<void>;
};

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

export function createGitHubCallbackRoute({
  getSession,
  consumeState,
  getAccessToken,
  getInstallation,
  saveInstallation,
  savePendingInstallation,
  disconnectInstallation,
}: CallbackDependencies) {
  return async function GET(request: Request) {
    const requestUrl = new URL(request.url);
    const session = await getSession(request.headers);

    if (!session) {
      const callbackPath = `${requestUrl.pathname}${requestUrl.search}`;
      const destination = new URL(
        `/sign-in?next=${encodeURIComponent(callbackPath)}`,
        requestUrl,
      );
      return new Response(null, {
        status: 307,
        headers: {
          location: destination.toString(),
          "cache-control": "no-store",
        },
      });
    }

    const stateToken = requestUrl.searchParams.get("state");
    const state = stateToken
      ? await consumeState(session.user.id, stateToken)
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
        return redirectWithStatus(
          requestUrl,
          state.returnTo,
          "invalid-callback",
        );
      }

      await savePendingInstallation(session.user.id, accountId);
      return redirectWithStatus(requestUrl, state.returnTo, "pending");
    }

    const installationId = requestUrl.searchParams.get("installation_id");
    if (!installationId || !/^[1-9]\d*$/.test(installationId)) {
      return redirectWithStatus(requestUrl, state.returnTo, "invalid-callback");
    }

    const accessToken = await getAccessToken(request.headers, session.user.id);
    if (!accessToken) {
      return redirectWithStatus(requestUrl, state.returnTo, "reauthorize");
    }

    const installation = await getInstallation(accessToken, installationId);
    if (!installation) {
      await disconnectInstallation(session.user.id, installationId);
      return redirectWithStatus(
        requestUrl,
        state.returnTo,
        "invalid-installation",
      );
    }

    await saveInstallation(session.user.id, installation);
    return redirectWithStatus(requestUrl, state.returnTo, "connected");
  };
}
