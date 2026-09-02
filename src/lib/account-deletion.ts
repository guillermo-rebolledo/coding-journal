import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { createPrivacyLedger, runPrivacyOperation } from "@/lib/privacy-ledger";

/** What one account deletion removed, and whether GitHub's grant went with it. */
export type DeleteAccountResult = {
  deleted: boolean;
  providerRevoked: boolean;
};

export type DeleteAccountInput = {
  userId: string;
  accessToken: string | null;
  clientId: string;
  clientSecret: string;
  fetchImplementation?: typeof fetch;
  now?: Date;
};

async function revokeGitHubGrant(
  input: Pick<DeleteAccountInput, "accessToken" | "clientId" | "clientSecret">,
  fetchImplementation: typeof fetch,
) {
  if (!input.accessToken) return false;
  try {
    const response = await fetchImplementation(
      `https://api.github.com/applications/${encodeURIComponent(input.clientId)}/grant`,
      {
        method: "DELETE",
        signal: AbortSignal.timeout(5_000),
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`,
          "content-type": "application/json",
          "x-github-api-version": "2026-03-10",
        },
        body: JSON.stringify({ access_token: input.accessToken }),
      },
    );
    return response.status === 204 || response.status === 404;
  } catch {
    return false;
  }
}

export function createAccountDeletion<TQueryResult extends PgQueryResultHKT>(
  database: PgDatabase<TQueryResult, typeof import("@/db/auth-schema")>,
) {
  const ledger = createPrivacyLedger(database);
  return async function deleteAccount(input: DeleteAccountInput) {
    const now = input.now ?? new Date();
    const operation = await runPrivacyOperation(
      ledger,
      {
        key: `account-deletion:${randomUUID()}`,
        kind: "account-deletion",
        now,
      },
      async () => {
        const providerRevoked = await revokeGitHubGrant(
          input,
          input.fetchImplementation ?? fetch,
        );
        // Every user-owned table has an ON DELETE CASCADE reference to this row,
        // so the single statement is the local deletion boundary.
        const deleted = await database
          .delete(user)
          .where(eq(user.id, input.userId))
          .returning({ id: user.id });
        return {
          affectedUsers: deleted.length,
          deleted: deleted.length > 0,
          providerRevoked,
        };
      },
    );
    if (operation.status === "skipped") {
      return { deleted: false, providerRevoked: false };
    }
    return {
      deleted: operation.value.deleted,
      providerRevoked: operation.value.providerRevoked,
    } satisfies DeleteAccountResult;
  };
}

export const deleteJournalAccount = createAccountDeletion(db);
