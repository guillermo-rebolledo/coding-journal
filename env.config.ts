import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");

const isDevelopment =
  process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

loadEnvConfig(process.cwd(), isDevelopment);
