const E2E_SESSION_COOKIE = "coding-journal-e2e-session";

const e2eModes = [
  "valid",
  "all",
  "partial",
  "pending",
  "disconnected",
] as const;

export type E2EMode = (typeof e2eModes)[number];

const e2eModeSet = new Set<string>(e2eModes);

export function getE2ESessionMode(requestHeaders: Headers): E2EMode | null {
  const value = requestHeaders
    .get("cookie")
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${E2E_SESSION_COOKIE}=`))
    ?.slice(E2E_SESSION_COOKIE.length + 1);

  return value && e2eModeSet.has(value) ? (value as E2EMode) : null;
}

export function getE2EUserId(mode: E2EMode) {
  return mode === "valid" ? "e2e-user" : `e2e-${mode}`;
}

export function getE2EAccessMode(userId: string) {
  return userId === "e2e-user" || userId === "e2e-pending"
    ? "best-effort"
    : "app";
}

export const e2eGitHubInstallations = {
  "e2e-all": [
    {
      installationId: "10",
      accountId: "20",
      accountLogin: "ada",
      accountType: "User",
      repositorySelection: "all",
      repositoryCount: 8,
      permissions: { contents: "read", discussions: "read", metadata: "read" },
      status: "active",
    },
  ],
  "e2e-partial": [
    {
      installationId: "42",
      accountId: "84",
      accountLogin: "example-org",
      accountType: "Organization",
      repositorySelection: "selected",
      repositoryCount: 3,
      permissions: { contents: "read", discussions: "read", metadata: "read" },
      status: "active",
    },
  ],
  "e2e-pending": [
    {
      installationId: null,
      accountId: "84",
      accountLogin: null,
      accountType: "Organization",
      repositorySelection: null,
      repositoryCount: null,
      permissions: null,
      status: "pending",
    },
  ],
  "e2e-disconnected": [
    {
      installationId: "11",
      accountId: "22",
      accountLogin: "old-org",
      accountType: "Organization",
      repositorySelection: "selected",
      repositoryCount: 2,
      permissions: { contents: "read", metadata: "read" },
      status: "disconnected",
    },
  ],
} as const;
