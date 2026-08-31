import {
  ArrowRight,
  CalendarDays,
  GitCommitHorizontal,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { SiteHeader } from "@/components/site-header";

const benefits = [
  {
    icon: GitCommitHorizontal,
    title: "See the work, not the noise",
    copy: "Turn commits, pull requests, and reviews into a clear account of what moved forward.",
  },
  {
    icon: Sparkles,
    title: "Remember the thread",
    copy: "Keep the decisions and momentum that disappear between tabs, tools, and stand-ups.",
  },
  {
    icon: CalendarDays,
    title: "Build a useful record",
    copy: "Return to any day with a journal designed for reflection, updates, and planning.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main>
        <section className="mx-auto grid max-w-6xl gap-12 px-4 py-18 sm:px-6 sm:py-24 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-32">
          <div>
            <p className="text-m3-label-lg-emphasized mb-5 text-primary">
              A daily record for people who make software
            </p>
            <h1 className="max-w-3xl text-m3-display-lg text-balance">
              Your GitHub day, distilled.
            </h1>
            <p className="mt-6 max-w-2xl text-m3-body-lg text-muted-foreground">
              Coding Journal gathers the shape of your work into one calm,
              readable daily view—so progress is easier to understand and easier
              to share.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link href="/sign-in" className={buttonVariants({ size: "lg" })}>
                Start your journal
                <ArrowRight aria-hidden />
              </Link>
              <p className="text-m3-body-sm text-muted-foreground">
                Private by default. GitHub sign-in required.
              </p>
            </div>
          </div>

          <div
            aria-label="Example journal summary"
            className="rounded-m3-2xl bg-m3-surface-container-low p-5 shadow-m3-2 sm:p-7"
          >
            <div className="flex items-center justify-between border-b border-border pb-5">
              <div>
                <p className="text-m3-label-md text-muted-foreground">TODAY</p>
                <p className="text-m3-title-lg-emphasized mt-1">
                  Monday, August 31
                </p>
              </div>
              <span className="bg-secondary-container text-m3-label-md-emphasized rounded-m3-full px-4 py-2 text-secondary-foreground">
                6 contributions
              </span>
            </div>
            <div className="grid gap-4 pt-5">
              <article className="bg-surface rounded-m3-lg p-5">
                <p className="text-m3-label-md text-primary">SHIPPED</p>
                <h2 className="text-m3-title-md-emphasized mt-2">
                  Authentication flow ready for review
                </h2>
                <p className="mt-2 text-m3-body-sm text-muted-foreground">
                  3 commits · 1 pull request · 2 reviews
                </p>
              </article>
              <article className="bg-surface rounded-m3-lg p-5">
                <p className="text-m3-label-md text-primary">
                  THREAD TO PICK UP
                </p>
                <h2 className="text-m3-title-md-emphasized mt-2">
                  Finish the journal timeline states
                </h2>
              </article>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="why-heading"
          className="bg-m3-surface-container-low py-18 sm:py-24"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2
              id="why-heading"
              className="max-w-2xl text-m3-headline-lg text-balance"
            >
              Close the day knowing what actually happened.
            </h2>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {benefits.map(({ icon: Icon, title, copy }) => (
                <article
                  key={title}
                  className="rounded-m3-lg bg-card p-6 shadow-m3-1"
                >
                  <span className="bg-primary-container grid size-12 place-items-center rounded-m3-lg text-primary">
                    <Icon aria-hidden />
                  </span>
                  <h3 className="text-m3-title-lg-emphasized mt-6">{title}</h3>
                  <p className="mt-3 text-m3-body-md text-muted-foreground">
                    {copy}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-border px-4 py-8 text-center text-m3-body-sm text-muted-foreground">
        Coding Journal is open source and made for thoughtful work.
      </footer>
    </div>
  );
}
