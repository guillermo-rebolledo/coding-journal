import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The preinstall guard must remain directly executable by Node.
import { getUnsupportedNodeMessage } from "../../scripts/check-node-version.mjs";

const temporaryDirectories: string[] = [];
const envConfigUrl = pathToFileURL(join(process.cwd(), "env.config.ts")).href;
const drizzleKitPath = join(process.cwd(), "node_modules/drizzle-kit/bin.cjs");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function loadDatabaseUrl(
  nodeEnvironment: "development" | "production",
  files: Record<string, string>,
) {
  const directory = mkdtempSync(join(tmpdir(), "coding-journal-env-"));
  temporaryDirectories.push(directory);

  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(directory, name), `DATABASE_URL=${value}\n`);
  }

  const environmentWithoutDatabaseUrl = { ...process.env };
  delete environmentWithoutDatabaseUrl.DATABASE_URL;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(envConfigUrl)}); process.stdout.write(process.env.DATABASE_URL ?? "");`,
    ],
    {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...environmentWithoutDatabaseUrl,
        NODE_ENV: nodeEnvironment,
      },
    },
  );

  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout;
}

describe("local setup configuration", () => {
  it("accepts Node 24 and rejects unsupported Node versions", () => {
    expect(getUnsupportedNodeMessage("24.20.0")).toBeNull();
    expect(getUnsupportedNodeMessage("v26.7.0")).toContain(
      "requires Node.js 24.x",
    );
  });

  it("loads development env files using Next.js precedence", () => {
    expect(
      loadDatabaseUrl("development", {
        ".env": "postgresql://env",
        ".env.local": "postgresql://local",
        ".env.development": "postgresql://development",
        ".env.development.local": "postgresql://development-local",
      }),
    ).toBe("postgresql://development-local");
  });

  it("loads production env files using Next.js precedence", () => {
    expect(
      loadDatabaseUrl("production", {
        ".env": "postgresql://env",
        ".env.local": "postgresql://local",
        ".env.production": "postgresql://production",
        ".env.production.local": "postgresql://production-local",
      }),
    ).toBe("postgresql://production-local");
  });

  it("loads the config through Drizzle Kit", () => {
    const result = spawnSync(process.execPath, [drizzleKitPath, "generate"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://localhost/test",
        NODE_ENV: "development",
      },
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No schema changes");
  });
});
