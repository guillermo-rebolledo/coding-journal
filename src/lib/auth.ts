import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";

import { db } from "@/db";
import * as schema from "@/db/auth-schema";
import { getRequiredEnv } from "@/lib/env";

type TrustedOriginEnvName =
  | "BETTER_AUTH_URL"
  | "VERCEL_URL"
  | "VERCEL_BRANCH_URL"
  | "VERCEL_PROJECT_PRODUCTION_URL";

type TrustedOriginEnv = Partial<
  Record<TrustedOriginEnvName, string | undefined>
>;

const vercelHostEnvNames = [
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

function normalizeConfiguredOrigin(value: string | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeVercelOrigin(value: string | undefined) {
  const host = value?.trim().toLowerCase();
  if (
    !host ||
    host.includes("://") ||
    host.includes("*") ||
    host.includes("/")
  ) {
    return null;
  }

  try {
    const url = new URL(`https://${host}`);
    if (
      url.host !== host ||
      url.port ||
      !url.hostname.endsWith(".vercel.app")
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function getTrustedOrigins(
  environment: TrustedOriginEnv = {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  },
): string[] {
  const origins = new Set<string>();
  const configuredOrigin = normalizeConfiguredOrigin(
    environment.BETTER_AUTH_URL,
  );

  if (configuredOrigin) origins.add(configuredOrigin);

  for (const name of vercelHostEnvNames) {
    const origin = normalizeVercelOrigin(environment[name]);
    if (origin) origins.add(origin);
  }

  return [...origins];
}

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
  trustedOrigins: getTrustedOrigins(),
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
