# Contributing

Thanks for helping improve Coding Journal.

## Development workflow

1. Create a focused branch from `main`.
2. Follow the setup in [README](README.md).
3. Add behaviour tests at an application boundary. Mock external systems only at
   their narrow repository adapters (`lib/session.ts` and `lib/auth-client.ts`
   for Better Auth, GitHub, and Neon); never mock product collaborators.
   Security-critical integration options may also have focused
   configuration-contract tests.
4. Run `pnpm check`, then `pnpm test:e2e` for user-facing changes.
5. Open a pull request that explains the user-visible outcome and links the
   relevant issue.

## Conventions worth knowing before your first change

- **Use the [architecture vocabulary](README.md#architecture-vocabulary).** If
  the word you need is not there, that is a signal — either the concept is new
  and belongs in the table, or you are inventing a synonym for something that
  already has a name.
- **Check UI work against the design reference.** The approved look and feel is
  `docs/design/Coding Journal look and feel.html`; `docs/design/README.md`
  indexes its frames and states the rules that decide most reviews — lists
  before cards, one display-scale element per screen, honesty stated in words
  rather than colour, and semantic roles only so all four palettes keep working
  in light and dark. Link the reference from every UI issue.
- **Install UI primitives from MaterialCN** (`pnpm exec shadcn add
@materialcn/<component>`) rather than hand-rolling them. Where the registry
  has no primitive, build a project component under `src/components/journal/`
  and record the gap in [the release gate](docs/release-gate.md).
- **Every refused request says the same three things**: what happened, what
  still works, and when it returns.
- **Accessibility is not a follow-up.** New routes belong in
  `e2e/accessibility.spec.ts` and `e2e/responsive.spec.ts`; see
  [Accessibility](docs/accessibility.md) for the standard and the manual review.
- **Changing what the product does with data changes the trust pages.** They
  live in `src/content/trust/` and are tested in
  `src/content/trust/trust-documents.test.ts`. A permission, retention window or
  quota is described in exactly one place.

## Issues

Issues are tracked in this repository's GitHub Issues. `docs/agents/` records
the conventions the automated workflows follow, including the triage labels.

## Security and secrets

Keep secrets out of commits, fixtures, screenshots, and logs — `.env.example`
carries names with empty values, and every real environment file is ignored.
Report a suspected vulnerability privately through the flow in
[SECURITY](SECURITY.md) rather than in a public issue.

By contributing, you agree that your work is licensed under the MIT License.
