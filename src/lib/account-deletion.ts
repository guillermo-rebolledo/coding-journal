import { createHash, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { privacyOperation, user } from "@/db/auth-schema";

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
  return async function deleteAccount(input: DeleteAccountInput) {
    const now = input.now ?? new Date();
    const operationId = randomUUID();
    const operationHash = createHash("sha256")
      .update(`account-deletion:${operationId}`)
      .digest("hex");
    await database.insert(privacyOperation).values({
      id: operationId,
      operationHash,
      kind: "account-deletion",
      status: "running",
      startedAt: now,
    });
    const providerRevoked = await revokeGitHubGrant(
      input,
      input.fetchImplementation ?? fetch,
    );
    try {
      // Every user-owned table has an ON DELETE CASCADE reference to this row,
      // so the single statement is the local deletion boundary.
      const deleted = await database
        .delete(user)
        .where(eq(user.id, input.userId))
        .returning({ id: user.id });
      await database
        .update(privacyOperation)
        .set({
          status: "complete",
          affectedUsers: deleted.length,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(privacyOperation.id, operationId));
      const result: DeleteAccountResult = {
        deleted: deleted.length > 0,
        providerRevoked,
      };
      return result;
    } catch (error) {
      await database
        .update(privacyOperation)
        .set({
          status: "failed",
          errorId: randomUUID(),
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(privacyOperation.id, operationId));
      throw error;
    }
  };
}

export const deleteJournalAccount = createAccountDeletion(db);
