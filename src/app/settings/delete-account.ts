import type {
  DeleteAccountInput,
  DeleteAccountResult,
} from "@/lib/account-deletion";
import type { RateLimitDecision } from "@/lib/rate-limit";
import type { JournalSession } from "@/lib/session";
import { logServiceEvent } from "@/lib/telemetry";

/**
 * The boundaries account deletion reaches. They are parameters rather than
 * module imports so a test can supply real stand-ins and still exercise the
 * confirmation, budget and ordering rules this action owns.
 */
export type DeleteAccountDependencies = {
  requestHeaders: Headers;
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  spendBudget: (userId: string) => Promise<RateLimitDecision | null>;
  isFixtureUser: (userId: string) => boolean;
  endFixtureSession: () => Promise<void>;
  getAccessToken: (
    requestHeaders: Headers,
    userId: string,
  ) => Promise<string | null>;
  deleteAccount: (input: DeleteAccountInput) => Promise<DeleteAccountResult>;
  credentials: { clientId: string; clientSecret: string };
  redirect: (destination: string) => never;
};

/**
 * Deletion revokes a GitHub grant and rewrites every table the account
 * touches, so it is bounded like any other costly boundary. A refusal returns
 * to Settings, which states the limit in the destructive zone.
 */
export async function runDeleteAccount(
  formData: FormData,
  {
    requestHeaders,
    getSession,
    spendBudget,
    isFixtureUser,
    endFixtureSession,
    getAccessToken,
    deleteAccount,
    credentials,
    redirect,
  }: DeleteAccountDependencies,
) {
  if (formData.get("confirmation") !== "DELETE") return;
  const session = await getSession(requestHeaders);
  if (!session) return redirect("/sign-in?next=%2Fsettings");

  const budget = await spendBudget(session.user.id);
  if (budget && !budget.allowed) return redirect("/settings?limited=deletion");

  // A fixture user has nothing in the database to delete and no GitHub grant
  // to revoke. Ending the session is the observable outcome the smoke run
  // checks, and it is the same outcome a real deletion produces.
  if (isFixtureUser(session.user.id)) {
    await endFixtureSession();
    return redirect("/?account=deleted");
  }

  const accessToken = await getAccessToken(
    requestHeaders,
    session.user.id,
  ).catch(() => null);
  await deleteAccount({
    userId: session.user.id,
    accessToken,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  });
  logServiceEvent({
    category: "privacy",
    event: "account-deleted",
    outcome: "ok",
    userId: session.user.id,
  });
  return redirect("/?account=deleted");
}
