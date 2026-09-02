import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { ThemeMenu } from "@/components/theme-menu";
import { TrustNav } from "@/components/trust/trust-nav";
import { buttonVariants } from "@/components/ui/button-variants";
import { trustDocuments } from "@/content/trust";
import type { TrustBlock, TrustDocument } from "@/content/trust/types";
import { cn } from "@/lib/utils";

/**
 * The trust shell — frame 1m of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * Editorial column at 66ch and a deliberately larger reading size than the
 * app, because these pages are read once, carefully, before authorizing
 * anything. Permissions are a definition list rather than cards, per the
 * reference's first rule. The anchored "On this page" nav is a disclosure on
 * compact and a real aside from expanded width; one shell serves all three
 * documents so they cannot drift into three different pages.
 */

function Blocks({ blocks }: { blocks: readonly TrustBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "paragraph") {
          return (
            <p
              key={index}
              className="mt-4 text-m3-body-editorial text-m3-on-surface"
            >
              {block.text}
            </p>
          );
        }

        if (block.kind === "list") {
          return (
            <ul key={index} className="mt-4 divide-y divide-m3-outline-variant">
              {block.items.map((item) => (
                <li
                  key={item}
                  className="py-3 text-m3-body-editorial text-m3-on-surface"
                >
                  {item}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <dl key={index} className="mt-4 divide-y divide-m3-outline-variant">
            {block.items.map(({ term, description }) => (
              <div
                key={term}
                className="grid gap-x-8 gap-y-1 py-4 m3-expanded:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
              >
                <dt className="text-m3-title-sm text-m3-on-surface">{term}</dt>
                <dd className="text-m3-body-editorial text-m3-on-surface-variant">
                  {description}
                </dd>
              </div>
            ))}
          </dl>
        );
      })}
    </>
  );
}

function OnThisPage({ document }: { document: TrustDocument }) {
  return (
    <ol className="mt-3 space-y-1">
      {document.sections.map((section) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            className="flex min-h-11 items-center rounded-m3-xs text-m3-body-md text-m3-on-surface-variant hover:underline focus-visible:underline"
          >
            {section.heading}
          </a>
        </li>
      ))}
    </ol>
  );
}

export function TrustPage({ document }: { document: TrustDocument }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#trust-main"
        className={cn(
          "sr-only rounded-m3-xs bg-m3-primary px-4 py-2 text-m3-label-lg text-m3-on-primary",
          "focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50",
        )}
      >
        Skip to content
      </a>

      <header className="border-b border-m3-outline-variant">
        <nav
          aria-label="Primary navigation"
          className="mx-auto flex min-h-18 max-w-[76rem] items-center justify-between gap-3 px-4 sm:px-6"
        >
          <Link
            href="/"
            className="flex min-h-11 items-center gap-3 rounded-m3-md font-semibold"
          >
            <BrandMark />
            <span className="text-m3-title-md-emphasized">Coding Journal</span>
          </Link>
          <div className="flex items-center gap-1">
            <ThemeMenu />
            <Link
              href="/sign-in"
              className={buttonVariants({ variant: "outline" })}
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      <div className="mx-auto grid max-w-[76rem] gap-10 px-4 py-10 m3-expanded:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] m3-expanded:gap-16 sm:px-6 sm:py-14">
        <nav
          aria-label="On this page"
          className="min-w-0 m3-expanded:sticky m3-expanded:top-10 m3-expanded:self-start"
        >
          {/*
            Compact gets a collapsed disclosure, expanded gets the standing
            anchor list. Only one is ever displayed, so the accessibility tree
            has a single copy despite the two markup variants.
          */}
          <details className="m3-expanded:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-m3-label-lg text-m3-on-surface-variant">
              On this page
            </summary>
            <OnThisPage document={document} />
          </details>
          <div className="hidden m3-expanded:block">
            <p className="text-m3-label-lg text-m3-on-surface-variant">
              On this page
            </p>
            <OnThisPage document={document} />
          </div>

          <p className="mt-6 text-m3-label-lg text-m3-on-surface-variant">
            More
          </p>
          <ol className="mt-3 space-y-1">
            {trustDocuments
              .filter((other) => other.slug !== document.slug)
              .map((other) => (
                <li key={other.slug}>
                  <Link
                    href={`/${other.slug}`}
                    className="flex min-h-11 items-center rounded-m3-xs text-m3-body-md text-m3-on-surface-variant hover:underline focus-visible:underline"
                  >
                    {other.navLabel}
                  </Link>
                </li>
              ))}
          </ol>
        </nav>

        <main id="trust-main" className="max-w-[66ch] min-w-0">
          <p className="text-m3-label-lg text-m3-on-surface-variant">
            Last updated {document.lastUpdated}
          </p>
          <h1 className="mt-2 text-m3-headline-lg text-balance">
            {document.title}
          </h1>
          <p className="mt-4 text-m3-body-editorial text-m3-on-surface-variant">
            {document.lede}
          </p>

          {document.sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-heading`}
              className="mt-12 scroll-mt-8"
            >
              <h2
                id={`${section.id}-heading`}
                className="text-m3-headline-md text-balance"
              >
                {section.heading}
              </h2>
              <Blocks blocks={section.blocks} />
            </section>
          ))}
        </main>
      </div>

      <footer className="border-t border-m3-outline-variant px-4 py-8 sm:px-6">
        <TrustNav
          current={document.slug}
          className="mx-auto max-w-[76rem] gap-y-1 text-m3-body-sm text-m3-on-surface-variant"
        />
      </footer>
    </div>
  );
}
