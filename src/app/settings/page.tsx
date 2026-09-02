import { ArrowLeft, GitBranch } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { GitHubAccessOverview } from "@/components/github-access-overview";
import { PalettePicker } from "@/components/palette-picker";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeMenu } from "@/components/theme-menu";
import { buttonVariants } from "@/components/ui/button-variants";
import { Button } from "@/components/ui/button";
import { deleteAccount } from "@/app/settings/actions";
import { refreshGitHubConnections } from "@/lib/github-connection";
import { getJournalOnboarding } from "@/lib/journal";
import { getJournalSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const requestHeaders = await headers();
  const session = await getJournalSession(requestHeaders);
  if (!session) redirect("/sign-in?next=%2Fsettings");

  const [onboarding, installations] = await Promise.all([
    getJournalOnboarding(session.user.id),
    refreshGitHubConnections(requestHeaders, session.user.id),
  ]);
  const hasInstallation = installations.some(
    (installation) => installation.status === "active",
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background">
        <nav
          aria-label="Settings navigation"
          className="mx-auto flex min-h-20 max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6"
        >
          <Link href="/journal" className="flex min-h-11 items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-m3-title-md-emphasized">Coding Journal</p>
              <p className="text-m3-body-sm text-muted-foreground">Settings</p>
            </div>
          </Link>
          <div className="flex items-start gap-2">
            <ThemeMenu />
            <SignOutButton />
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
        <Link
          href="/journal"
          className={cn(buttonVariants({ variant: "ghost" }), "-ml-4")}
        >
          <ArrowLeft aria-hidden />
          Back to Today
        </Link>

        <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="text-m3-label-lg-emphasized text-primary">
              CONNECTIONS
            </p>
            <h1 className="mt-3 text-m3-headline-lg">GitHub access</h1>
            <p className="mt-4 max-w-2xl text-m3-body-lg text-muted-foreground">
              Review exactly what GitHub has granted. Coding Journal never
              claims coverage outside these installations.
            </p>
          </div>
          <Link
            href="/api/github/install?from=settings"
            className={cn(buttonVariants({ size: "lg" }), "w-full lg:w-auto")}
          >
            <GitBranch aria-hidden />
            {hasInstallation
              ? "Add another installation"
              : "Install GitHub App"}
          </Link>
        </div>

        <section aria-label="GitHub connection status" className="mt-9">
          <GitHubAccessOverview
            accessMode={onboarding.githubAccessMode}
            installations={installations}
          />
        </section>

        <aside className="bg-secondary-container mt-8 rounded-m3-xl p-5 text-secondary-foreground sm:p-6">
          <h2 className="text-m3-title-md-emphasized">Private by design</h2>
          <p className="mt-2 text-m3-body-md">
            OAuth and installation credentials stay encrypted on the server.
            Repository names and private visibility are handled only on the
            signed-in server boundary and are excluded from telemetry.
          </p>
        </aside>

        <section aria-labelledby="privacy-heading" className="mt-14">
          <p className="text-m3-label-lg-emphasized text-primary">PRIVACY</p>
          <h2 id="privacy-heading" className="mt-3 text-m3-headline-lg">
            Access and retention
          </h2>
          <div className="mt-5 grid gap-4 text-m3-body-md text-muted-foreground">
            <p>
              Coding Journal processes only the GitHub account and active App
              installations shown above. Suspending or removing access stops new
              processing; inaccessible private details are removed from stored
              activity and replaced by a neutral marker in history.
            </p>
            <p>
              Normalized GitHub activity is retained for 30 days. Final daily
              summaries and aggregate counts remain so journal history still
              works without repository-level details.
            </p>
            <p>
              You can revoke installation access in{" "}
              <a
                href="https://github.com/settings/installations"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-4"
              >
                GitHub App settings
              </a>{" "}
              or revoke the OAuth grant in{" "}
              <a
                href="https://github.com/settings/applications"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-4"
              >
                GitHub application settings
              </a>
              .
            </p>
          </div>

          <div className="mt-8 rounded-m3-xl bg-m3-error-container p-5 text-m3-on-error-container sm:p-6">
            <h3 className="text-m3-title-lg-emphasized">Delete account</h3>
            <p className="mt-2 max-w-2xl text-m3-body-md">
              This permanently deletes your journal, summaries, settings, and
              every session. Coding Journal will also revoke its GitHub OAuth
              grant when GitHub is reachable. This cannot be undone.
            </p>
            <form
              action={deleteAccount}
              className="mt-5 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end"
            >
              <label className="text-m3-label-lg-emphasized flex-1">
                Type DELETE to confirm
                <input
                  name="confirmation"
                  required
                  pattern="DELETE"
                  autoComplete="off"
                  className="mt-2 min-h-12 w-full rounded-m3-md border border-m3-error bg-background px-4 text-m3-body-md text-foreground"
                />
              </label>
              <Button type="submit" variant="destructive" className="sm:mb-0.5">
                Delete my account
              </Button>
            </form>
          </div>
        </section>

        <section aria-labelledby="appearance-heading" className="mt-14">
          <p className="text-m3-label-lg-emphasized text-primary">APPEARANCE</p>
          <h2 id="appearance-heading" className="mt-3 text-m3-headline-lg">
            Theme
          </h2>
          <p className="mt-4 max-w-2xl text-m3-body-lg text-muted-foreground">
            Pick the palette every screen uses, in both light and dark mode. The
            choice applies to this browser right away.
          </p>
          <div className="mt-7">
            <PalettePicker />
          </div>
        </section>
      </main>
    </div>
  );
}
