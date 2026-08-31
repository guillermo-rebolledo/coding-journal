import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/db/auth-schema";
import { getRequiredEnv } from "@/lib/env";

export const db = drizzle(neon(getRequiredEnv("DATABASE_URL")), { schema });
