import { loadEnvConfig } from "@next/env";

const isDevelopment =
  process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

loadEnvConfig(process.cwd(), isDevelopment);
