# Prompt: Design Coding Journal's look and feel

You are the principal product designer and design engineer for **Coding Journal**, a private daily record that turns a developer's GitHub activity into a calm, trustworthy journal. The product promise is **“Your GitHub day, distilled.”**

Your task is to create an implementation-ready visual and interaction direction for the whole product—not just a landing-page concept. Work from the repository and its GitHub Issues as primary sources. Treat existing behavior and copy as product evidence, but do not treat the current composition as visually final.

This is a design task. Do not change backend behavior, data semantics, privacy rules, or roadmap scope. If you can create mockups or a prototype, do so, but keep production source changes out of scope until the direction is approved.

## Start with repository research

Work in the repository root and inspect these sources before proposing anything:

- `AGENTS.md`, especially the rule that this repo's Next.js version differs from familiar versions.
- `README.md` for the current product and stack.
- `docs/research/app-surface-inventory.md` for a cited current/future surface map.
- `src/app/page.tsx` for the landing page.
- `src/app/sign-in/page.tsx` for authentication and error states.
- `src/app/journal/page.tsx`, `loading.tsx`, `time-zone-step.tsx`, `journal-refresh.tsx`, and `journal-explorer.tsx` for onboarding and Today.
- `src/app/settings/page.tsx`, `src/components/github-access-overview.tsx`, `palette-picker.tsx`, and `theme-menu.tsx` for Settings and appearance.
- `src/app/globals.css` for the existing Material 3 color, type, shape, elevation, spacing, and motion tokens.
- `components.json` for the MaterialCN registry and Lucide icon setup.
- `e2e/smoke.spec.ts` for user-visible flows and viewport expectations.

Use `gh issue view <number> --comments` and `gh issue list` to read the issue tracker. At minimum, read:

- [#1 — Build Coding Journal: a daily GitHub activity journal](https://github.com/guillermo-rebolledo/coding-journal/issues/1)
- [#12 — Explore and refresh the complete Today journal](https://github.com/guillermo-rebolledo/coding-journal/issues/12)
- [#13 — Generate safe evidence-linked summaries](https://github.com/guillermo-rebolledo/coding-journal/issues/13)
- [#14 — Finalize days and browse journal history](https://github.com/guillermo-rebolledo/coding-journal/issues/14)
- [#15 — Enforce revocation, retention, and deletion](https://github.com/guillermo-rebolledo/coding-journal/issues/15)
- [#16 — Protect the public service and expose safe telemetry](https://github.com/guillermo-rebolledo/coding-journal/issues/16)
- [#17 — Complete the public release gate](https://github.com/guillermo-rebolledo/coding-journal/issues/17)

Issue #12 remains open, but the current branch already contains substantial Today work. The repository is the source of truth for what exists; the issues are the source of truth for what remains promised. Explicitly distinguish current UI, current UI that needs redesign, and future UI.

If the app can be run safely, inspect it at representative phone and desktop sizes in light and dark themes. Do not infer runtime appearance solely from JSX.

## Product character

The product should feel like a thoughtful work journal made for developers: calm, precise, private, and useful at the end of a busy day. It should be expressive enough to feel authored and memorable, but never playful at the expense of trust or scan speed.

Use **Material 3 Expressive** as the visual foundation: flexible typography, contrasting shapes, meaningful color, adaptive composition, clear interaction states, and motion with physical character. Interpret “Expressive” selectively for a dense web application. It does not mean making every control oversized, pill-shaped, colorful, animated, or enclosed.

The visual thesis should reconcile these qualities:

- Warm and human, but not cute.
- Developer-oriented, but not terminal cosplay.
- Dense and scan-friendly, but not cramped.
- Expressive, but restrained.
- Trustworthy about incomplete data, privacy, limits, and failure.
- Journal-like in rhythm and reading experience, but factual rather than nostalgic.

## The strongest composition rule: lists before cards

The current implementation overuses discrete rounded containers, especially the 16-card metric wall, activity rows, connection rows, source-freshness rows, and landing benefits. Redesign this deliberately.

Use this priority order for grouping:

1. Alignment, whitespace, and typography.
2. Shared surfaces with section headings.
3. Divided or grouped lists and compact rows.
4. Tonal bands, inline status, chips, and compact data strips.
5. Cards only when content truly needs isolation or elevated focus.

Prefer:

- Divided lists for activity, GitHub installations, History, evidence, corrections, and settings.
- Compact metric strips, grouped metric rows, or a small summary table instead of one card per metric.
- Inline state labels and chips rather than a container for every status.
- List-detail or supporting-pane layouts at expanded widths.
- Full-width section surfaces and strong typographic hierarchy instead of grids of floating tiles.

Cards or prominent tonal containers are appropriate for:

- The read-only AI narrative.
- A focused sign-in surface.
- Meaningful onboarding choices.
- Destructive account-deletion confirmation.
- Substantial empty or unrecoverable error states.
- A single high-salience summary—not every datum within it.

Every proposed card must have a reason to be isolated. “Material uses cards” is not a reason.

## What already exists

Design a coherent system around all of these existing routes, surfaces, and states.

### Public landing — `/`

Currently includes a brand header, theme control, hero and CTA, a sample journal summary, three benefit blocks, and footer. Redesign it to communicate purpose, trust, and product texture without becoming a generic SaaS card grid. It needs a strong route to sign-in and, once issue #17 lands, visible Privacy, Terms, and Data Access links before authorization.

### GitHub sign-in — `/sign-in`

Includes brand/home, theme control, one GitHub sign-in action, and data-handling copy. Cover normal, cancelled authorization, missing/unusable profile or email, and generic failure. The sign-in action must remain unmistakably primary, and errors must give a clear recovery path.

### Journal loading — `/journal`

A full-page reconciliation state explains that Coding Journal is checking granted access and building the local-day journal. Design an honest, calm progress treatment that still works with reduced motion. The master issue also promises fuller onboarding/backfill progress, so establish a reusable progress pattern.

### Onboarding: time zone

The first step detects an IANA time zone, allows editing, explains local-day/DST boundaries, validates errors, and has a pending submit state. Optimize it for confidence and speed. Do not bury the input in unnecessary decoration.

### Onboarding: repository access

The second step explains OAuth identity versus optional GitHub App repository access. It offers installation for selected/all repositories or a clearly labeled best-effort path. Cover no access, organization approval pending, skip, install, and returning-user “Back to Today” states. This is one of the few places where two clearly differentiated choice surfaces may be justified.

### Today: header and completeness

Shows greeting, local date, IANA time zone, and data completeness. Cover complete, partial repository selection, limited permissions, best-effort, pending approval, disconnected, and temporarily unavailable states. Completeness must be visible and understandable without relying on color alone.

### Today: metrics

There are 16 factual categories: pushes, commits, refs, releases, discussions, issues, pull requests, reviews, merges, comments, workflows, deployments, packages, organization Projects, Gists, and social activity.

Replace the current 16-card wall with a compact system. Consider a concise top-line summary, a prioritized subset based on non-zero/high-signal values, and a complete grouped breakdown that remains easy to scan. Zero values must not dominate. Do not create productivity scores, streaks, contribution graphs, rankings, or celebratory gamification.

### Today: freshness and reconciliation

Show local day, last stored update, last GitHub reconciliation, manual refresh, next allowed sync, and accessible status feedback. Cover awaiting first reconciliation, refreshing, cooldown, partial GitHub response, error with stored data retained, and success. Stored factual data must remain visually primary and usable when providers fail.

### Today: secondary-source coverage

Projects preview, Gists, and other delayed sources may be best-effort, refreshed at a known time, or unavailable. Integrate these caveats compactly—prefer a disclosure, details list, or supporting information region over another grid of cards.

### Today: empty states

Cover ready to refresh, actively reconciling, no activity, and reconciliation failure. Each state should explain what is known, why the journal may be incomplete, and the next useful action. Reserve large expressive treatment for these genuinely empty moments.

### Today: activity explorer

The canonical view is chronological. Users can filter by repository and activity type and switch to repository grouping without losing filters. Cover populated, filtered, zero filter results, chronological, and grouped modes.

Activity rows can contain action, subject number/title, repository, time, actor, evidence link, and badges for private repository, authored before today, operation status, narrative exclusion, preview/best-effort coverage, or reconciliation-only coverage. Make this a real compact list with a shared surface and dividers. Preserve readable row rhythm, evidence-link affordance, long-name wrapping, and touch/keyboard usability without putting every row in a floating card.

### Settings — `/settings`

Currently includes GitHub access, installation management, privacy explanation, system/light/dark mode, and four palettes: Lavender, Warm ink, Tide, and Moss & clay.

Connection states include not installed, skipped, pending approval, active/full, partial, limited, disconnected, temporarily unavailable, manage on GitHub, and add another installation. Use grouped settings rows and disclosure patterns. Do not turn every setting or installation into a separate card.

Keep the existing semantic theme-token model and support every palette in light and dark mode. You may refine how palette choices are previewed, but do not silently remove them.

## Future surfaces that the design system must anticipate

Do not design only today's routes. Include these roadmap surfaces in the information architecture, component system, and key mockups.

### Issue #13: read-only, evidence-linked AI narrative

Add to Today:

- A concise overview.
- Accomplishments grouped by repository.
- Reviews and collaboration.
- Evidence-supported work in progress.
- Evidence links for every validated claim.

Cover ready/cached, queued, cooldown, daily quota exhausted, global pause/budget limit, provider failure, invalid output, and unavailable states. The narrative is permanently read-only. Degraded AI must never visually disable or obscure the deterministic metrics and activity list.

### Issue #14: History and journal lifecycle

Add a History product area with:

- A compact History index/list of prior journal days.
- A selected historical-day detail with retained time zone, completeness, metrics, immutable narrative, evidence, and corrections.

Cover live, finalizing, finalized, recoverable finalization failure, corrected, and late-evidence states. A correction must be clearly appended and dated; it must never look like a silent rewrite of the final narrative.

At expanded widths, explore a list-detail layout for History. At compact widths, use clear drill-in navigation and preserved date context. Routes are not yet prescribed, so label proposed URLs as recommendations rather than facts.

### Issue #15: privacy, revocation, retention, and deletion

Expand Settings to explain current access, 30-day normalized-activity retention, GitHub-side revocation, private-history redaction, and account deletion consequences.

Cover installation suspension/removal, repository access removed, neutral unavailable markers in history, account-deletion confirmation, deletion/redaction progress, recoverable failure, and completed deletion/session termination. Destructive actions require unmistakable hierarchy and confirmation. They must not share the same visual emphasis as routine settings.

### Issue #16: limits and service health

Create one consistent pattern for reconciliation cooldown, per-user summary limits, daily quota exhaustion, global budget pause, queue/provider failure, and finalization failure. Each state must say what remains available and how or when recovery occurs. Do not invent a public admin dashboard; the issue only requires operator views or documentation and leaves their UI unspecified.

### Issue #17: public trust surfaces

Add public Privacy, Terms, and Data Access/GitHub Permissions pages. These are editorial pages, not card grids. Establish readable long-form typography, anchored section navigation if helpful, and clear links from landing, sign-in, and onboarding before authorization. The design must comfortably explain GitHub access, OpenAI processing, completeness limits, retention, quotas, revocation, redaction, and deletion.

### Master issue #1: final information architecture

The final authenticated product navigation must support Today, History, and Settings. Settings is ultimately responsible for time zone, GitHub access/repository selection, appearance, privacy, and account deletion. Explore a purpose-designed compact/mobile navigation pattern and an efficient expanded/desktop pattern. Do not merely shrink the desktop header onto a phone.

## Visual-system requirements

Build on the repo's existing system rather than introducing a second visual language:

- **Components:** MaterialCN is authoritative. Use naturally required MaterialCN primitives where available. Do not force components into the product to showcase the library. Standard shadcn or a custom primitive is allowed only when MaterialCN has no equivalent, and the gap must be documented.
- **Typography:** Keep Roboto Flex unless you can demonstrate a strong product reason to change it. Use the existing Material type roles and variable-font capabilities to create contrast between journal narrative, factual data, labels, and controls. Keep the scale disciplined and long-form measure readable.
- **Color:** Work through existing semantic M3 tokens. Accent color should primarily signal interaction and selection. Use status colors consistently and always pair them with text/icon cues. Preserve all four current palettes and system/light/dark behavior.
- **Shape:** Use shape contrast to establish hierarchy—small/medium radii for dense rows and inputs, larger or more expressive shapes for selected navigation, narrative, onboarding, and empty states. Avoid uniform “rounded rectangle everywhere.” Keep nested radii concentric.
- **Elevation:** Prefer tonal surface hierarchy and structural dividers. Use elevation only when an element truly floats, overlays, or needs focus. Do not use shadows as decoration on every section.
- **Icons:** Keep one Lucide language, with consistent size and optical stroke weight. Icons clarify hierarchy and state; they do not decorate every line.
- **Motion:** Use existing M3 motion tokens. High-frequency feedback should be immediate or brief and interruptible. Reserve expressive motion for meaningful state changes, navigation selection, progress, and occasional entry hierarchy. Avoid gratuitous page-load choreography. Provide a complete reduced-motion treatment and never use motion as the only state cue.
- **Copy:** Preserve the established calm, direct voice. Routine actions are neutral and concise; onboarding/empty states may be warm; errors and destructive actions are plain and specific. Use sentence case and verb-first actions.

## Responsive and accessibility requirements

Design phone and desktop intentionally, with tablet/medium behavior explained. At minimum, verify 320 px compact width, a representative 375 px phone, and expanded desktop. Stress-test 200% zoom and long repository names, titles, actor names, time zones, translations/pseudo-localized strings, and high activity counts even though launch is English-only.

Meet the product's WCAG 2.2 AA target:

- Full keyboard path and logical focus order.
- Clearly visible `:focus-visible` treatment.
- At least 44×44 CSS-pixel touch targets where the product contract requires them, without making the visible UI unnecessarily bulky.
- Semantic headings, landmarks, lists, buttons, links, form labels, status announcements, and error association.
- No information conveyed by color or motion alone.
- Sufficient rendered contrast in every palette and both light/dark modes.
- No clipped or unreachable content at 320 px or 200% zoom.
- Full values remain reachable when compact layouts truncate text.
- Reduced-motion behavior for progress, selection, transitions, and loading.

## Explicit anti-goals

Do not add or imply:

- Contribution-graph imitation.
- Productivity scoring, streaks, rankings, or performance judgments.
- Gamified celebrations.
- Editable summaries or manual journal entries.
- Sharing, public profiles, social feeds, or teams.
- Notifications, billing, localization, native apps, or Sentry.
- Source code, diffs, logs, secrets, or sensitive private metadata in the UI.
- A speculative admin dashboard.
- A generic SaaS dashboard made of cards.
- A terminal/monospace aesthetic as a substitute for developer relevance.

## Required deliverables

Produce one coherent design package with:

1. **Evidence-based audit:** Briefly summarize the current visual system, strongest reusable assets, density/card-overuse problems, and product constraints. Cite repo paths and issue numbers.
2. **Design thesis:** A concise description of the chosen look and feel, including why it suits a private developer journal and how it interprets Material 3 Expressive.
3. **Information architecture:** Current and proposed navigation, clearly distinguishing existing routes from recommended future routes.
4. **Visual foundation:** Type roles, semantic color use, surface hierarchy, shape strategy, elevation, icon rules, spacing/density, and motion behavior. Map recommendations to existing tokens whenever possible.
5. **Component patterns:** Compact metric overview, activity list row, evidence link, status/completeness label, filters and view switcher, History row, narrative section, correction/redaction marker, settings row, progress/limit state, empty state, and destructive confirmation.
6. **Screen specifications:** Cover every current and future surface/state listed above—not only the happy path.
7. **Responsive specifications:** Show or describe compact, medium, and expanded compositions, including navigation changes and list-detail/supporting-pane behavior.
8. **High-fidelity key views:** At minimum, provide phone and desktop designs for landing, populated Today with narrative, History list/day detail, and expanded Settings. Also show representative empty, partial/degraded, and destructive states. If visual-generation tools are available, create the mockups rather than describing them only.
9. **Accessibility and content notes:** Focus order, target sizes, announcements, errors, contrast verification, reduced motion, truncation, and long-content behavior.
10. **Implementation handoff:** Map each proposed change to current repo files/components and sequence it against issues #12 through #17. Separate token/shared-component work from route-specific work.
11. **Open decisions:** List only decisions the product owner genuinely needs to make. For each, recommend one option and explain the tradeoff.

## Quality bar

The result is successful when:

- A busy Today journal can be scanned quickly without a wall of cards.
- Expressiveness comes from hierarchy, type, shape contrast, color roles, and purposeful motion—not decoration volume.
- Today, History, Settings, onboarding, and trust pages clearly belong to one product.
- Every incomplete, delayed, limited, corrected, redacted, or failed state remains understandable and honest.
- The factual journal stays usable when AI, GitHub, queues, or budgets are degraded.
- Mobile is a designed composition, not a narrower desktop screenshot.
- The proposal is detailed enough for another engineer to implement without inventing missing visual rules.
- It respects the existing stack, MaterialCN authority, roadmap, privacy model, and out-of-scope boundaries.

End with a short prioritized recommendation: the three visual-system changes that will produce the largest improvement before issue #13 adds the AI narrative.
