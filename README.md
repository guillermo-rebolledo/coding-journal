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
- Account permission → Email addresses: Read-only

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

1. Import the repository into Vercel and connect a Neon project.
2. Add `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` to Production, Preview, and Development as appropriate.
3. Set `BETTER_AUTH_URL` to the canonical deployment origin, without a trailing slash.
4. Add `https://<your-domain>/api/auth/callback/github` to the GitHub App callback URLs.
5. Run `pnpm db:migrate:production` with the production `DATABASE_URL` before the first deployment and whenever a new migration lands.
6. Deploy with the standard `pnpm build` command.

Never expose GitHub credentials or provider tokens through `NEXT_PUBLIC_*` variables. Better Auth encrypts OAuth tokens before database storage, and browser-facing token endpoints are disabled.

## License

MIT — see [LICENSE](LICENSE).
