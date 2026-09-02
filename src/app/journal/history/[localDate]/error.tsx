"use client";

import Link from "next/link";
import { useEffect } from "react";

import { JournalDayBoundary } from "@/components/journal/journal-day-boundary";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";

export default function JournalDayError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <JournalDayBoundary
      title="This journal day could not open"
      actions={
        <>
          <Button type="button" onClick={retry}>
            Try again
          </Button>
          <Link
            href="/journal/history"
            className={buttonVariants({ variant: "outline" })}
          >
            Back to History
          </Link>
          <Link
            href="/journal"
            className={buttonVariants({ variant: "ghost" })}
          >
            Go to Today
          </Link>
        </>
      }
    >
      This day could not be displayed. The rest of your journal is still
      available. Try again now, or return to History or Today.
    </JournalDayBoundary>
  );
}
