import { actorDiagnosticStages } from "@/lib/github-reconciliation-actor-stage";
import { eventsDiagnosticStages } from "@/lib/github-reconciliation-events-stage";
import { gistsDiagnosticStages } from "@/lib/github-reconciliation-gists-stage";
import { installationDiagnosticStages } from "@/lib/github-reconciliation-installation-stage";

export const providerReconciliationStages = new Set<string>([
  ...actorDiagnosticStages,
  ...eventsDiagnosticStages,
  ...gistsDiagnosticStages,
  ...installationDiagnosticStages,
]);
