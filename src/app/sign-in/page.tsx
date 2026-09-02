import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { GitHubSignInButton } from "@/components/github-sign-in-button";
import { ThemeMenu } from "@/components/theme-menu";
import { trustDocuments } from "@/content/trust";

export const metadata: Metadata = {
  title: "Sign in",
};

const errors: Record<string, string> = {
  access_denied:
    "GitHub sign-in was cancelled. You can try again when you’re ready.",
  email_not_found:
    "GitHub did not provide a usable profile. Check the app’s email permission, then try again.",
  email_is_missing:
    "GitHub did not provide a usable profile. Check the app’s email permission, then try again.",
};

/**
 * Sign-in — frame 1l of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * The one card that earns elevation: a single focused decision on an otherwise
 * empty page. Errors sit above the action and never replace it, so the
 * recovery path is always the same button.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error
    ? (errors[error] ?? "GitHub sign-in did not finish. Please try again.")
    : null;

  return (
    <main className="grid min-h-screen place-items-center bg-m3-surface-container-low px-4 py-10">
      <section
        aria-labelledby="sign-in-title"
        className="w-full max-w-md rounded-m3-xl bg-m3-surface p-7 shadow-m3-3 sm:p-9"
      >
        <div className="flex items-center justify-between">
          <Link
            href="/"
            aria-label="Coding Journal home"
            className="rounded-m3-md"
          >
            <BrandMark />
          </Link>
          <ThemeMenu />
        </div>
        <h1
          id="sign-in-title"
          className="mt-10 text-m3-headline-sm text-balance"
        >
          Pick up the thread of your day.
        </h1>
        <p className="mt-3 text-m3-body-md text-m3-on-surface-variant">
          Sign in with GitHub to open your private journal. No password is
          needed.
        </p>
        {message ? (
          <p
            role="alert"
            className="mt-6 rounded-m3-md bg-m3-error-container px-4 py-3 text-m3-body-md text-m3-on-error-container"
          >
            {message}
          </p>
        ) : null}
        <div className="mt-7">
          <GitHubSignInButton />
        </div>
        <p className="mt-6 text-m3-body-sm text-m3-on-surface-variant">
          Basic profile and email only. Provider tokens stay on the server and
          are encrypted before storage.
        </p>
        <nav
          aria-label="Trust pages"
          className="mt-4 flex flex-wrap items-center gap-x-5 text-m3-body-sm text-m3-on-surface-variant"
        >
          {trustDocuments.map((trustDocument) => (
            <Link
              key={trustDocument.slug}
              href={`/${trustDocument.slug}`}
              className="flex min-h-11 items-center rounded-m3-xs underline underline-offset-2"
            >
              {trustDocument.navLabel}
            </Link>
          ))}
        </nav>
      </section>
    </main>
  );
}
