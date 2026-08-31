import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { ThemeMenu } from "@/components/theme-menu";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-background/90 backdrop-blur">
      <nav
        aria-label="Primary navigation"
        className="mx-auto flex min-h-18 max-w-6xl items-center justify-between px-4 sm:px-6"
      >
        <Link
          href="/"
          className="flex min-h-11 items-center gap-3 rounded-m3-md font-semibold"
        >
          <BrandMark />
          <span className="text-m3-title-md-emphasized">Coding Journal</span>
        </Link>
        <ThemeMenu />
      </nav>
    </header>
  );
}
