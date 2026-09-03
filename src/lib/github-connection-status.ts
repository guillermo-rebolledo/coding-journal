export type GitHubConnectionOutcome =
  | "connected"
  | "connection-failed"
  | "identity-mismatch"
  | "invalid-callback"
  | "invalid-installation"
  | "invalid-state"
  | "not-found"
  | "pending"
  | "reauthorize"
  | "unavailable";

export function readGitHubConnectionOutcome(
  value: string | string[] | undefined,
): GitHubConnectionOutcome | null {
  switch (value) {
    case "connected":
    case "connection-failed":
    case "identity-mismatch":
    case "invalid-callback":
    case "invalid-installation":
    case "invalid-state":
    case "not-found":
    case "pending":
    case "reauthorize":
    case "unavailable":
      return value;
    default:
      return null;
  }
}
