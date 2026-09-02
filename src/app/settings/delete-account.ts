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
  deleteAccount: (
    requestHeaders: Headers,
    userId: string,
  ) => Promise<void>;
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
    deleteAccount,
    redirect,
  }: DeleteAccountDependencies,
) {
  if (formData.get("confirmation") !== "DELETE") return;
  const session = await getSession(requestHeaders);
  if (!session) return redirect("/sign-in?next=%2Fsettings");

  const budget = await spendBudget(session.user.id);
  if (budget && !budget.allowed) return redirect("/settings?limited=deletion");

  await deleteAccount(requestHeaders, session.user.id);
  logServiceEvent({
    category: "privacy",
    event: "account-deleted",
    outcome: "ok",
    userId: session.user.id,
  });
  return redirect("/?account=deleted");
}
