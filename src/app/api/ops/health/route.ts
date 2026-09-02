import { serviceHealthReport } from "@/lib/service-health";

import { createOperationsHealthRoute } from "./handler";

export const dynamic = "force-dynamic";

export const GET = createOperationsHealthRoute({ report: serviceHealthReport });
