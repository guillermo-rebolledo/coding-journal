# Operating Coding Journal

This is the operations guide for a publicly signed-up deployment: what bounds
the cost, what stops when a provider breaks, what the logs may contain, and how
to answer "what is failing right now?" without an error-tracking vendor.

Coding Journal runs no Sentry, no session replay, and no third-party analytics
beyond Vercel's own. Everything below is either a Vercel platform feature or a
table in the product's own database.

## The four layers that bound cost

| Layer                     | Where it runs                  | What it bounds                                                |
| ------------------------- | ------------------------------ | ------------------------------------------------------------- |
| Vercel WAF                | Before the function is invoked | Anonymous traffic, by IP and client fingerprint               |
| Application budgets       | Inside each server action      | Signed-in requests, per user and product-wide                 |
| Queue concurrency         | Inside each queue consumer     | How many messages are processed at once                       |
| Provider circuit breakers | Before each outbound call      | How long a broken provider is allowed to keep costing retries |

Each layer answers a question the layer above it cannot. The WAF cannot see who
is signed in; the application cannot see an attack that never reaches a
function; a per-user budget cannot bound a backlog that the platform fans out;
and none of them notice that GitHub has been returning 500s for ten minutes.

## 1. Vercel WAF

The production configuration lives in
[`docs/operations/firewall-rules.json`](operations/firewall-rules.json) so it
is reviewed like code. It is applied through the CLI, not the dashboard.

```sh
pnpm dlx vercel link          # once per checkout
node scripts/print-firewall-commands.mjs    # stage every rule in log mode
vercel firewall diff
vercel firewall publish --yes
```

Roll a rule out in stages; a firewall sits in front of every request and a
loose condition can block real users:

1. **Log.** The command above stages every rule with `--action log`. It records
   matches and blocks nothing.
2. **Review.** Open
   `https://vercel.com/<team>/<project>/firewall/traffic?filter=<ruleId>` (rule
   ids come from `vercel firewall rules list --json`) and confirm only the
   intended traffic matches — no real sign-ins, no GitHub webhook deliveries,
   no uptime monitor.
3. **Enforce.** Re-run with `--enforce`, which stages the real action and the
   rate-limit parameters, then `vercel firewall diff` and publish again.

Two properties of the platform matter when reading the numbers: Vercel does not
bill for requests blocked by the WAF or by DDoS mitigation, and rate-limit
counters are **per region**, so a global limit can be exceeded by roughly the
number of regions serving traffic. The limits in the manifest are set with that
slack in mind.

The webhook rule is deliberately the loosest one. Deliveries are
signature-verified before any database work happens, GitHub delivers from
shared egress addresses, and GitHub does not redeliver automatically — a
delivery the firewall drops is an event the journal never sees.

## 2. Application budgets

`src/lib/rate-limit.ts` holds every policy; `src/lib/rate-limit-repository.ts`
holds the counter. Each policy is a fixed window in Postgres, one row per
policy and subject, incremented by a single atomic statement — the HTTP
database driver has no transactions, so a read-then-write would let two
simultaneous requests both believe they were the last one allowed.

| Policy                | Default        | Bounds                                          |
| --------------------- | -------------- | ----------------------------------------------- |
| `journal-refresh`     | 12 per 15 min  | Refreshing Today, per user                      |
| `finalization-retry`  | 5 per hour     | Re-running a day's reconciliation and narrative |
| `narrative-redaction` | 20 per hour    | Redacting a frozen narrative                    |
| `account-deletion`    | 5 per hour     | Deletion attempts, per user                     |
| `github-sync-daily`   | 20 000 per day | Reconciliations product-wide                    |

Subjects are keyed digests, never user ids, so an operational table cannot
re-identify a deleted account. Every limit is overridable per deployment — see
[Environment variables](environment-variables.md).

Two older budgets sit alongside these and are unchanged: the 15-minute
reconciliation cooldown per user and day (`journal_reconciliation`), and the AI
narrative's per-user, global-daily and monthly-spend limits
(`journal_summary_generation`).

**Every refusal reads the same way**: what happened, what still works, when it
returns. It is rendered in the same slot and type role as any other state, as a
status rather than an alert, because nothing about the recorded journal has
become unavailable — see frames 1n and 1o of the design reference.

## 3. Queue concurrency

Both consumers take a numbered slot from `service_lease` before doing anything.
When every slot is held the message goes back to the queue with a short delay
instead of being processed, so a backlog is shaped rather than fanned out.

- `github-webhook-deliveries`: 10 slots, 120-second lease
- `journal-finalization`: 5 slots, 300-second lease

A lease expires on its own, so an instance that dies mid-message costs one lease
period rather than a permanently lost slot.

## 4. Provider circuit breakers

`service_circuit` holds one row per outbound service. Five failures inside five
minutes open the circuit for two minutes; the finalization consumer checks both
circuits **before** it claims a day, and the summary provider checks its own
before every call. An open circuit makes the message reschedule rather than
fail, so a provider outage delays days instead of exhausting their retries.

GitHub failures are recorded from the reconciliation's own diagnostics, and
only for stages that represent a provider call — a user with no access token is
a per-user condition and must never open a shared circuit.

## Telemetry and what logs may contain

Every operational log line goes through `logServiceEvent`
(`src/lib/telemetry.ts`) and is one JSON object prefixed with
`[coding-journal]`. Filter Vercel's runtime logs on that prefix.

Fields are an allow-list: `category`, `event`, `outcome`, `user`, `job`,
`service`, `stage`, `reason`, `errorName`, `errorMessage`, `attempt`, `count`,
`limit`, `remaining`, `retryAfterSeconds`, `durationMs`. Anything else a caller
passes is dropped before serialization.

- `user` and `job` are keyed digests. They correlate a day's activity and
  cannot be reversed without the deployment secret.
- `errorMessage` is the only free-form field, and it is scrubbed for URLs,
  addresses, credentials and `owner/name` paths, then truncated.
- Credentials, private repository names, GitHub payloads, AI inputs and
  narrative text are never logged, by construction rather than by convention.

Categories: `request`, `sync`, `queue`, `provider`, `budget`, `finalization`,
`privacy`.

## Vercel Analytics and Speed Insights

Both are enabled in `src/app/layout.tsx`. Neither reads page content, and both
are cookieless, but a URL alone would say which journal day someone opened, so
`sanitizeAnalyticsUrl` rewrites `/journal/history/2026-08-30` to
`/journal/history/[localDate]` and drops every query string and fragment before
a measurement leaves the browser.

Enable both products in the Vercel dashboard (Project → Analytics, Project →
Speed Insights). Until they are enabled the components are inert.

## The operational view

`GET /api/ops/health`, authorized with the same `CRON_SECRET` bearer token as
the scheduled dispatches:

```sh
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://<canonical-domain>/api/ops/health | jq
```

It answers all five failure surfaces as counts, with no user identifier, no
repository, no evidence and no narrative in the response:

| Field                           | Read it as                                                    |
| ------------------------------- | ------------------------------------------------------------- |
| `sync.error`                    | Days whose last reconciliation failed in the last 24 hours    |
| `queue.webhookDeliveries`       | Deliveries by status; `poisoned` and `enqueue-failed` are bad |
| `queue.activeSlots`             | Slots in use against the limit; at the limit means a backlog  |
| `provider.circuits`             | An `open` circuit names the provider that is currently down   |
| `provider.summaryGenerations`   | Narrative claims by status; `failed` and `rejected` are cost  |
| `budget.githubSyncDaily`        | Product-wide reconciliations used against the daily budget    |
| `budget.summaryMonthlySpendUsd` | AI spend this month against the configured ceiling            |
| `finalization.byStatus`         | `recoverable-error` days waiting for a retry                  |
| `privacy.failedOperations`      | Revocation, retention or deletion work that did not complete  |

## Triage without Sentry

| Symptom                              | Look at                                                           | Likely cause and action                                                                  |
| ------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| People report Today not updating     | `sync.error`, `provider.circuits`                                 | GitHub outage or expired tokens. An open circuit closes itself after the cooldown.       |
| Webhook events missing               | `queue.webhookDeliveries.enqueue-failed`                          | Queue publish failing — usually the OIDC token or a queue outage. Deliveries are stored. |
| Finalized days stuck                 | `finalization.byStatus["recoverable-error"]`, `queue.activeSlots` | Provider failure or a saturated consumer. Users can retry from a day's page.             |
| AI narratives stopped appearing      | `budget.summaryMonthlySpendUsd`, `provider.summaryGenerations`    | The monthly ceiling was reached, or the summary circuit is open. The journal is intact.  |
| Invocation bill climbing             | `budget.githubSyncDaily`, WAF traffic view                        | Tighten a WAF rate limit first; lower `RATE_LIMIT_GITHUB_SYNC_DAILY` second.             |
| Deletion or retention not completing | `privacy.failedOperations`                                        | Inspect `privacy_operation`; the hourly job is idempotent and retries.                   |
| A single user hammering the app      | `[coding-journal]` logs, `category:"budget"`                      | The per-user budget is already refusing; the `user` digest correlates their requests.    |

## Load and safety checks

`pnpm test` covers the behaviour this guide describes: the counter holds its
limit under a burst of simultaneous requests, slots are handed out exactly
once, a circuit opens and closes on schedule, a consumer stops before GitHub
and before the summary provider when the matching circuit is open, refusals
render as accessible status states without degrading the recorded journal, and
neither the log records nor the operations view contain anything about a
person's journal.
