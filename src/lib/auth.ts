import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";

import { db } from "@/db";
import * as schema from "@/db/auth-schema";
import { getRequiredEnv } from "@/lib/env";

export function githubProfileToUser(profile: {
  id: number | string;
  email?: string | null;
}) {
  return {
    email: profile.email ?? `${profile.id}@github.placeholder.invalid`,
  };
}

export const auth = betterAuth({
  appName: "Coding Journal",
  baseURL: getRequiredEnv("BETTER_AUTH_URL"),
  secret: getRequiredEnv("BETTER_AUTH_SECRET"),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    github: {
      clientId: getRequiredEnv("GITHUB_CLIENT_ID"),
      clientSecret: getRequiredEnv("GITHUB_CLIENT_SECRET"),
      mapProfileToUser: githubProfileToUser,
    },
  },
  account: {
    encryptOAuthTokens: true,
    identityStrategy: "provider-id",
    storeStateStrategy: "database",
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  disabledPaths: ["/get-access-token", "/refresh-token", "/account-info"],
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
});
