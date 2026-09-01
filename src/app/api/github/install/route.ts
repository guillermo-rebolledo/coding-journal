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
    const destination = new URL(
      `/sign-in?next=${encodeURIComponent(returnTo)}`,
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

  const state = await createGitHubInstallationState(session.user.id, returnTo);
  const installUrl = new URL(
    `https://github.com/apps/${getRequiredEnv("GITHUB_APP_SLUG")}/installations/new`,
  );
  installUrl.searchParams.set("state", state);

  return new Response(null, {
    status: 307,
    headers: { location: installUrl.toString(), "cache-control": "no-store" },
  });
}
