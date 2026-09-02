import { getRequiredEnv } from "@/lib/env";
import type { JournalSession } from "@/lib/session";

/**
 * The two boundaries this route reaches. They are parameters rather than
 * module imports so a test can supply real stand-ins and still exercise the
 * redirect and state-binding the route is responsible for.
 */
export type InstallStartDependencies = {
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  createState: (
    userId: string,
    returnTo: "/journal" | "/settings",
  ) => Promise<string>;
};

/** Binds an opaque state to the user and starts the GitHub install flow. */
export function createInstallStartRoute({
  getSession,
  createState,
}: InstallStartDependencies) {
  return async function GET(request: Request) {
    const requestUrl = new URL(request.url);
    const returnTo =
      requestUrl.searchParams.get("from") === "settings"
        ? "/settings"
        : "/journal";
    const session = await getSession(request.headers);

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

    const state = await createState(session.user.id, returnTo);
    const installUrl = new URL(
      `https://github.com/apps/${getRequiredEnv("GITHUB_APP_SLUG")}/installations/new`,
    );
    installUrl.searchParams.set("state", state);

    return new Response(null, {
      status: 307,
      headers: { location: installUrl.toString(), "cache-control": "no-store" },
    });
  };
}
