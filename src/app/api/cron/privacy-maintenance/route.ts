import { runPrivacyMaintenance } from "@/lib/privacy-maintenance";
import { authorizeOperationsRequest } from "@/lib/operations-auth";

export async function GET(request: Request) {
  if (!authorizeOperationsRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await runPrivacyMaintenance(new Date()));
}
