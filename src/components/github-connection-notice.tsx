import { StateBlock } from "@/components/journal/state-block";
import type { GitHubConnectionOutcome } from "@/lib/github-connection-status";

const notices: Record<
  GitHubConnectionOutcome,
  {
    title: string;
    detail: string;
    tone: "neutral" | "warning" | "error";
  }
> = {
  connected: {
    title: "GitHub App connected",
    detail:
      "Repository access was verified and saved. Today now reflects the App coverage GitHub granted.",
    tone: "neutral",
  },
  "connection-failed": {
    title: "Connection could not be saved",
    detail:
      "Coding Journal could not finish the connection. Settings and stored journal days remain available; try again, and contact the operator if it continues.",
    tone: "error",
  },
  "identity-mismatch": {
    title: "GitHub identity could not be verified",
    detail:
      "Nothing changed because GitHub answered for a different identity than the account linked to this session. Sign out, sign in with the intended GitHub account, then try again.",
    tone: "error",
  },
  pending: {
    title: "Approval pending",
    detail:
      "An organization owner still needs to approve the request. Your journal remains available with best-effort coverage while you wait.",
    tone: "neutral",
  },
  "invalid-state": {
    title: "Installation link expired",
    detail:
      "Nothing changed. Start the connection again from Settings to create a fresh, identity-bound link.",
    tone: "warning",
  },
  "invalid-installation": {
    title: "Installation could not be connected",
    detail:
      "Nothing changed because the installation was not accessible to your signed-in GitHub identity, belonged to another App, or did not meet the read-only permission policy. Review it on GitHub, then try again.",
    tone: "error",
  },
  reauthorize: {
    title: "GitHub authorization needs renewal",
    detail:
      "Stored journal days remain available. Sign out, sign in with GitHub again, then retry the connection from Settings.",
    tone: "warning",
  },
  "invalid-callback": {
    title: "GitHub returned an incomplete response",
    detail:
      "No access changed. Start again from Settings; if GitHub shows Configure, you can return and check the existing installation.",
    tone: "warning",
  },
  "not-found": {
    title: "No existing installation found",
    detail:
      "Nothing changed. Install the GitHub App, or confirm you are signed in to the GitHub identity that can access the installation.",
    tone: "neutral",
  },
  unavailable: {
    title: "GitHub could not be checked",
    detail:
      "Settings and stored journal days still work. Try checking the existing installation again after GitHub is available.",
    tone: "error",
  },
};

export function GitHubConnectionNotice({
  status,
  className,
}: {
  status: GitHubConnectionOutcome | null;
  className?: string;
}) {
  if (!status) return null;
  const notice = notices[status];
  return (
    <StateBlock
      role={notice.tone === "error" ? "alert" : "status"}
      title={notice.title}
      tone={notice.tone}
      className={className}
    >
      {notice.detail}
    </StateBlock>
  );
}
