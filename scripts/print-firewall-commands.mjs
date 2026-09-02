#!/usr/bin/env node
import { readFile } from "node:fs/promises";

/**
 * Prints the `vercel firewall` commands that stage the checked-in production
 * WAF configuration (`docs/operations/firewall-rules.json`).
 *
 * It deliberately prints rather than runs. Firewall rules sit in front of
 * every request, so the person applying them should read the diff and publish
 * themselves. Pass `--enforce` once the log stage has been reviewed; without
 * it every rule is staged in `log` mode, which records matches and blocks
 * nothing.
 */

const enforce = process.argv.includes("--enforce");
const manifestPath = new URL(
  "../docs/operations/firewall-rules.json",
  import.meta.url,
);

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

function quote(value) {
  return `'${JSON.stringify(value).replaceAll("'", `'\\''`)}'`;
}

const lines = [];
for (const rule of manifest.rules) {
  const parts = [`vercel firewall rules add ${JSON.stringify(rule.name)}`];
  for (const condition of rule.conditions) {
    parts.push(`  --condition ${quote(condition)}`);
  }

  const action = enforce ? rule.action : "log";
  parts.push(`  --action ${action}`);

  if (enforce && rule.action === "rate_limit") {
    const limit = rule.rateLimit;
    parts.push(`  --rate-limit-window ${limit.window}`);
    parts.push(`  --rate-limit-requests ${limit.requests}`);
    for (const key of limit.keys) parts.push(`  --rate-limit-keys ${key}`);
    parts.push(`  --rate-limit-action ${limit.action}`);
  }

  parts.push("  --yes");
  lines.push(`# ${rule.why}`);
  lines.push(parts.join(" \\\n"));
  lines.push("");
}

console.log(`# ${manifest.description}`);
console.log(
  enforce
    ? "# Enforcing mode: publish only after reviewing the log-stage traffic.\n"
    : "# Log mode: these rules record matches and block nothing. Re-run with --enforce to stage enforcement.\n",
);
console.log(lines.join("\n"));
console.log("# Review and publish:");
console.log("vercel firewall diff");
console.log("vercel firewall publish --yes");
