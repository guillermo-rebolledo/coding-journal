import { CalendarDays, History, Settings } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeMenu } from "@/components/theme-menu";
import { cn } from "@/lib/utils";

/**
 * The authenticated application shell — the information architecture of the
 * look-and-feel reference (`docs/design/Coding Journal look and feel.html`,
 * frame 1c) and issue #1's final navigation.
 *
 * One `<nav>` element serves every window size class rather than two DOM
 * copies: a bottom navigation bar below 600px, a rail with labels under icons
 * from 600px up. Compact is a composition, not a shrunk desktop header.
 */

type Destination = "today" | "history" | "settings";

const destinations: ReadonlyArray<{
  id: Destination;
  href: string;
  label: string;
  icon: typeof CalendarDays;
}> = [
  { id: "today", href: "/journal", label: "Today", icon: CalendarDays },
  { id: "history", href: "/journal/history", label: "History", icon: History },
  { id: "settings", href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  children,
  current,
  navigation = true,
}: {
  children: ReactNode;
  /** `null` while onboarding: no product navigation until both steps are answered. */
  current: Destination | null;
  navigation?: boolean;
}) {
  return (
    <div className="min-h-screen bg-background">
      <a
        href="#journal-main"
        className={cn(
          "sr-only rounded-m3-xs bg-m3-primary px-4 py-2 text-m3-label-lg text-m3-on-primary",
          "focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50",
        )}
      >
        Skip to content
      </a>

      {navigation ? (
        <nav
          aria-label="Primary"
          className={cn(
            "fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around gap-1",
            "border-t border-m3-outline-variant bg-m3-surface-container px-2 py-2",
            "m3-medium:inset-x-auto m3-medium:top-0 m3-medium:bottom-0 m3-medium:left-0",
            "m3-medium:w-20 m3-medium:flex-col m3-medium:items-center m3-medium:justify-start",
            "m3-medium:gap-2 m3-medium:border-t-0 m3-medium:border-r m3-medium:py-4",
          )}
        >
          <span className="hidden m3-medium:mb-4 m3-medium:block">
            <Link
              href="/journal"
              aria-label="Coding Journal home"
              className="block rounded-m3-md"
            >
              <BrandMark />
            </Link>
          </span>
          {destinations.map(({ id, href, label, icon: Icon }) => {
            const selected = current === id;
            return (
              <Link
                key={id}
                href={href}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "group/dest flex min-h-14 min-w-16 flex-1 flex-col items-center justify-center gap-1",
                  "rounded-m3-md text-m3-label-md m3-medium:flex-none",
                  selected
                    ? "text-m3-on-surface"
                    : "text-m3-on-surface-variant",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-16 place-items-center rounded-m3-full",
                    "transition-colors duration-(--m3-spring-effects-fast-duration) ease-(--m3-spring-effects-fast)",
                    selected
                      ? "bg-m3-secondary-container text-m3-on-secondary-container"
                      : "text-m3-on-surface-variant",
                  )}
                >
                  <Icon aria-hidden className="size-5" />
                </span>
                {label}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <div className={navigation ? "m3-medium:pl-20" : undefined}>
        <header
          className={cn(
            "flex flex-wrap items-center justify-between gap-3",
            "border-b border-m3-outline-variant px-4 py-3 sm:px-6",
          )}
        >
          <Link
            href="/journal"
            className="flex min-h-11 items-center gap-3 rounded-m3-md"
          >
            <span className={navigation ? "m3-medium:hidden" : undefined}>
              <BrandMark />
            </span>
            <span className="text-m3-title-md text-m3-on-surface">
              Coding Journal
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <ThemeMenu />
            <SignOutButton />
          </div>
        </header>

        <main
          id="journal-main"
          className={cn(
            "mx-auto max-w-[100rem] px-4 py-8 sm:px-6 sm:py-12",
            navigation ? "pb-28 m3-medium:pb-12" : undefined,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
