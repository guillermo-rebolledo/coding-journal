import { BookOpen, GitPullRequest, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeMenu } from "@/components/theme-menu";
import { getJournalSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Journal",
};

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const session = await getJournalSession(await headers());

  if (!session) {
    redirect("/sign-in?next=%2Fjournal");
  }

  const firstName = session.user.name.trim().split(/\s+/)[0] || "there";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background">
        <nav
          aria-label="Journal navigation"
          className="mx-auto flex min-h-20 max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6"
        >
          <div className="flex min-h-11 items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-m3-title-md-emphasized">Coding Journal</p>
              <p className="text-m3-body-sm text-muted-foreground">
                Your private journal
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <ThemeMenu />
            <SignOutButton />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-18">
        <p className="text-m3-label-lg-emphasized text-primary">
          MONDAY, AUGUST 31
        </p>
        <h1 className="mt-3 text-m3-headline-lg text-balance">
          Welcome, {firstName}.
        </h1>
        <p className="mt-4 max-w-2xl text-m3-body-lg text-muted-foreground">
          Your authenticated journal shell is ready. GitHub activity will arrive
          in the next slice.
        </p>

        <section aria-labelledby="today-heading" className="mt-12">
          <h2 id="today-heading" className="text-m3-title-lg-emphasized">
            Today at a glance
          </h2>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            {[
              { icon: BookOpen, label: "Journal entries", value: "—" },
              { icon: GitPullRequest, label: "Pull requests", value: "—" },
              { icon: Sparkles, label: "Highlights", value: "—" },
            ].map(({ icon: Icon, label, value }) => (
              <article
                key={label}
                className="rounded-m3-lg bg-card p-6 shadow-m3-1"
              >
                <Icon aria-hidden className="text-primary" />
                <p className="mt-8 text-m3-display-sm">{value}</p>
                <h3 className="mt-2 text-m3-title-md text-muted-foreground">
                  {label}
                </h3>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
