import { getUserGitHubInstallation } from "@/lib/github-app";
import {
  consumeGitHubInstallationState,
  disconnectGitHubInstallation,
  saveGitHubInstallation,
  savePendingGitHubInstallation,
} from "@/lib/github-installation";
import { getGitHubUserAccessToken } from "@/lib/github-user-token";
import { getJournalSession } from "@/lib/session";

import { createGitHubCallbackRoute } from "./handler";

export const GET = createGitHubCallbackRoute({
  getSession: getJournalSession,
  consumeState: consumeGitHubInstallationState,
  getAccessToken: getGitHubUserAccessToken,
  getInstallation: getUserGitHubInstallation,
  saveInstallation: saveGitHubInstallation,
  savePendingInstallation: savePendingGitHubInstallation,
  disconnectInstallation: disconnectGitHubInstallation,
});
