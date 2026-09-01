# Environment variables and deployment secrets

This guide is the source of truth for configuring Coding Journal locally, on
Vercel, and in GitHub. It separates values the application owns from values
that Vercel, Next.js, Playwright, and GitHub Actions provide automatically.

Never commit a populated environment file. This repository ignores `.env` and
`.env.*` except for `.env.example`, and no secret belongs in a `NEXT_PUBLIC_*`
variable.

## Required application variables

The application fails when any variable required by the code path being used is
missing. Configure all seven values for a complete deployment.

| Variable                | Local value                                                        | Production value                                                                                  | Secret?                  | Purpose                                                                      |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `DATABASE_URL`          | Pooled connection string for a development Neon database or branch | Pooled connection string for the production Neon database or branch                               | Yes                      | Connects Drizzle, Better Auth, journal storage, and migrations to PostgreSQL |
| `BETTER_AUTH_SECRET`    | A unique local 32-byte-or-longer random value                      | A different, long-lived production random value                                                   | Yes                      | Encrypts and signs Better Auth data, including stored GitHub OAuth tokens    |
| `BETTER_AUTH_URL`       | `http://localhost:3000`                                            | The canonical HTTPS origin, such as `https://journal.example.com`, with no path or trailing slash | No                       | Sets Better Auth's public base URL and one trusted origin                    |
| `GITHUB_CLIENT_ID`      | Client ID of the GitHub App used locally                           | Client ID of the production GitHub App                                                            | No, but keep server-side | Identifies the GitHub App during OAuth sign-in                               |
| `GITHUB_CLIENT_SECRET`  | Client secret paired with the local client ID                      | Client secret paired with the production client ID                                                | Yes                      | Exchanges GitHub OAuth authorization codes for user tokens                   |
| `GITHUB_APP_SLUG`       | Slug from `https://github.com/apps/<slug>`                         | Production app's slug                                                                             | No                       | Builds the GitHub App installation URL                                       |
| `GITHUB_WEBHOOK_SECRET` | Random value configured on the local GitHub App                    | Random value configured on the production GitHub App                                              | Yes                      | Verifies the HMAC signature on GitHub webhook deliveries                     |

Use separate local and production Neon databases and separate
`BETTER_AUTH_SECRET` values. A shared GitHub App can support local and
production OAuth callback URLs, but a GitHub App has only one setup URL and one
webhook URL. For full installation and webhook testing locally, use a separate
development GitHub App. If local work only needs sign-in, the production app can
be shared by adding the local OAuth callback URL.

## Values you do not create

Do not manually add these values to Vercel or GitHub Actions.

| Variable                        | Owner                       | Notes                                                                                                                                                                         |
| ------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERCEL_OIDC_TOKEN`             | Vercel                      | Short-lived credential used by Vercel Queues. Vercel injects it in deployments; `vercel env pull` obtains a local token. Never copy it to GitHub or create a permanent value. |
| `VERCEL_URL`                    | Vercel                      | Exact deployment host, without a scheme. The app adds it to Better Auth's trusted origins.                                                                                    |
| `VERCEL_BRANCH_URL`             | Vercel                      | Stable branch deployment host, without a scheme.                                                                                                                              |
| `VERCEL_PROJECT_PRODUCTION_URL` | Vercel                      | Stable production host, without a scheme.                                                                                                                                     |
| `VERCEL_REGION`                 | Vercel                      | Used automatically by the queue SDK. Local queue work falls back to `iad1`.                                                                                                   |
| `VERCEL_DEPLOYMENT_ID`          | Vercel                      | Used automatically to associate queue delivery with a deployment.                                                                                                             |
| `NODE_ENV`                      | Next.js and package scripts | Do not set it in `.env.local`. Next.js and the repository scripts select `development`, `test`, or `production`.                                                              |
| `CI`                            | GitHub Actions              | Changes Playwright retries, reporter, browser selection, and `forbidOnly`.                                                                                                    |

The following are test controls, not deployment configuration:

- `E2E_AUTH_MODE=true` enables deterministic test fixtures only when
  `NODE_ENV` is not `production`. Playwright supplies it to the server it starts.
- `E2E_PORT` changes the Playwright development-server port from `3000`.
- `E2E_EXTERNAL_SERVER` tells Playwright to test an already running server.
- `VERCEL_QUEUE_DEBUG=1` enables queue SDK diagnostics temporarily. Do not leave
  it enabled in production unless you are actively investigating a problem.

## Generate or obtain each value

### `DATABASE_URL`

1. Create a Neon project for production.
2. Create a separate Neon project or database branch for local development.
3. In each Neon project, select **Connect**.
4. Enable **Connection pooling** and copy the complete connection string. A
   pooled Neon hostname contains `-pooler`; keep the generated
   `sslmode=require` and `channel_binding=require` query parameters.
5. Store the development string only in `.env.local` or Vercel's Development
   environment. Store the production string only in Vercel Production and, if a
   workflow will run migrations, a protected GitHub `production` environment.

Copy the generated value instead of assembling it by hand. Database passwords
can contain characters that require URL encoding.

### `BETTER_AUTH_SECRET`

Generate two independent values, one for local development and one for
production:

```sh
openssl rand -base64 32
```

Each command prints a new value. Copy it directly into the relevant secret
store. Do not reuse the webhook secret or database password.

Treat the production value as long-lived. The current app uses Better Auth's
single-secret configuration, so replacing it can invalidate sessions and make
previously encrypted OAuth tokens unreadable. Plan a user reauthentication
window before rotating it.

### `BETTER_AUTH_URL`

This value is not generated:

```dotenv
# Local
BETTER_AUTH_URL=http://localhost:3000

# Production example
BETTER_AUTH_URL=https://journal.example.com
```

Use only the origin: scheme plus hostname and an optional port. Do not include a
path, query string, fragment, or trailing slash. Production must use the stable
custom domain or stable Vercel production domain, never a commit-specific
deployment URL.

### GitHub App values

Create a dedicated production GitHub App and, if you need end-to-end local
installation/webhook testing, a second development GitHub App.

1. In GitHub, open your profile or organization **Settings**.
2. Open **Developer settings > GitHub Apps** and select **New GitHub App**. For
   an existing app, select **Edit**.
3. Configure the URLs for the target environment:

   | GitHub App field | Local development app                               | Production app                                        |
   | ---------------- | --------------------------------------------------- | ----------------------------------------------------- |
   | Homepage URL     | `http://localhost:3000`                             | `https://<canonical-domain>`                          |
   | Callback URL     | `http://localhost:3000/api/auth/callback/github`    | `https://<canonical-domain>/api/auth/callback/github` |
   | Setup URL        | `http://localhost:3000/api/github/callback`         | `https://<canonical-domain>/api/github/callback`      |
   | Webhook URL      | A secure tunnel URL ending in `/api/github/webhook` | `https://<canonical-domain>/api/github/webhook`       |

   GitHub permits multiple callback URLs, so a shared app can include both local
   and production callback URLs. Keep wildcard matching disabled. Setup and
   webhook URLs are single destinations, which is why separate apps are safer
   for complete local testing.

4. Enable **Redirect on update** for the setup URL and enable expiring user
   access tokens.
5. Set the permissions and event subscriptions listed in the repository
   [README](../README.md#local-setup). Keep every other permission at read-only
   or no access.
6. Copy **Client ID** into `GITHUB_CLIENT_ID`. This is not the numeric App ID.
7. Under **Client secrets**, select **Generate a new client secret**, copy the
   new value, and store it as `GITHUB_CLIENT_SECRET`.
8. Copy the slug from the app's public URL,
   `https://github.com/apps/<slug>`, into `GITHUB_APP_SLUG`. Do not use the app's
   display name.
9. Generate a high-entropy webhook secret:

   ```sh
   openssl rand -hex 32
   ```

10. Enter that exact value in the GitHub App's **Webhook secret** field and
    store the same value as `GITHUB_WEBHOOK_SECRET` in the matching local or
    production environment.

Changing the GitHub App's webhook secret before updating the deployment causes
all deliveries to fail signature verification. Update both sides in one
maintenance window.

## Configure local development

### Option A: Maintain `.env.local` manually

From the repository root:

```sh
cp .env.example .env.local
```

Fill in every value without quotes unless the value itself requires them:

```dotenv
DATABASE_URL=<pooled-development-neon-connection-string>
BETTER_AUTH_SECRET=<local-random-secret>
BETTER_AUTH_URL=http://localhost:3000
GITHUB_CLIENT_ID=<development-or-shared-app-client-id>
GITHUB_CLIENT_SECRET=<development-or-shared-app-client-secret>
GITHUB_APP_SLUG=<development-or-shared-app-slug>
GITHUB_WEBHOOK_SECRET=<development-or-shared-app-webhook-secret>
```

Next.js and the Drizzle scripts load local files from the repository root in
this order, stopping at the first definition of each variable:

1. An existing shell/process variable
2. `.env.development.local`
3. `.env.local`
4. `.env.development`
5. `.env`

Keep one authoritative local definition. A stale shell variable or
`.env.development.local` value overrides `.env.local` and can send migrations to
the wrong database.

### Option B: Pull Vercel Development values

This option is required when testing Vercel Queues locally because it obtains a
fresh `VERCEL_OIDC_TOKEN`.

1. Add the seven application variables to the Vercel **Development**
   environment using the Vercel steps below. Use development, not production,
   values.
2. Link this checkout and pull the values:

   ```sh
   pnpm dlx vercel link
   pnpm dlx vercel env pull .env.local
   ```

`vercel env pull` replaces the destination file. Move any needed manual values
into Vercel Development before running it. Re-run the pull when the OIDC token
expires or a Development value changes.

### Initialize and verify locally

Apply the committed database migrations before signing in:

```sh
pnpm db:migrate
pnpm dev
```

Then verify:

1. Open `http://localhost:3000` and sign in with GitHub.
2. Confirm the callback returns to `/journal` instead of a callback mismatch.
3. If testing installations, connect the development GitHub App and confirm the
   setup callback returns with `github=connected`.
4. If testing webhooks, send a GitHub App test delivery through the tunnel and
   confirm the webhook endpoint returns `202` with `{"status":"accepted"}`.

## Configure Vercel

Vercel is the runtime secret store for this project. Adding values to GitHub
does not make them available to Vercel deployments.

### Dashboard

1. Import the GitHub repository into Vercel or open the existing project.
2. Open **Settings > Environment Variables**.
3. Add all seven application variables from the table above.
4. Target the initial values to **Production**. Mark `DATABASE_URL`,
   `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_SECRET`, and
   `GITHUB_WEBHOOK_SECRET` as sensitive where Vercel offers that option.
5. Add a complete second set to **Preview** if preview deployments must build or
   run independently. Use a non-production database and auth secret. A preview
   that must complete GitHub OAuth also needs a stable branch domain registered
   as a GitHub App callback URL.
6. Add development values to **Development** if the team will use
   `vercel env pull` locally.
7. Save, then redeploy. Environment-variable changes do not alter an already
   built deployment.

### CLI

Link the local checkout once:

```sh
pnpm dlx vercel link
```

Add secret production values. Each command prompts without placing the value in
shell history:

```sh
pnpm dlx vercel env add DATABASE_URL production --sensitive
pnpm dlx vercel env add BETTER_AUTH_SECRET production --sensitive
pnpm dlx vercel env add GITHUB_CLIENT_SECRET production --sensitive
pnpm dlx vercel env add GITHUB_WEBHOOK_SECRET production --sensitive
```

Add non-secret production configuration:

```sh
pnpm dlx vercel env add BETTER_AUTH_URL production
pnpm dlx vercel env add GITHUB_CLIENT_ID production
pnpm dlx vercel env add GITHUB_APP_SLUG production
```

Repeat with `preview` or `development` instead of `production` when those
targets need their own values. Audit names without revealing values:

```sh
pnpm dlx vercel env ls production
pnpm dlx vercel env ls preview
pnpm dlx vercel env ls development
```

Use `vercel env update <NAME> <environment>` to rotate an existing value. After
configuration, apply production migrations from a trusted machine without
writing the production database URL to a file:

```sh
pnpm dlx vercel env run -e production -- pnpm db:migrate:production
```

Confirm the linked Vercel project and Neon database before running this command.
Run it before the first production deployment and whenever a new file appears in
`drizzle/`.

## Configure GitHub

GitHub has two separate roles here:

1. **GitHub App settings** create the client credentials and receive the
   callback, setup, and webhook URLs. Follow the GitHub App section above.
2. **GitHub Actions secrets and variables** are only available to workflows.
   They are not forwarded to Vercel.

### What the current workflow needs

The current `.github/workflows/ci.yml` does **not** need real runtime secrets. It
supplies inert build/test values directly for five variables, and Playwright
supplies its own test values. Do not copy production credentials into repository
secrets just to make the existing CI workflow pass.

Add production values to GitHub only when a workflow is intentionally changed
to run a production migration or another production operation. Prefer a GitHub
environment named `production`, add required reviewers, and grant that job the
environment explicitly.

### GitHub web interface

1. Open the repository on GitHub and select **Settings > Environments**.
2. Create or open `production` and configure its deployment protection rules.
3. Under **Environment secrets**, add secret values such as `DATABASE_URL`,
   `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_SECRET`, and
   `GITHUB_WEBHOOK_SECRET` only if the workflow references them.
4. Under **Environment variables**, add non-secret values such as
   `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, and `GITHUB_APP_SLUG` only if needed by
   that workflow.

Repository-level alternatives live at **Settings > Secrets and variables >
Actions**. Environment-level configuration is safer for production because jobs
must name the environment and can be protected by reviewers.

### GitHub CLI

The following commands prompt for each value so secrets do not appear in shell
history:

```sh
gh secret set --env production DATABASE_URL
gh secret set --env production BETTER_AUTH_SECRET
gh secret set --env production GITHUB_CLIENT_SECRET
gh secret set --env production GITHUB_WEBHOOK_SECRET

gh variable set --env production BETTER_AUTH_URL
gh variable set --env production GITHUB_CLIENT_ID
gh variable set --env production GITHUB_APP_SLUG
```

List configured names:

```sh
gh secret list --env production
gh variable list --env production
```

Merely creating them is not enough. A workflow job must opt into the environment
and map each value:

```yaml
jobs:
  migrate:
    environment: production
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      BETTER_AUTH_URL: ${{ vars.BETTER_AUTH_URL }}
```

For a migration-only job, expose only `DATABASE_URL`; do not grant all seven
values when the command does not use them.

## Production verification checklist

- `vercel env ls production` lists all seven application-owned names.
- `BETTER_AUTH_URL` exactly matches the canonical production origin.
- The GitHub App has the exact production callback, setup, and webhook URLs.
- The same `GITHUB_WEBHOOK_SECRET` is stored in GitHub App settings and Vercel.
- The production `DATABASE_URL` points to the intended Neon production branch
  and includes pooling and TLS parameters.
- `pnpm db:migrate:production` has applied every committed migration.
- A fresh deployment completes GitHub sign-in and returns to `/journal`.
- Installing or updating the GitHub App returns to the app with
  `github=connected`.
- A GitHub webhook delivery receives `202 accepted`; the queue consumer then
  processes it without an OIDC authentication error.
- No populated `.env*`, client secret, webhook secret, database URL, OAuth token,
  or `VERCEL_OIDC_TOKEN` is tracked by Git.

## Troubleshooting

### `<NAME> is required. See .env.example.`

The variable is absent from the current process. Check the correct Vercel target
or the local load order. Restart `pnpm dev` after changing `.env.local`.

### GitHub reports a callback URL mismatch

Confirm that the callback registered on the GitHub App is exactly
`<BETTER_AUTH_URL>/api/auth/callback/github`. Check the scheme, port, hostname,
and path. Keep wildcard callback matching disabled.

### GitHub installation returns `invalid-state`

The setup callback reached a different origin or database than the request that
started installation. This commonly happens when a shared GitHub App's single
setup URL points to production while installation began locally. Use a separate
development GitHub App or point the setup URL and local tunnel at the same local
environment for the duration of the test.

### Webhooks return `401 invalid-signature`

`GITHUB_WEBHOOK_SECRET` differs between GitHub App settings and the running
deployment. Update the incorrect side and redeploy if Vercel changed.

### Webhooks return `500 enqueue-failed` locally

Refresh the local Vercel OIDC token:

```sh
pnpm dlx vercel env pull .env.local
```

Then restart the development server. Also confirm the checkout is linked to the
Vercel project that owns the configured queue.

### `relation "verification" does not exist`

The database has not received the Better Auth migrations, or the migration
command used a different `DATABASE_URL`. Run the appropriate migration command
and check for a higher-precedence environment value.

### A preview builds but GitHub sign-in returns to production

`BETTER_AUTH_URL` is a stable canonical origin, so a preview that reuses the
production value can intentionally finish OAuth on production. For isolated
preview authentication, give the branch a stable Vercel domain, a separate
Preview `BETTER_AUTH_URL`, a non-production database/auth secret, and an exact
GitHub App callback URL.

## Rotation rules

- **Database credentials:** rotate in Neon, update every intended Vercel target
  and authorized GitHub environment, redeploy, migrate/test, then revoke the old
  credential.
- **GitHub client secret:** generate a second client secret, update Vercel and
  local development, redeploy and test OAuth, then delete the old secret.
- **GitHub webhook secret:** coordinate the GitHub App and Vercel change closely;
  mismatched values reject every delivery.
- **Better Auth secret:** do not rotate casually. The current single-secret
  setup has no rollover configuration and rotation can require every user to
  authenticate again.
- **Vercel OIDC token:** never rotate manually. Pull a fresh short-lived token
  for local queue work; Vercel refreshes deployed credentials.

## Official references

- [Next.js environment variable load order](https://nextjs.org/docs/app/guides/environment-variables#environment-variable-load-order)
- [Better Auth installation and secret requirements](https://better-auth.com/docs/installation)
- [Neon pooled connection strings](https://neon.com/docs/connect/connection-pooling)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel CLI environment commands](https://vercel.com/docs/cli/env)
- [Vercel OIDC in local development](https://vercel.com/docs/oidc#in-local-development)
- [GitHub App callback URLs](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url)
- [GitHub App webhook secrets](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps)
- [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [`gh secret set`](https://cli.github.com/manual/gh_secret_set) and
  [`gh variable set`](https://cli.github.com/manual/gh_variable_set)
