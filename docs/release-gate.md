# The public release gate

What has to be true before Coding Journal is exposed to the public, and how
each of those things is proved. This is the checklist issue #17 defines; it is
not a description of how the product works — that lives in
[README](../README.md), [Operating Coding Journal](operations.md) and
[Environment variables](environment-variables.md).

## 1. The trust pages are accurate and reachable before authorization

Three routes carry the whole disclosure: `/privacy`, `/terms` and
`/data-access`. They are frame 1m of the
[design reference](design/README.md) and share one editorial shell, so they
cannot drift into three different pages.

The documents are data (`src/content/trust/`) rather than markup, which lets
`src/content/trust/trust-documents.test.ts` assert what they must say: every
GitHub permission requested and the ones explicitly refused, where summaries
are processed, the completeness limits, the retention window, the summary
quotas, how to revoke access, and what redaction and deletion do — including
the one thing deletion cannot do.

They are linked from every surface a person passes on the way to authorizing:

| Surface           | Link                                                   |
| ----------------- | ------------------------------------------------------ |
| Landing hero      | "what access is used for" → `/data-access`             |
| Landing footer    | Privacy · Terms · Data access                          |
| Sign-in           | Privacy · Terms · Data access, below the GitHub button |
| Onboarding step 2 | "What each permission is used for" → `/data-access`    |
| Settings          | Data access · Privacy · Terms, in Access and retention |

Marketing claims are held to the same standard: `src/app/page.test.tsx` fails
the landing page if it starts promising a complete record, "every commit", or
a guarantee. The product's own honesty is the claim.

## 2. Setup is documented without committing secrets

| Subject                                       | Where                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| Every variable, how to obtain and rotate it   | [Environment variables](environment-variables.md)                           |
| GitHub App permissions, events, callback URLs | [Environment variables](environment-variables.md) and README                |
| Neon, Vercel project, migrations, deployment  | README, "Deploying to Vercel"                                               |
| Vercel Queue concurrency and Cron             | [Operating Coding Journal](operations.md)                                   |
| Vercel WAF rules                              | [Operating Coding Journal](operations.md), `operations/firewall-rules.json` |
| OpenAI key and the operator spend budget      | [Environment variables](environment-variables.md)                           |

`.env.example` carries every name with no populated value, `.gitignore`
excludes every real environment file, and no test, fixture or screenshot in
this repository contains a live credential.

## 3. The smoke flow proves the product end to end

`e2e/release-smoke.spec.ts` is one journey rather than nine tests, because what
the gate needs proven is that the journey holds together: landing → trust pages
→ sign-in → time-zone onboarding (including a rejected time zone) → optional
installation and its skip → best-effort Today → reconciliation → the degraded
narrative slot → History and a correction → Settings → deletion, ending signed
out on the landing page with the deletion confirmation.

```sh
pnpm test:e2e release-smoke
```

Two steps of the flow cannot be automated in CI and are proved only by the
production run below: **real GitHub sign-in**, because it needs a real GitHub
account and consent screen, and **real deletion**, because it needs a database
to delete from and a grant to revoke. Treat the CI run as proof that everything
around them holds, not as proof of them.

The fixture session does not write to the database: onboarding answers go to a
cookie, and deletion ends the session without calling `deleteJournalAccount`
or revoking a GitHub grant, because a smoke deployment has neither a database
nor a GitHub app. Everything else below the cookie — routing, guards,
redirects, validation, rendering — is the production path.

Those three effects are proved against a real deployment. Run the same flow
with a real GitHub account rather than the fixture session:

```sh
E2E_EXTERNAL_SERVER=1 PLAYWRIGHT_TEST_BASE_URL=https://<your-domain> pnpm test:e2e
```

The fixture session (`E2E_AUTH_MODE`) is refused when `NODE_ENV=production`, so
a production run exercises the real GitHub sign-in and the real database. Use a
throwaway GitHub account: the flow ends by deleting it.

## 4. Accessibility meets WCAG 2.2 AA

Automated and manual coverage is recorded in
[Accessibility](accessibility.md). `pnpm test:e2e accessibility` runs axe
against every primary route in both themes and fails on any violation.

## 5. Responsive behaviour holds at every size class

`e2e/responsive.spec.ts` walks landing, Data access, Today, History, a missing
journal day, a journal-day render failure, and Settings at 320, 375, 840 and
1280 pixels in both themes. It asserts no horizontal page scroll, nothing
clipped outside the viewport, and one display heading per route. It also checks
the navigation composition (bottom bar below 600, rail from 600), the
reference's focus order for the refresh action, and the 200 %-zoom collapse to
the medium composition.

Pixel baselines are deliberately not committed. A screenshot baseline is bound
to the renderer that produced it, so a macOS baseline fails on CI's Linux and
the failure says nothing about the layout. Full-page screenshots are attached
to every run instead and uploaded as a CI artifact, so a reviewer sees what
each width and theme actually looked like.

## 6. Browsers

| Engine                    | When                                     | How                         |
| ------------------------- | ---------------------------------------- | --------------------------- |
| Chromium (desktop, Pixel) | Every pull request                       | `browser-smoke` job         |
| Firefox, WebKit, iPhone   | Pushes to `main` and `workflow_dispatch` | `release-gate-browsers` job |

Run the gate locally with:

```sh
pnpm exec playwright install firefox webkit
E2E_RELEASE_GATE=true pnpm test:e2e
```

Three keyboard checks skip on WebKit. Safari only lets Tab reach links and menu
items when "Press Tab to highlight each item" is enabled, which is a system
preference rather than something the page controls; those paths are verified by
hand instead — see [Accessibility](accessibility.md).

### Verified by hand on real devices

Headless engines do not substitute for a real phone: they have no software
keyboard, no dynamic type, no address-bar collapse and no real touch
targets. Before a release, walk the smoke flow once on each and record the date
and OS version in the release PR:

- **iOS Safari** — sign-in, onboarding, Today at the smallest supported width,
  History drill-in, Settings, and the deletion confirmation. Check that the
  software keyboard does not obscure the time-zone field or the deletion input,
  and that no page scrolls sideways with the address bar collapsed.
- **Android Chrome** — the same flow, plus the bottom navigation bar against
  the system gesture area, and dark theme following the system setting.

## 7. Every available MaterialCN primitive is used, and the gaps are named

`components.json` makes MaterialCN authoritative at `@materialcn`. Everything
naturally required by the reference and present in the registry is installed
from it and committed as source: Button, IconButton, Chip, Select, Switch,
Dialog, Snackbar, Tabs, Menu, Divider, ProgressIndicator, List / ListItem,
NavigationBar and NavigationRail.

The reference (frame 1n) records two gaps in the registry, and both are built
as project components in `src/components/journal/` rather than as new
`ui/` primitives, because neither introduces a new visual language:

| Gap                     | Built as                                    | Why not a registry primitive           |
| ----------------------- | ------------------------------------------- | -------------------------------------- |
| No data-strip primitive | `MetricOverview`, from Divider + type roles | It is a composition, not a new control |
| No list-detail scaffold | History's grid, from the breakpoint tokens  | It is layout, not a control            |

One further deviation is worth stating plainly: the trust pages introduce a
`text-m3-body-editorial` type role (17/28) that the M3 scale does not define.
The reference asks for a reading size larger than the app's on those pages
specifically, and it is a token in `globals.css` like every other role rather
than a hard-coded size.

## 8. The open-source repository is release-ready

README, [CONTRIBUTING](../CONTRIBUTING.md), [SECURITY](../SECURITY.md),
[CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md) and an MIT [LICENSE](../LICENSE) are
present. The README carries the architecture vocabulary, the test strategy, and
the operational limitations a reader should know before trusting the product or
running their own instance.

## 9. What the gate does not add

The gate is a proof that what exists is releasable, not an excuse to widen the
product. Explicitly out of scope, and absent by design:

- Sentry or any other error-tracking vendor — triage runs off structured logs
  and `/api/ops/health`, per [Operating Coding Journal](operations.md).
- Billing, plans or payment of any kind.
- Notifications, email or digests.
- Localization; the product ships in English.
- Editable summaries. The narrative is read-only, and a correction is appended
  rather than a rewrite.
- Sharing, teams, profiles, export of anyone else's activity.

## Release run record

The gate is only passed when the manual halves have actually been run, not when
they have been described. Copy this table into the release pull request and
fill it in; an empty row is a blocked release.

| Check                                           | Date | By  | Version / OS | Result |
| ----------------------------------------------- | ---- | --- | ------------ | ------ |
| Production smoke flow, real GitHub account      |      |     |              |        |
| Real account deletion, verified in the database |      |     |              |        |
| iOS Safari device pass                          |      |     |              |        |
| Android Chrome device pass                      |      |     |              |        |
| Keyboard review (docs/accessibility.md)         |      |     |              |        |

Record the result in [Accessibility](accessibility.md) when the keyboard review
finds anything, so the next reviewer starts from the last one rather than from
scratch.

## Running the whole gate

```sh
pnpm check                                   # types, lint, format, unit and boundary tests
pnpm build                                   # production build
pnpm test:e2e                                # Chromium: smoke, accessibility, responsive
E2E_RELEASE_GATE=true pnpm test:e2e          # plus Firefox, WebKit and iPhone
```

Then the manual passes: the two real devices above, and the keyboard review in
[Accessibility](accessibility.md).
