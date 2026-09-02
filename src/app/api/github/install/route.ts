import { createGitHubInstallationState } from "@/lib/github-installation";
import { getJournalSession } from "@/lib/session";

import { createInstallStartRoute } from "./handler";

export const GET = createInstallStartRoute({
  getSession: getJournalSession,
  createState: createGitHubInstallationState,
});
