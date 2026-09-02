import Link from "next/link";

import { JournalDayBoundary } from "@/components/journal/journal-day-boundary";
import { buttonVariants } from "@/components/ui/button-variants";

export default function JournalDayNotFound() {
  return (
    <>
      <title>Journal day unavailable · Coding Journal</title>
      <JournalDayBoundary
        title="This journal day is no longer here"
        actions={
          <>
            <Link href="/journal/history" className={buttonVariants()}>
              Back to History
            </Link>
            <Link
              href="/journal"
              className={buttonVariants({ variant: "outline" })}
            >
              Go to Today
            </Link>
          </>
        }
      >
        Retention removed this day after 30 days. The rest of your journal is
        intact. Removed days are not hidden and do not return.
      </JournalDayBoundary>
    </>
  );
}
