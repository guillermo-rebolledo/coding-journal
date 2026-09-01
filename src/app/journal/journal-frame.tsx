import { Settings } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeMenu } from "@/components/theme-menu";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export function JournalFrame({
  children,
  current = "today",
}: {
  children: ReactNode;
  current?: "today" | "history";
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background">
        <nav
          aria-label="Journal navigation"
          className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"
        >
          <Link href="/journal" className="flex min-h-11 items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-m3-title-md-emphasized">Coding Journal</p>
              <p className="text-m3-body-sm text-muted-foreground">
                Your private journal
              </p>
            </div>
          </Link>
          <div className="order-3 flex w-full rounded-m3-full bg-m3-surface-container p-1 sm:order-none sm:w-auto">
            <Link
              href="/journal"
              aria-current={current === "today" ? "page" : undefined}
              className={cn(
                "text-m3-label-lg-emphasized min-h-11 flex-1 rounded-m3-full px-5 py-3 text-center sm:flex-none",
                current === "today" && "bg-card text-primary shadow-m3-1",
              )}
            >
              Today
            </Link>
            <Link
              href="/journal/history"
              aria-current={current === "history" ? "page" : undefined}
              className={cn(
                "text-m3-label-lg-emphasized min-h-11 flex-1 rounded-m3-full px-5 py-3 text-center sm:flex-none",
                current === "history" && "bg-card text-primary shadow-m3-1",
              )}
            >
              History
            </Link>
          </div>
          <div className="flex items-start gap-2">
            <Link
              href="/settings"
              aria-label="Settings"
              className={buttonVariants({
                variant: "ghost",
                size: "icon-lg",
                shape: "round",
              })}
            >
              <Settings aria-hidden />
            </Link>
            <ThemeMenu />
            <SignOutButton />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
        {children}
      </main>
    </div>
  );
}
