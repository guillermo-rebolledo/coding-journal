"use client";

import { useSearchParams } from "next/navigation";

/**
 * The deletion confirmation of frame 1o. It lands on the landing page because
 * the account it would have belonged to no longer exists, and it names the one
 * thing deletion cannot do.
 *
 * It reads the query string on the client so the landing page — the most
 * visited public route — stays statically prerendered instead of becoming a
 * function invocation for every visitor.
 */
export function DeletedAccountNotice() {
  // Rendered outside a router — a unit test, or a tree mounted before the
  // app router exists — there is no query to read, which is the same outcome
  // as an ordinary visit.
  const account = useSearchParams()?.get("account") ?? null;
  return <DeletedAccountNoticeView account={account} />;
}

/**
 * The notice itself, given the `account` query value. Keeping the reading and
 * the rendering apart lets a caller — including a test — state the outcome it
 * is describing instead of arranging a router around it.
 */
export function DeletedAccountNoticeView({
  account,
}: {
  account: string | null;
}) {
  if (account !== "deleted") return null;

  return (
    <div role="status" className="mx-auto max-w-[76rem] px-4 pt-8 sm:px-6">
      <div className="rounded-m3-md bg-m3-surface-container p-5 sm:p-6">
        <p className="text-m3-title-sm text-m3-on-surface">
          Your account is deleted
        </p>
        <p className="mt-1 max-w-[62ch] text-m3-body-md text-m3-on-surface-variant">
          Every journal day, narrative and stored activity has been removed and
          all sessions ended. The GitHub App may still be installed on your
          account — remove it on GitHub if you want to.
        </p>
      </div>
    </div>
  );
}
