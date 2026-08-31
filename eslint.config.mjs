import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  prettier,
  globalIgnores([".next/**", "coverage/**", "playwright-report/**"]),
]);
