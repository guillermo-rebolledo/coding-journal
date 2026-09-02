"use client";

import { useActionState } from "react";

import type { HistoryActionResult } from "@/app/journal/history/history-actions";
import { LimitNotice } from "@/components/journal/limit-notice";
import { Button } from "@/components/ui/button";

const idle: HistoryActionResult = { status: "idle", message: "" };

/**
 * A finalization retry and a narrative redaction both cost real work, so both
 * are bounded. The refusal is announced in the same slot the action lives in,
 * as a status rather than an alert: nothing on the page has broken, and the
 * finalized day beside it is still exactly as readable as it was.
 */
export function HistoryActionForm({
  action,
  label,
}: {
  action: () => Promise<HistoryActionResult>;
  label: string;
}) {
  const [result, submit, pending] = useActionState<HistoryActionResult>(
    async () => action(),
    idle,
  );

  return (
    <form action={submit}>
      <Button type="submit" variant="outline" disabled={pending}>
        {label}
      </Button>
      {result.status === "idle" ? (
        <p role="status" aria-live="polite" className="sr-only" />
      ) : result.status === "accepted" ? (
        <p role="status" aria-live="polite" className="mt-3 text-m3-body-md">
          {result.message}
        </p>
      ) : (
        <LimitNotice message={result.message} className="mt-3" />
      )}
    </form>
  );
}
