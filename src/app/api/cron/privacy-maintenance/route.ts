import { runPrivacyMaintenance } from "@/lib/privacy-maintenance";

import { createPrivacyMaintenanceRoute } from "./handler";

export const GET = createPrivacyMaintenanceRoute({
  run: runPrivacyMaintenance,
});
