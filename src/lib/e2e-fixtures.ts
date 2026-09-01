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

export function isE2EJournalUser(userId: string) {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true" &&
    userId.startsWith("e2e-")
  );
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
import {
  computeActivityMetrics,
  type ActivityRecord,
} from "@/lib/github-activity";
