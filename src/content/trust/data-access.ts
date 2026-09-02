import type { TrustDocument } from "@/content/trust/types";

/**
 * Data access — the reference document of frame 1m. Privacy and Terms are
 * written against it rather than restating it, so there is exactly one place
 * where a permission, a retention window or a quota is described.
 */
export const dataAccessDocument: TrustDocument = {
  slug: "data-access",
  navLabel: "Data access",
  title: "Data access and GitHub permissions",
  description:
    "Exactly what Coding Journal reads from GitHub, what it stores, for how long, and what happens when you take access away.",
  lede: "This page explains exactly what Coding Journal reads, what it keeps, and what happens when you take access away. It is written to be read before you authorize anything.",
  lastUpdated: "1 September 2026",
  sections: [
    {
      id: "github-access",
      heading: "What GitHub access is used for",
      blocks: [
        {
          kind: "paragraph",
          text: "Signing in uses your GitHub identity and verified email address, nothing else. Reading repository activity is a separate, optional GitHub App installation that you scope to selected repositories or all repositories. You can use Coding Journal without ever installing it.",
        },
        {
          kind: "definitions",
          items: [
            {
              term: "Contents · read",
              description:
                "Pushes, ref changes and releases in the repositories you selected.",
            },
            {
              term: "Discussions · read",
              description: "Discussion creation, comments and answers.",
            },
            {
              term: "Actions · read",
              description:
                "Workflow runs you dispatched, reran or approved, and their outcome.",
            },
            {
              term: "Deployments · read",
              description: "Deployment outcomes linked to your activity.",
            },
            {
              term: "Packages · read",
              description: "Registry package publications.",
            },
            {
              term: "Metadata · read",
              description:
                "Repository names and visibility. GitHub grants this automatically with any other read permission.",
            },
            {
              term: "Projects · read",
              description:
                "Organization Projects v2 items, where the installation is on an organization. This source is a public preview and is treated as best-effort.",
            },
            {
              term: "Email addresses · read",
              description:
                "Your verified address, so Better Auth can identify your account. It is never used to send you mail.",
            },
            {
              term: "Never requested",
              description:
                "Write access, administration, secrets, security alerts and billing. An installation that reports any of these is rejected rather than used.",
            },
          ],
        },
        {
          kind: "paragraph",
          text: "GitHub user tokens are expiring, held only on the server, and encrypted before storage. Installation access tokens are never persisted. No token is ever exposed to the browser.",
        },
      ],
    },
    {
      id: "what-is-stored",
      heading: "What is stored, and for how long",
      blocks: [
        {
          kind: "paragraph",
          text: "Coding Journal stores normalized activity records — what happened, when, in which repository, with a link back to GitHub — for 30 days. It never stores source code, diffs, logs, secrets, or the contents of private repositories.",
        },
        {
          kind: "paragraph",
          text: "A retention sweep runs daily and deletes activity older than 30 days. Finalized days keep the time zone, completeness label, metrics, narrative and evidence links they were recorded with; the underlying activity rows still expire on the same 30-day schedule, which is why an old day can show counts whose individual rows are gone.",
        },
        {
          kind: "paragraph",
          text: "Operational logs identify you only by a salted opaque identifier. They record what happened and which stage failed — never a repository name, a commit subject, a journal date, or a token.",
        },
      ],
    },
    {
      id: "summaries",
      heading: "Where summaries are processed",
      blocks: [
        {
          kind: "paragraph",
          text: "The daily narrative is optional and is the only part of Coding Journal that leaves this service. When it is enabled, a compact snapshot of the day — action, repository, subject line and timestamp for the events already shown on screen — is sent to OpenAI's API to be summarized. Source code, diffs and repository contents are never part of that snapshot, and the snapshot is capped in size before it is sent.",
        },
        {
          kind: "paragraph",
          text: "OpenAI is used as an API processor: the request is not used to train models. A generated summary is validated against the day's own evidence before it is shown, and a summary that fails validation is discarded rather than displayed. Nothing unverified is ever shown.",
        },
        {
          kind: "paragraph",
          text: "The deterministic journal — metrics, activity and evidence links — is complete and usable with the narrative switched off, unavailable, or refused by a quota. If the operator has not configured an OpenAI key, no data is sent anywhere and every other feature behaves normally.",
        },
        {
          kind: "definitions",
          items: [
            {
              term: "Per day, per person",
              description:
                "Up to 12 summaries a day, with a 15-minute cooldown between generations.",
            },
            {
              term: "Service-wide",
              description:
                "A daily generation budget and a monthly spend budget. When either is reached, summaries pause for everyone until the budget clears.",
            },
            {
              term: "When a quota refuses",
              description:
                "The narrative slot says what happened, what still works and when it returns. Metrics, activity and history are unaffected.",
            },
          ],
        },
      ],
    },
    {
      id: "completeness",
      heading: "Limits on completeness",
      blocks: [
        {
          kind: "paragraph",
          text: "Coding Journal is an honest record, not a complete one. Every day states which repositories it covered and which sources were delayed or unavailable, and a day that could not be fully reconciled says so in words rather than in colour.",
        },
        {
          kind: "list",
          items: [
            "Without a GitHub App installation the journal is best-effort: it sees only what GitHub's public events feed exposes, so private and delayed work may be missing entirely.",
            "With an installation, coverage is exactly the repositories you selected. Work in repositories outside the installation is not read.",
            "GitHub's events feed is delayed and truncated by GitHub itself. Where webhook and events coverage would overlap ambiguously — ref creation and deletion in particular — Coding Journal deliberately uses one source rather than guessing across both.",
            "Organization Projects is a GitHub public preview and is labelled best-effort wherever it contributes.",
            "A day is closed at local midnight in your chosen time zone. Evidence that arrives after that is appended as a dated correction below the narrative; the narrative itself is never rewritten.",
            "If GitHub cannot be reached, everything already stored stays readable and the day is marked as not yet reconciled rather than shown as empty.",
          ],
        },
      ],
    },
    {
      id: "revoking-access",
      heading: "Revoking access",
      blocks: [
        {
          kind: "paragraph",
          text: "Access is yours to withdraw at any time, on GitHub, without asking Coding Journal first. Uninstalling the GitHub App, suspending it, or removing repositories from it all take effect immediately.",
        },
        {
          kind: "list",
          items: [
            "Remove repositories from the installation, or uninstall the app, at github.com/settings/installations. Organization installations are managed by an organization owner.",
            "Revoke the sign-in authorization at github.com/settings/applications. This ends your ability to sign in and invalidates the stored token.",
            "Coding Journal is told about each of these by a signed GitHub webhook and stops recording new activity for the affected repositories at once.",
            "Days already recorded are retained and stay readable. Losing access removes future coverage; it does not silently rewrite your history.",
          ],
        },
      ],
    },
    {
      id: "redaction-and-deletion",
      heading: "Redaction and deletion",
      blocks: [
        {
          kind: "paragraph",
          text: "When access to a private repository is removed, Coding Journal redacts the subjects of that repository's stored activity — the titles, branch names and comment text you can no longer prove you may see — while retaining the counts, so past days stay honest about how much happened without disclosing what it was. A redaction is correct behaviour rather than an error, and it is labelled neutrally.",
        },
        {
          kind: "paragraph",
          text: "You can also redact a frozen narrative yourself from a finalized day, if a summary quotes something you would rather not keep.",
        },
        {
          kind: "paragraph",
          text: "Deleting your account from Settings requires typing the word delete, and then removes every journal day, narrative, correction and stored activity record, ends every session, and revokes Coding Journal's GitHub authorization grant. Deletion runs to completion in the background — you can close the page — and retries on its own if part of it fails. Nothing is partially exposed while it runs.",
        },
        {
          kind: "paragraph",
          text: "Deletion cannot uninstall the GitHub App for you, because that lives on your GitHub account. After deleting, remove the installation on GitHub if you want to; Coding Journal keeps nothing that could use it.",
        },
      ],
    },
  ],
};
