import { auth } from "@/lib/auth";

/** The signed-in session a journal request carries. */
export type JournalSession = NonNullable<
  Awaited<ReturnType<typeof getJournalSession>>
>;

export async function getJournalSession(requestHeaders: Headers) {
  return auth.api.getSession({ headers: requestHeaders });
}
