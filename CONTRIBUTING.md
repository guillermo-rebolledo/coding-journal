# Contributing

Thanks for helping improve Coding Journal.

## Development workflow

1. Create a focused branch from `main`.
2. Follow the setup in `README.md`.
3. Add behavior tests at an application boundary. Mock external systems only at their narrow repository adapters (`lib/session.ts` and `lib/auth-client.ts` for Better Auth, GitHub, and Neon); never mock product collaborators. Security-critical integration options may also have focused configuration-contract tests.
4. Run `pnpm check`, then `pnpm test:e2e` for user-facing changes.
5. Open a pull request that explains the user-visible outcome and links the relevant issue.

Keep secrets out of commits, fixtures, screenshots, and logs. By contributing, you agree that your work is licensed under the MIT License.
