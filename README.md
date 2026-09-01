# Coding Journal

Coding Journal turns a developer’s GitHub activity into a calm daily record. This first deployable slice includes a responsive Material 3 landing page, persistent system/light/dark themes, GitHub authentication, and a protected journal shell.

## Stack

- Next.js 16 and strict TypeScript
- MaterialCN components installed from the `@materialcn` shadcn registry
- Better Auth with GitHub
- Neon Postgres through Drizzle and the Neon serverless driver
- Vitest, Testing Library, and Playwright

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
2. Add `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_SLUG`, and `GITHUB_WEBHOOK_SECRET` to Production, Preview, and Development as appropriate.
3. Set `BETTER_AUTH_URL` to the stable canonical deployment origin, without a trailing slash. Do not use a generated per-deployment URL.
4. Add `https://<your-domain>/api/auth/callback/github` to the GitHub App callback URLs and `https://<your-domain>/api/github/callback` as its setup URL. Enable redirect on update.
5. Run `pnpm db:migrate:production` with the production `DATABASE_URL` before the first deployment and whenever a new migration lands.
6. Deploy with the standard `pnpm build` command.

Coding Journal adds Vercel’s exact deployment, branch, and production URLs to Better Auth’s trusted origins from Vercel’s system environment variables. It does not trust a broad `*.vercel.app` wildcard.

Never expose GitHub credentials or provider tokens through `NEXT_PUBLIC_*` variables. Better Auth encrypts OAuth tokens before database storage, and browser-facing token endpoints are disabled.

## License

MIT — see [LICENSE](LICENSE).
