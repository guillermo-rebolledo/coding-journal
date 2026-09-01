"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  refreshTodayJournal,
  type RefreshActionResult,
} from "@/app/journal/actions";
import { Button } from "@/components/ui/button";

const storedReloadIntervalMs = 30 * 60 * 1000;

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
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
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
        <p className="text-m3-body-sm text-muted-foreground">
          Next GitHub sync{" "}
          <time dateTime={availableAt}>
            {new Intl.DateTimeFormat("en-US", {
              timeZone,
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(availableAt))}
          </time>
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {result?.message ?? ""}
      </p>
    </div>
  );
}
