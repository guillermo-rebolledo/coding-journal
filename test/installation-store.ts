import { vi } from "vitest";

import type { InstallationStore } from "@/lib/github-installation";

/**
 * A stand-in installation repository. Every member is observable, so a test
 * can assert on what the operation under test actually wrote rather than on a
 * replaced module.
 */
export function installationStore() {
  return {
    consumeInstallationState:
      vi.fn<InstallationStore["consumeInstallationState"]>(),
    deletePendingInstallation:
      vi.fn<InstallationStore["deletePendingInstallation"]>(),
    findInstallations: vi.fn<InstallationStore["findInstallations"]>(),
    insertInstallationState:
      vi.fn<InstallationStore["insertInstallationState"]>(),
    insertPendingInstallation:
      vi.fn<InstallationStore["insertPendingInstallation"]>(),
    markInstallationDisconnected:
      vi.fn<InstallationStore["markInstallationDisconnected"]>(),
    setGitHubAccessMode: vi.fn<InstallationStore["setGitHubAccessMode"]>(),
    upsertActiveInstallation:
      vi.fn<InstallationStore["upsertActiveInstallation"]>(),
  } satisfies InstallationStore;
}
