import {
  computeActivityMetrics,
  type ActivityRecord,
} from "@/lib/github-activity";
import type { TodayJournal } from "@/lib/github-reconciliation";
import type { StoredGitHubInstallation } from "@/lib/github-installation";
import { getLocalDayWindow } from "@/lib/time-zone";

export const E2E_SESSION_COOKIE = "coding-journal-e2e-session";

/**
 * Onboarding progress for a smoke run. A real user's two onboarding answers
 * are a database row; a smoke deployment has no database, so the onboarding
 * actions record the same two answers in this cookie instead. Only the
 * `onboarding` session mode reads it — every other mode is already onboarded.
 */
export const E2E_ONBOARDING_COOKIE = "coding-journal-e2e-onboarding";

export type E2EOnboardingStage = "time-zone" | "complete";

const e2eModes = [
  "valid",
  "all",
  "partial",
  "pending",
  "disconnected",
  "onboarding",
] as const;

export type E2EMode = (typeof e2eModes)[number];

const e2eModeSet = new Set<string>(e2eModes);

function isE2EMode(value: string | null): value is E2EMode {
  return value !== null && e2eModeSet.has(value);
}

function readCookie(requestHeaders: Headers, name: string) {
  return (
    requestHeaders
      .get("cookie")
      ?.split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? null
  );
}

export function getE2ESessionMode(requestHeaders: Headers): E2EMode | null {
  const value = readCookie(requestHeaders, E2E_SESSION_COOKIE);

  return isE2EMode(value) ? value : null;
}

const e2eOnboardingUserId = "e2e-onboarding";

/**
 * The onboarding answers a fixture user has given. Every mode but
 * `onboarding` starts already set up, so the smoke run can reach Today
 * directly; `onboarding` starts at step 1 and advances as the real server
 * actions run.
 */
export function getE2EOnboardingProgress(
  userId: string,
  requestHeaders: Headers | null,
) {
  if (userId !== e2eOnboardingUserId) {
    return {
      timeZone: "America/Mexico_City",
      githubAccessMode: getE2EAccessMode(userId),
    };
  }

  const stage = requestHeaders
    ? readCookie(requestHeaders, E2E_ONBOARDING_COOKIE)
    : null;

  return {
    timeZone:
      stage === "time-zone" || stage === "complete" ? "Europe/Madrid" : null,
    githubAccessMode: stage === "complete" ? ("best-effort" as const) : null,
  };
}

export function getE2EUserId(mode: E2EMode) {
  return mode === "valid" ? "e2e-user" : `e2e-${mode}`;
}

export function isE2EJournalUser(userId: string) {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true" &&
    userId.startsWith("e2e-")
  );
}

export function getE2ESession(requestHeaders: Headers) {
  const mode = getE2ESessionMode(requestHeaders);
  if (!mode) return null;
  const now = new Date("2026-08-31T12:00:00.000Z");
  const userId = getE2EUserId(mode);
  return {
    session: {
      id: "e2e-session",
      token: "e2e-token",
      userId,
      expiresAt: new Date("2026-09-30T12:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: userId,
      name: "Ada Lovelace",
      email: "ada@example.com",
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export function getE2EAccessMode(userId: string) {
  return userId === "e2e-user" || userId === "e2e-pending"
    ? ("best-effort" as const)
    : ("app" as const);
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
      permissions: {
        actions: "read",
        contents: "read",
        deployments: "read",
        discussions: "read",
        metadata: "read",
        packages: "read",
      },
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
      permissions: {
        actions: "read",
        contents: "read",
        deployments: "read",
        discussions: "read",
        metadata: "read",
        organization_projects: "read",
        packages: "read",
      },
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

export function getE2EGitHubInstallations(
  userId: string,
): StoredGitHubInstallation[] {
  if (!Object.hasOwn(e2eGitHubInstallations, userId)) return [];
  return (
    e2eGitHubInstallations[userId as keyof typeof e2eGitHubInstallations] ?? []
  ).map((installation) => ({ ...installation }));
}

export function getE2ETodayJournal(
  userId: string,
  timeZone: string,
  now = new Date(),
): TodayJournal {
  const localDate = getLocalDayWindow(now, timeZone).localDate;
  const awaitingReconciliation = userId === "e2e-user";
  const activities =
    userId === "e2e-all"
      ? ([
          {
            deduplicationKey: "e2e:push:api",
            localDate,
            kind: "push",
            actorId: "7",
            actorLogin: "ada",
            repositoryId: "42",
            repositoryName: "acme/api",
            evidenceUrl:
              "https://github.com/acme/api/compare/1111111...2222222",
            visibility: "private",
            source: "github-webhook",
            subjectId: "push-api",
            subjectNumber: null,
            subjectTitle: "main",
            occurredAt: new Date(now.getTime() - 30 * 60 * 1000),
            observedAt: now,
            authoredBeforeDay: false,
            installationId: "10",
          },
          {
            deduplicationKey: "e2e:issue:web",
            localDate,
            kind: "issue-opened",
            actorId: "7",
            actorLogin: "ada",
            repositoryId: "43",
            repositoryName: "acme/web",
            evidenceUrl: "https://github.com/acme/web/issues/51",
            visibility: "public",
            source: "github-events",
            subjectId: "51",
            subjectNumber: 51,
            subjectTitle: "Polish Today filters",
            occurredAt: new Date(now.getTime() - 15 * 60 * 1000),
            observedAt: now,
            authoredBeforeDay: false,
            installationId: null,
          },
        ] satisfies ActivityRecord[])
      : [];
  return {
    localDate,
    timeZone,
    status: "complete",
    refreshedAt: awaitingReconciliation ? null : now,
    ...(awaitingReconciliation
      ? { awaitingReconciliation: true }
      : { storedAt: now, lastAttemptAt: now }),
    metrics: computeActivityMetrics(activities),
    activities,
  };
}

const e2eHistoricalActivity: ActivityRecord = {
  deduplicationKey: "e2e:history:issue:51",
  localDate: "2026-08-30",
  kind: "issue-opened",
  actorId: "7",
  actorLogin: "ada",
  repositoryId: "43",
  repositoryName: "acme/web",
  evidenceUrl: "https://github.com/acme/web/issues/51",
  visibility: "public",
  source: "github-events",
  subjectId: "51",
  subjectNumber: 51,
  subjectTitle: "Polish journal history",
  occurredAt: new Date("2026-08-30T17:00:00Z"),
  observedAt: new Date("2026-08-31T05:00:00Z"),
  authoredBeforeDay: false,
  installationId: null,
};

export function getE2EJournalHistory() {
  return [
    {
      localDate: "2026-08-30",
      timeZone: "America/Mexico_City",
      status: "corrected" as const,
      completeness: "complete" as const,
      finalizedAt: new Date("2026-08-31T12:00:00Z"),
      correctionCount: 1,
    },
  ];
}

export function getE2EHistoricalJournal(localDate: string) {
  if (localDate === "2026-08-29") {
    throw new Error("E2E journal-day render failure");
  }
  if (localDate !== "2026-08-30") return null;
  const correction: ActivityRecord = {
    ...e2eHistoricalActivity,
    deduplicationKey: "e2e:history:comment:99",
    kind: "issue-comment",
    subjectId: "99",
    subjectTitle: "Late review note",
    observedAt: new Date("2026-08-31T13:00:00Z"),
  };
  return {
    ...getE2EJournalHistory()[0]!,
    metrics: computeActivityMetrics([e2eHistoricalActivity]),
    narrative: {
      overview: "Opened and refined the journal history experience.",
      overviewEvidenceIds: ["evidence-1"],
      accomplishments: [],
      collaboration: [],
      inProgress: [],
    },
    evidence: [e2eHistoricalActivity],
    corrections: [correction],
    failure: null,
  };
}
