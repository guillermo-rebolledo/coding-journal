import { ArrowLeft, GitBranch } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { GitHubAccessOverview } from "@/components/github-access-overview";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeMenu } from "@/components/theme-menu";
import { buttonVariants } from "@/components/ui/button-variants";
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
      </main>
    </div>
  );
}
