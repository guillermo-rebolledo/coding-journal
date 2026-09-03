import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { account } from "@/db/auth-schema";
import { auth } from "@/lib/auth";

export type GitHubUserAccess = {
  accessToken: string;
  accountId: string;
};

export async function getGitHubUserAccess(
  requestHeaders: Headers,
  userId: string,
): Promise<GitHubUserAccess | null> {
  const githubAccount = await db.query.account.findFirst({
    columns: { id: true, accountId: true },
    where: and(eq(account.userId, userId), eq(account.providerId, "github")),
  });

  if (!githubAccount) return null;

  const result = await auth.api.getAccessToken({
    body: { accountId: githubAccount.id },
    headers: requestHeaders,
  });

  return {
    accessToken: result.accessToken,
    accountId: githubAccount.accountId,
  };
}

export async function getGitHubUserAccessToken(
  requestHeaders: Headers,
  userId: string,
) {
  const access = await getGitHubUserAccess(requestHeaders, userId);
  return access?.accessToken ?? null;
}

export async function getGitHubUserAccessTokenForJob(userId: string) {
  const githubAccount = await db.query.account.findFirst({
    columns: { id: true },
    where: and(eq(account.userId, userId), eq(account.providerId, "github")),
  });
  if (!githubAccount) return null;
  const result = await auth.api.getAccessToken({
    body: { accountId: githubAccount.id, userId },
  });
  return result.accessToken;
}
