import type { TrustDocument } from "@/content/trust/types";

/**
 * Privacy — frame 1m. It states the commitments; the specifics of permissions,
 * retention and quotas live once, on Data access, and are linked rather than
 * restated so the two documents cannot drift apart.
 */
export const privacyDocument: TrustDocument = {
  slug: "privacy",
  navLabel: "Privacy",
  title: "Privacy",
  description:
    "What Coding Journal collects, why, where it is processed, how long it is kept, and how to take it back.",
  lede: "Coding Journal is a private record for one person. There is no sharing, no team view, no profile and no advertising, and there is nothing in the product that makes your journal visible to anyone else.",
  lastUpdated: "1 September 2026",
  sections: [
    {
      id: "what-is-collected",
      heading: "What is collected",
      blocks: [
        {
          kind: "definitions",
          items: [
            {
              term: "Your GitHub identity",
              description:
                "Account id, login, display name, avatar URL and verified email address, used to identify your account and nothing else.",
            },
            {
              term: "Your time zone",
              description:
                "The IANA time zone you confirm during onboarding, which defines where your calendar day starts and ends.",
            },
            {
              term: "Repository activity",
              description:
                "Normalized records of your own activity in the repositories you granted — action, time, repository, subject line and a link back to GitHub. Never source code, diffs, logs or secrets.",
            },
            {
              term: "Daily narratives",
              description:
                "The optional AI summary of a day, if narratives are enabled for your account.",
            },
            {
              term: "Operational counters",
              description:
                "Rate-limit and budget counters keyed by a salted opaque identifier, so an operational table cannot re-identify a deleted account.",
            },
          ],
        },
      ],
    },
    {
      id: "why-and-where",
      heading: "Why it is collected, and where it is processed",
      blocks: [
        {
          kind: "paragraph",
          text: "Everything above exists to render your journal. There is no secondary use: no profiling, no scoring, no ranking, no benchmarking against other people, and no sale or sharing of personal data with anyone.",
        },
        {
          kind: "definitions",
          items: [
            {
              term: "GitHub",
              description:
                "The source of your identity and your activity, read through read-only permissions you grant and can withdraw.",
            },
            {
              term: "Neon",
              description:
                "The Postgres database that stores your journal, reached over TLS.",
            },
            {
              term: "Vercel",
              description:
                "Hosting, request queues and scheduled jobs. Vercel Analytics and Speed Insights are reduced to a route before any measurement leaves the browser, so a journal date never becomes a URL Vercel receives.",
            },
            {
              term: "OpenAI",
              description:
                "Optional, and only for the daily narrative. A capped snapshot of the day's already-visible events is sent to be summarized and is not used to train models. See Data access for the detail.",
            },
          ],
        },
        {
          kind: "paragraph",
          text: "There is no error-tracking vendor, no session recording, no advertising network and no third-party analytics beyond the two Vercel products named above.",
        },
      ],
    },
    {
      id: "retention",
      heading: "How long it is kept",
      blocks: [
        {
          kind: "paragraph",
          text: "Activity records are retained for 30 days and then deleted by a daily sweep. Finalized days keep the summary they were recorded with. Your account, time zone and GitHub connection are kept until you delete your account.",
        },
      ],
    },
    {
      id: "your-controls",
      heading: "Your controls",
      blocks: [
        {
          kind: "list",
          items: [
            "Grant no repository access at all, and use the journal in best-effort mode.",
            "Narrow or withdraw repository access on GitHub at any time; it takes effect immediately.",
            "Redact a frozen narrative on a finalized day.",
            "Delete your account from Settings. It removes every day, narrative, correction and activity record and ends every session, immediately and irreversibly. It also asks GitHub to revoke the authorization grant, best-effort.",
          ],
        },
        {
          kind: "paragraph",
          text: "Withdrawing access never deletes what has already been recorded, and deleting your account never leaves a copy behind. They are separate actions and both are yours to take.",
        },
      ],
    },
    {
      id: "security",
      heading: "Security",
      blocks: [
        {
          kind: "list",
          items: [
            "Read-only GitHub permissions only. An installation reporting write, administration, secrets, security or billing access is rejected.",
            "Expiring GitHub user tokens, encrypted at rest, refreshed only on the server and never exposed to the browser.",
            "GitHub webhook deliveries are verified against a signing secret before they are processed.",
            "Every journal page is server-rendered behind a session check; no journal data is reachable without one.",
            "Report a suspected vulnerability privately through the repository's security advisory flow rather than a public issue.",
          ],
        },
      ],
    },
    {
      id: "changes-and-contact",
      heading: "Changes and contact",
      blocks: [
        {
          kind: "paragraph",
          text: "This page carries the date it was last changed. Coding Journal is open source, so every change to it is visible in the repository's history alongside the code it describes. Questions and corrections belong in a GitHub issue; suspected vulnerabilities belong in a private security advisory.",
        },
      ],
    },
  ],
};
