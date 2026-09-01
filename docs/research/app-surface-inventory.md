# Coding Journal app-surface inventory

Research snapshot: 2026-09-01. This note distinguishes what the repository renders today from what the open GitHub roadmap explicitly promises. Repository source and the project's own GitHub Issues are the only sources used.

## Product frame

Coding Journal is a private daily record of a developer's GitHub activity, positioned as “Your GitHub day, distilled.” The current deployable slice is a responsive Material 3 landing page, persistent appearance controls, GitHub authentication, and a protected journal experience ([README.md](../../README.md#L1-L11)). The master product issue defines the eventual top-level product areas as landing, onboarding, Today, History, Settings, Privacy, Terms, and data-access documentation ([#1 — Build Coding Journal](https://github.com/guillermo-rebolledo/coding-journal/issues/1)).

The source of truth for visual implementation is Next.js App Router under `src/app`. There are currently four user-visible URL routes:

| Route       | Current surface                                | Access        |
| ----------- | ---------------------------------------------- | ------------- |
| `/`         | Landing                                        | Public        |
| `/sign-in`  | GitHub sign-in and sign-in errors              | Public        |
| `/journal`  | Onboarding or Today, selected by account state | Authenticated |
| `/settings` | GitHub access and appearance                   | Authenticated |

The application also has GitHub authentication, installation, callback, webhook, and queue endpoints. These are transitions or backend boundaries, not pages. For example, the installation handler redirects to GitHub and preserves an onboarding/settings return target ([install route](../../src/app/api/github/install/route.ts#L5-L36)); the callback redirects with a `github` status query ([callback route](../../src/app/api/github/callback/route.ts#L11-L113)). The current pages do not visibly consume that callback status, so it should not be treated as an existing screen.

## What exists today

### 1. Public landing — `/`

The landing page has a brand header and theme control, hero/tagline, primary “Start your journal” CTA, a mocked daily summary, three benefit panels, and a simple open-source footer ([landing page](../../src/app/page.tsx#L30-L129)). It is already responsive and Material 3 styled, but its benefit area and sample journal rely heavily on raised, rounded panels.

Current states and interactions:

- Default content state.
- Global system/light/dark appearance menu in the header ([site header](../../src/components/site-header.tsx#L6-L24), [theme menu](../../src/components/theme-menu.tsx#L16-L58)).
- CTA transition to `/sign-in`.

### 2. GitHub sign-in — `/sign-in`

The page is a centered authentication panel with home/brand link, theme menu, a single GitHub sign-in action, and a short data-handling explanation ([sign-in page](../../src/app/sign-in/page.tsx#L31-L77)).

Current states:

- Normal sign-in.
- Cancelled GitHub authorization.
- Missing/unusable GitHub profile or email.
- Generic OAuth failure fallback. Error mapping and copy are in the route itself ([sign-in errors](../../src/app/sign-in/page.tsx#L8-L29)).

### 3. Protected journal shell — `/journal`

Unauthenticated visits redirect to `/sign-in?next=%2Fjournal`. Authenticated users see a common header with the product identity, Settings, theme, and sign-out, then one of the onboarding or Today surfaces based on saved account state ([journal shell and route selection](../../src/app/journal/page.tsx#L53-L95), [route boundary](../../src/app/journal/page.tsx#L602-L650)).

#### Loading

A full-page status surface says the app is reconciling GitHub access and building a deduplicated local-day journal ([journal loading](../../src/app/journal/loading.tsx#L5-L39)).

#### Onboarding step 1: time zone

The screen detects the browser's IANA time zone, lets the user edit it, explains local-day and daylight-saving boundaries, validates errors, and shows pending submit state ([time-zone step](../../src/app/journal/time-zone-step.tsx#L14-L94)).

#### Onboarding step 2: repository access

The screen explains the distinction between GitHub identity sign-in and GitHub App repository access, then offers two choices: install the app for selected/all repositories, or continue in best-effort mode. It has a pending-organization-approval variant and, when revisited through `/journal?setup=repositories`, a “Back to Today” action ([repository access](../../src/app/journal/page.tsx#L97-L196)).

#### Today: identity and completeness header

Today greets the user, shows the local calendar date and IANA time zone, and labels coverage. Visible coverage variants include active completeness supplied by the GitHub completeness model, pending approval, disconnected, and best-effort/no repository access ([Today header](../../src/app/journal/page.tsx#L198-L264)). The completeness model also supports complete, partial, limited, unavailable, and disconnected installation conditions, surfaced in Settings ([connection-state mapping](../../src/components/github-access-overview.tsx#L13-L65)).

#### Today: metrics

There are currently 16 separate metric cards: pushes, commits, refs, releases, discussions, issues, pull requests, reviews, merges, comments, workflows, deployments, packages, organization Projects, Gists, and social activity ([metric definitions](../../src/app/journal/page.tsx#L274-L378), [metric grid](../../src/app/journal/page.tsx#L407-L437)). This is the clearest existing density problem for a compact, list-first redesign.

#### Today: freshness and reconciliation

The freshness block shows the local day, last stored update, last GitHub reconciliation, a manual “Refresh Today” action, and the next allowed GitHub sync time ([freshness region](../../src/app/journal/page.tsx#L439-L471)). The open page reloads stored data every 30 minutes; manual refresh has pending, success/cooldown, and failure announcements ([refresh behavior](../../src/app/journal/journal-refresh.tsx#L13-L82)).

Reconciliation status variants are:

- Awaiting the first reconciliation.
- Loading/reconciling.
- Partial GitHub response.
- GitHub reconciliation error while stored activity remains usable.
- Reconciled/success ([status surface](../../src/app/journal/page.tsx#L473-L511)).

An optional secondary-source coverage section reports best-effort Projects/Gists/other source freshness, including refreshed and unavailable states ([secondary coverage](../../src/app/journal/page.tsx#L513-L559)).

#### Today: empty states

When there is no activity, Today selects among “ready to refresh,” “could not be refreshed,” “being reconciled,” and “ready to take shape,” with explanatory copy and a repository-access CTA ([empty Today](../../src/app/journal/page.tsx#L561-L597)).

#### Today: activity explorer

The populated journal supports:

- Chronological list (canonical/default).
- Repository-grouped list.
- Repository filter.
- Activity-type filter across all supported categories.
- Result count and no-filter-results state ([explorer controls and rendering](../../src/app/journal/journal-explorer.tsx#L299-L467)).

Each activity row carries the action, optional subject number/title, repository, time, actor, and an external evidence link. Contextual badges can mark private repositories, commits authored before today, operation status, narrative exclusion, preview/best-effort coverage, and reconciliation-only sources ([activity item](../../src/app/journal/journal-explorer.tsx#L169-L297)). Although semantically a list, each row currently looks like an individual rounded container.

### 4. Settings — `/settings`

Unauthenticated visits redirect to `/sign-in?next=%2Fsettings`. The current page has Back to Today, GitHub access management, install/add-another-installation, a private-by-design explanation, and appearance controls ([settings route](../../src/app/settings/page.tsx#L18-L118)).

GitHub connection variants include:

- No installation.
- Installation skipped/best-effort.
- Pending organization approval.
- Disconnected.
- Temporarily unavailable, showing last-known access.
- Partial repository selection.
- Limited permissions.
- Complete granted access.
- Manage-on-GitHub action where available.
- Permanent caveats for Projects preview and reconciliation-only sources ([access overview](../../src/components/github-access-overview.tsx#L67-L159)).

Appearance supports system, light, and dark modes ([theme menu](../../src/components/theme-menu.tsx#L16-L58)) plus four palettes: Lavender, Warm ink, Tide, and Moss & clay ([palette picker](../../src/components/palette-picker.tsx#L6-L31), [palette controls](../../src/components/palette-picker.tsx#L47-L82)).

## Planned surfaces in open issues

The implementation sequence is explicit: Today polish → AI summary → finalization/History → privacy/deletion → protection/telemetry → release gate. Every child issue below remains open and is labelled `ready-for-agent` as of this snapshot.

### [#12 — 11 — Explore and refresh the complete Today journal](https://github.com/guillermo-rebolledo/coding-journal/issues/12)

This is largely an expansion and completion of the existing Today screen, not a new route. The open acceptance surface requires high-signal metrics, chronological and repository-grouped exploration, repository/activity filters, freshness and completeness, manual refresh/cooldown/rate-limit feedback, partial/error states, evidence navigation, purpose-designed phone and desktop layouts, two themes, keyboard completeness, reduced motion, and WCAG 2.2 AA verification.

Design implication: treat the current implementation as functional source material, not a locked layout. The issue explicitly calls for a polished, scan-efficient experience, and the user's current direction further requires reducing the 16-card metric wall in favor of compact summaries and lists.

### [#13 — 12 — Generate safe evidence-linked summaries](https://github.com/guillermo-rebolledo/coding-journal/issues/13)

Adds a prominent, permanently read-only narrative to Today. Required content regions are:

- Concise overview.
- Accomplishments grouped by repository.
- Reviews/collaboration.
- Evidence-supported work in progress.
- Evidence links for every validated claim.

Required states include existing/cached summary, generation pending, cooldown, daily quota exhausted, global generation pause/budget limit, provider failure, invalid output, and summary unavailable. In every degraded state, the factual dashboard must remain fully usable. Social actions and destructive package actions may remain in factual activity but are excluded from the narrative.

### [#14 — 13 — Finalize days and browse journal history](https://github.com/guillermo-rebolledo/coding-journal/issues/14)

Adds the History product area and expands journal lifecycle states.

Explicit new surfaces:

- History index/list of prior journals.
- Selected historical-day detail with retained time-zone context, completeness, metrics, immutable narrative, evidence, and corrections.

Required lifecycle states across Today and History are live, finalizing, finalized, recoverable finalization failure, and corrected. Late evidence appears as a visibly labeled correction and must not silently rewrite the final narrative.

The issue does not mandate exact URLs; `/history` and a date-specific detail route would be reasonable design proposals, not current facts.

### [#15 — 14 — Enforce revocation, retention, and deletion](https://github.com/guillermo-rebolledo/coding-journal/issues/15)

Expands Settings into a complete privacy/account-control surface. It must explain current access, 30-day normalized-activity retention, GitHub-side revocation, and account deletion consequences.

Required states and flows:

- GitHub installation suspension/removal and authorization revocation.
- Repository access removed.
- Neutral unavailable markers replacing inaccessible private historical detail.
- Account deletion confirmation.
- Deletion/redaction job progress.
- Recoverable deletion/redaction failure.
- Completed deletion followed by session termination.

Exact confirmation-dialog/page structure is not prescribed, so the design should choose the safest compact pattern while making the destructive action unmistakable.

### [#16 — 15 — Protect the public service and expose safe telemetry](https://github.com/guillermo-rebolledo/coding-journal/issues/16)

Adds consistent, accessible limit and service-health states at costly boundaries while preserving the deterministic journal. User-visible states include reconciliation cooldown, per-user AI limit, global daily/monthly budget pause, queue/provider failure, and safe recovery guidance. The issue also asks for operational views or documentation covering sync, queue, provider, budget, and finalization failures, but does not establish a public operator-screen route. Do not invent an admin dashboard without further product direction.

### [#17 — 16 — Complete the public release gate](https://github.com/guillermo-rebolledo/coding-journal/issues/17)

Adds three explicit public trust/documentation pages:

- Privacy.
- Terms.
- Data access / GitHub permissions.

Landing, sign-in, and onboarding must link to these surfaces before authorization. Their content must accurately cover GitHub permissions, OpenAI processing, completeness limits, retention, quotas, revocation, redaction, and account deletion. The release-gate flow also confirms that the final primary navigation must accommodate Today, History, and Settings and work on phone/desktop in light/dark themes.

### [#1 — Build Coding Journal: a daily GitHub activity journal](https://github.com/guillermo-rebolledo/coding-journal/issues/1)

The master issue remains open and is the complete product contract. In addition to the child-issue surfaces above, it establishes:

- A visible onboarding/backfill progress experience.
- Theme control in Settings with system default and manual override.
- Explicit completeness and best-effort labeling everywhere coverage is incomplete.
- English-only, GitHub.com-only MVP.
- No editable summaries, manual journal entries, sharing/public profiles, social feeds, gamification, contribution-graph imitation, productivity scoring, notifications, billing, localization, Sentry, or native apps.

These exclusions are important design constraints: they prevent speculative screens and keep the navigation focused.

## Complete screen/state checklist for design work

### Public

- Landing: default, responsive phone/desktop, light/dark/palette variants.
- Sign-in: default, cancelled, missing profile/email, generic failure.
- Privacy (future).
- Terms (future).
- Data access / permissions (future).

### Onboarding

- Time-zone detection/editing: default, invalid, submitting.
- Repository-access choice: no access, install, skip, pending organization approval, returning user.
- Backfill/reconciliation progress: basic loading exists; fuller visible progress remains part of the product contract.

### Authenticated journal

- Today empty: awaiting refresh, reconciling, no activity, reconciliation failure.
- Today populated: chronological, grouped by repository, filtered, zero filter results.
- Completeness: complete, partial selected repositories, limited permissions, best-effort, pending approval, disconnected, temporarily unavailable.
- Freshness: stored update, last reconciliation, cooldown/next sync, refresh pending, partial, failure, success.
- Secondary sources: refreshed/best-effort, preview, reconciliation-only, unavailable.
- Activity-row badges: private, authored earlier, in progress/approved/succeeded/failed/cancelled, excluded from narrative, best-effort.
- AI summary (future): cached/ready, queued, cooldown, quota exhausted, global pause, provider/validation failure, unavailable.
- Journal lifecycle (future): live, finalizing, finalized, recoverable failure, corrected, private evidence redacted/unavailable.
- History list and historical-day detail (future).

### Settings

- Connections: not installed, skipped, pending, active/full, partial, limited, disconnected, unavailable, manage externally, add another.
- Appearance: system/light/dark and four palette choices.
- Privacy/retention/revocation guidance (future expansion).
- Account deletion: confirmation, progress, recoverable failure, completion (future).

### Service-limit states

- Reconciliation cooldown/rate limit.
- Per-user summary cooldown/daily exhaustion.
- Global generation/budget pause.
- Provider, queue, sync, and finalization failures with safe recovery language.

## Design handoff constraints

The master issue requires MaterialCN as the authoritative component source and describes the desired product as calm, restrained, high-signal developer tooling with strong typography, scan-friendly density, generous narrative spacing, deliberate mobile/desktop layouts, WCAG 2.2 AA, 44-pixel touch targets, visible focus, and reduced-motion support ([#1](https://github.com/guillermo-rebolledo/coding-journal/issues/1)). The repository already loads Roboto Flex and applies its theme provider globally ([root layout](../../src/app/layout.tsx#L6-L24)).

For the requested Material Expressive direction, preserve those constraints while changing the composition:

- Prefer divided lists, grouped rows, compact tables/data strips, chips, and inline status over one card per datum.
- Collapse the 16 metric cards into a compact, responsive overview with clear hierarchy and drill-down affordances.
- Keep the activity timeline and connection inventory as true lists with shared section surfaces and separators rather than isolated floating cards.
- Reserve cards or large tonal containers for high-salience narrative, onboarding choices, destructive confirmations, and substantial empty/error states.
- Use expressive shape, type scale, color roles, icon treatment, and motion selectively; do not let oversized controls or decorative surfaces reduce journal density.
- Design every future state above as part of one coherent system so Today, History, Settings, and trust pages do not become separate visual dialects.

## Roadmap index

| Issue                                                                                                     | Status at snapshot | Product/UI consequence                                                               |
| --------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| [#1 — Build Coding Journal](https://github.com/guillermo-rebolledo/coding-journal/issues/1)               | Open               | Master product contract and exclusions                                               |
| [#12 — Explore and refresh Today](https://github.com/guillermo-rebolledo/coding-journal/issues/12)        | Open               | Finish/polish current Today                                                          |
| [#13 — Generate safe summaries](https://github.com/guillermo-rebolledo/coding-journal/issues/13)          | Open               | Read-only evidence-linked Today narrative and degraded states                        |
| [#14 — Finalize days and browse History](https://github.com/guillermo-rebolledo/coding-journal/issues/14) | Open               | History list/detail and journal lifecycle states                                     |
| [#15 — Revocation, retention, deletion](https://github.com/guillermo-rebolledo/coding-journal/issues/15)  | Open               | Settings privacy/account controls and redacted-history states                        |
| [#16 — Protection and telemetry](https://github.com/guillermo-rebolledo/coding-journal/issues/16)         | Open               | Accessible service-limit and failure states; operator visibility remains unspecified |
| [#17 — Public release gate](https://github.com/guillermo-rebolledo/coding-journal/issues/17)              | Open               | Privacy, Terms, data-access pages and final responsive/accessibility pass            |
