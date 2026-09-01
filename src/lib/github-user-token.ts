import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { account } from "@/db/auth-schema";
import { auth } from "@/lib/auth";

export async function getGitHubUserAccessToken(
  requestHeaders: Headers,
  userId: string,
) {
  const githubAccount = await db.query.account.findFirst({
    columns: { id: true },
    where: and(eq(account.userId, userId), eq(account.providerId, "github")),
  });

  if (!githubAccount) return null;

  const result = await auth.api.getAccessToken({
    body: { accountId: githubAccount.id },
    headers: requestHeaders,
  });

  return result.accessToken;
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
