# Coding Journal

Coding Journal turns a developer’s GitHub activity into a calm daily record: a
dated page of what the day actually contained, honest about what it could not
see, with an optional AI summary that never replaces the record underneath it.
Nothing is scored, nothing is shared, and 30 days later the activity is deleted.

It is a single-person product. There are no teams, no profiles, no export of
anyone else's work, and no sharing of any kind.

**Trust pages:** [Privacy](src/app/privacy), [Terms](src/app/terms) and
[Data access](src/app/data-access) are rendered from `src/content/trust/` and
state exactly what is read, stored, processed and deleted.

## Stack

- Next.js 16 and strict TypeScript
- MaterialCN components installed from the `@materialcn` shadcn registry
- Better Auth with GitHub
- Neon Postgres through Drizzle and the Neon serverless driver
- Vitest, Testing Library, and Playwright

## Design

The approved look and feel is `docs/design/Coding Journal look and feel.html`.
Open it in a browser and check UI work against it; `docs/design/README.md`
indexes its frames and states the rules it establishes (lists before cards, one
display-scale element per screen, the AI narrative as the only tertiary
surface, and semantic roles so all four palettes keep working in light and
dark).

## Local setup

Use Node 24 and pnpm through Corepack:

```sh
nvm install
nvm use
corepack enable
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`. Create a Neon database and put its pooled, SSL-enabled connection string in `DATABASE_URL`.

The local Drizzle commands use Next.js’s development environment-file precedence: existing process variables, `.env.development.local`, `.env.local`, `.env.development`, then `.env`. Keep a single authoritative `DATABASE_URL` locally so the app and migrations cannot point at different databases. The first `pnpm db:migrate` creates the Better Auth tables, including `verification`; run it before attempting GitHub sign-in.

Configure the shared GitHub App with:

- Homepage URL: `http://localhost:3000`
- Callback URL: `http://localhost:3000/api/auth/callback/github`
- Setup URL: `http://localhost:3000/api/github/callback`
- Redirect on update: enabled
- Account permission → Email addresses: Read-only
- Repository permission → Contents: Read-only
- Repository permission → Discussions: Read-only
- Repository permission → Actions: Read-only
- Repository permission → Deployments: Read-only
- Repository permission → Packages: Read-only
- Repository permission → Metadata: Read-only (GitHub grants this automatically)
- Organization permission → Projects: Read-only (preview, organization installs only)
- Subscribe to repository events: Create, Delete, Discussion, Discussion comment,
  Deployment review, Deployment status, Issues, Issue comment, Pull request,
  Pull request review, Pull request review comment, Push, Registry package,
  Release, and Workflow run
- Subscribe to organization events: Projects v2 and Projects v2 item (public preview)

Set `GITHUB_APP_SLUG` to the slug in the app's public URL. Keep every other
repository permission at read-only or no access. Coding Journal rejects an
installation that reports write, administration, secrets, security, or billing
access. Enable expiring user access tokens in the GitHub App: Better Auth keeps
the user and refresh tokens encrypted at rest and refreshes them only on the
server. Coding Journal does not persist GitHub installation access tokens.

Ref lifecycle coverage is source-specific: best-effort journals use GitHub's
Events feed, while journals with an active App installation use signed create
and delete webhooks. GitHub does not include an action timestamp or shared event
identifier in those webhook payloads, so Coding Journal intentionally avoids
overlapping the two sources for refs. Release publication and Discussion
creation retain content-derived identities and deduplicate across both sources.

The email permission lets Better Auth retrieve verified private addresses. If GitHub still omits an address, Coding Journal creates a non-routable `.invalid` identity; no password or deliverable fallback mailbox is required.

## Architecture vocabulary

The words below mean one thing throughout the code, the tests, the issues and
the interface. Using a synonym is a signal that something has drifted.

| Term                | Meaning                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Activity record** | One normalized thing that happened — action, time, repository, subject, evidence link. The unit of the journal.   |
| **Day**             | A calendar day in the user's IANA time zone, from local midnight to local midnight.                               |
| **Journal**         | The activity records of one day, with their metrics, completeness and narrative.                                  |
| **Reconciliation**  | Reading GitHub and merging what it returns into the stored day. Bounded by a 15-minute per-user cooldown.         |
| **Completeness**    | What the day could see: complete, partial access, limited activity, best-effort, pending, disconnected.           |
| **Best-effort**     | No GitHub App installation. Coverage is whatever the public events feed exposes; private work may be missing.     |
| **Finalization**    | Closing a day at local midnight. A finalized day is immutable.                                                    |
| **Correction**      | Evidence that arrived after finalization, appended below the narrative and dated. The narrative is not rewritten. |
| **Narrative**       | The optional AI summary. Read-only, validated against the day's own evidence, discarded if it fails validation.   |
| **Redaction**       | Removing subjects from stored activity when access to a private repository is withdrawn, retaining the counts.    |
| **Evidence link**   | A link back to GitHub that proves a claim. Every narrative claim carries one.                                     |
| **Budget**          | A per-user or product-wide limit. A refused request says what happened, what still works, and when it returns.    |

## Test strategy

Tests are written at application boundaries and describe behaviour a user could
notice. External systems are mocked only at their narrow adapters; product
collaborators are never mocked.

| Layer             | Runner                       | What it covers                                                              |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------- |
| Boundary and unit | Vitest (`pnpm test`)         | Server components, server actions, route handlers, and the domain modules.  |
| Integration       | Vitest + PGlite              | Repositories against real Postgres semantics (`*.integration.test.ts`).     |
| Content           | Vitest                       | What the trust pages must state, asserted against the documents themselves. |
| Browser           | Playwright (`pnpm test:e2e`) | The smoke journey, accessibility, and responsive behaviour.                 |

Browser tests carry a fixture session cookie recognised only when
`E2E_AUTH_MODE=true` and `NODE_ENV` is not `production`; every route, guard,
action and redirect below it is the production path. See
[The public release gate](docs/release-gate.md) for how to run the same flow
against a real deployment, and [Accessibility](docs/accessibility.md) for what
is checked automatically and what is reviewed by hand.

## Known limitations

These are properties of the product, stated so nobody has to discover them:

- **The journal is not a complete record.** It sees what the access you granted
  allows. Without an installation it is best-effort, and private or delayed work
  may be missing entirely. Where the journal and GitHub disagree, GitHub is right.
- **It is not a system of record.** Not for performance review, compensation,
  compliance, or any legal or contractual purpose.
- **Activity is deleted after 30 days**, on purpose. There is no backup and
  nothing to restore from.
- **GitHub's events feed is delayed and truncated by GitHub.** Where webhook and
  events coverage would overlap ambiguously — ref creation and deletion — one
  source is used deliberately rather than guessing across both.
- **Organization Projects is a GitHub public preview** and is labelled
  best-effort wherever it contributes.
- **Narratives can be wrong.** They are validated against the day's evidence and
  discarded when validation fails, but a language model wrote them; the recorded
  activity below is the record.
- **Summaries are quota-bounded and can pause service-wide** while an operator
  budget clears. Nothing else about the day is affected.
- **No error-tracking vendor.** Triage runs off structured logs and
  `/api/ops/health` — see [Operating Coding Journal](docs/operations.md).
- **English only**, and no notifications, billing or sharing.

## Commands

```sh
pnpm dev          # local development
pnpm typecheck    # strict TypeScript
pnpm lint         # ESLint
pnpm format       # formatting check
pnpm test         # deterministic application-boundary tests
pnpm test:e2e     # mobile and desktop browser smoke tests
pnpm build        # production build
pnpm db:generate  # generate migrations after schema changes
pnpm db:migrate   # apply migrations with development env precedence
pnpm db:migrate:production # apply migrations with production env precedence
```

If sign-in reports `relation "verification" does not exist`, confirm that `DATABASE_URL` targets the intended Neon database, run `pnpm db:migrate`, and restart the development server.

## MaterialCN registry

`components.json` makes MaterialCN authoritative at `@materialcn`. UI primitives in this slice were installed from that registry and are committed as source, following the shadcn model. Add another primitive with:

```sh
pnpm exec shadcn add @materialcn/<component>
```

## Deploying to Vercel

See [Environment variables and deployment secrets](docs/environment-variables.md)
for the complete local, Vercel, GitHub App, and GitHub Actions setup and rotation
guide.

1. Import the repository into Vercel and connect a Neon project.
2. Add `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET`, and `CRON_SECRET` to Production, Preview, and Development as appropriate.
3. Set `BETTER_AUTH_URL` to the stable canonical deployment origin, without a trailing slash. Do not use a generated per-deployment URL.
4. Add `https://<your-domain>/api/auth/callback/github` to the GitHub App callback URLs and `https://<your-domain>/api/github/callback` as its setup URL. Enable redirect on update.
5. Run `pnpm db:migrate:production` with the production `DATABASE_URL` before the first deployment and whenever a new migration lands.
6. Deploy with the standard `pnpm build` command.

Coding Journal adds Vercel’s exact deployment, branch, and production URLs to Better Auth’s trusted origins from Vercel’s system environment variables. It does not trust a broad `*.vercel.app` wildcard.

Never expose GitHub credentials or provider tokens through `NEXT_PUBLIC_*` variables. Better Auth encrypts OAuth tokens before database storage, and browser-facing token endpoints are disabled.

## Operating the service

[Operating Coding Journal](docs/operations.md) is the guide for a public
deployment: the Vercel WAF configuration (checked in at
`docs/operations/firewall-rules.json`), the per-user and product-wide request
budgets, queue concurrency, the provider circuit breakers, what the structured
logs may contain, and the `/api/ops/health` view that answers "what is failing?"
without an error-tracking vendor.

Vercel Analytics and Speed Insights are enabled in the app, with every
measurement reduced to a route before it leaves the browser — a journal date
never becomes a URL Vercel receives. Enable both products in the Vercel
dashboard; until then the components are inert.

## Releasing

[The public release gate](docs/release-gate.md) is the checklist and the proof
for a public deployment: the trust pages, the documented setup, the end-to-end
smoke flow, accessibility, responsive coverage, the browser matrix, the
MaterialCN gaps, and what is deliberately out of scope.

## Contributing

See [CONTRIBUTING](CONTRIBUTING.md) for the workflow and the testing
conventions, [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md) for expected behaviour, and
[SECURITY](SECURITY.md) for reporting a vulnerability privately.

## License

MIT — see [LICENSE](LICENSE). You are free to run your own instance.
