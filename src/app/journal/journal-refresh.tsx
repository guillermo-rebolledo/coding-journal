"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  refreshTodayJournal,
  type RefreshActionResult,
} from "@/app/journal/actions";
import { LimitNotice } from "@/components/journal/limit-notice";
import { Button } from "@/components/ui/button";

const storedReloadIntervalMs = 30 * 60 * 1000;

/**
 * The day's one primary action, sitting in the masthead per frame 1g of the
 * look-and-feel reference. The next allowed sync sits directly under it,
 * because the action result — not the stored journal — is what knows about a
 * provider rate limit that outlasts the ordinary cooldown.
 */
export function JournalRefresh({
  nextSyncAt,
  timeZone,
}: {
  nextSyncAt: string | null;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RefreshActionResult | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, storedReloadIntervalMs);
    return () => window.clearInterval(interval);
  }, [router]);

  const availableAt = result?.nextSyncAt ?? nextSyncAt;

  return (
    <div>
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              const nextResult = await refreshTodayJournal();
              setResult(nextResult);
            } catch {
              setResult({
                outcome: "unavailable",
                message:
                  "Stored activity is reloading. GitHub sync could not start.",
                nextSyncAt: null,
              });
            } finally {
              router.refresh();
            }
          })
        }
      >
        <RotateCcw
          aria-hidden
          className={pending ? "animate-spin motion-reduce:animate-none" : ""}
        />
        {pending ? "Refreshing…" : "Refresh Today"}
      </Button>
      {availableAt ? (
        <p className="mt-2 text-m3-body-sm text-m3-on-surface-variant">
          Next GitHub sync{" "}
          <time dateTime={availableAt} className="tabular-nums">
            {new Intl.DateTimeFormat("en-US", {
              timeZone,
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(availableAt))}
          </time>
        </p>
      ) : null}
      {/*
       * A refused refresh is shown, not only announced: the same limit band
       * every other boundary uses, in the slot directly under the action.
       * Everything already recorded stays exactly as it was above it.
       */}
      {result && result.outcome === "limited" ? (
        <LimitNotice message={result.message} className="mt-3 max-w-[42ch]" />
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {result?.message ?? ""}
      </p>
    </div>
  );
}
