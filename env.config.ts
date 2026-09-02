import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// SAFETY: `@next/env` is a CommonJS package required here so the config loads
// before Next's own ESM entry; the assertion restates its published types.
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");

const isDevelopment =
  process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

loadEnvConfig(process.cwd(), isDevelopment);
