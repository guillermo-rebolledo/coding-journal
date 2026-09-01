import { getRequiredEnv } from "@/lib/env";
import { createGitHubInstallationState } from "@/lib/github-installation";
import { getJournalSession } from "@/lib/session";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo =
    requestUrl.searchParams.get("from") === "settings"
      ? "/settings"
      : "/journal";
  const session = await getJournalSession(request.headers);

  if (!session) {
    return Response.redirect(
      new URL(`/sign-in?next=${encodeURIComponent(returnTo)}`, requestUrl),
      307,
    );
  }

  const state = await createGitHubInstallationState(session.user.id, returnTo);
  const installUrl = new URL(
    `https://github.com/apps/${getRequiredEnv("GITHUB_APP_SLUG")}/installations/new`,
  );
  installUrl.searchParams.set("state", state);

  return Response.redirect(installUrl, 307);
}
