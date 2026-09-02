import { describe, expect, it } from "vitest";

import {
  dataAccessDocument,
  privacyDocument,
  termsDocument,
  trustDocuments,
} from "@/content/trust";
import type { TrustDocument } from "@/content/trust/types";

function textOf(document: TrustDocument) {
  const parts = [document.title, document.lede];
  for (const section of document.sections) {
    parts.push(section.heading);
    for (const block of section.blocks) {
      if (block.kind === "paragraph") parts.push(block.text);
      else if (block.kind === "list") parts.push(...block.items);
      else
        parts.push(
          ...block.items.map(
            ({ term, description }) => `${term} ${description}`,
          ),
        );
    }
  }
  return parts.join("\n");
}

/**
 * Issue #17's first acceptance criterion is a claim about content, so it is
 * tested as one: each subject a reader must be able to find before authorizing
 * has to be described somewhere across the three documents.
 */
describe("trust documents", () => {
  it("describes each GitHub permission it requests and refuses the rest", () => {
    const text = textOf(dataAccessDocument);

    for (const permission of [
      "Contents",
      "Issues",
      "Pull requests",
      "Discussions",
      "Actions",
      "Deployments",
      "Packages",
      "Metadata",
      "Projects",
      "Email addresses",
    ]) {
      expect(text).toContain(permission);
    }
    expect(text).toMatch(/Write access, administration, secrets/);
    expect(text).toMatch(/rejected/);
  });

  it("states where summaries are processed and that the journal works without them", () => {
    const text = textOf(dataAccessDocument);

    expect(text).toContain("OpenAI");
    expect(text).toMatch(/not used to train models/);
    expect(text).toMatch(
      /Source code, diffs and repository contents are never/,
    );
    expect(text).toMatch(/complete and usable with the narrative switched off/);
  });

  it("states the completeness limits rather than marketing around them", () => {
    const text = textOf(dataAccessDocument);

    expect(text).toMatch(/best-effort/);
    expect(text).toMatch(/private and delayed work may be missing/);
    expect(text).toMatch(/delayed and truncated by GitHub/);
    expect(text).toMatch(/correction/);
  });

  it("states the retention window in both Privacy and Data access", () => {
    expect(textOf(dataAccessDocument)).toMatch(/30 days/);
    expect(textOf(privacyDocument)).toMatch(/retained for 30 days/);
  });

  it("states the summary quotas and what still works when one refuses", () => {
    const text = textOf(dataAccessDocument);

    expect(text).toMatch(/12 summaries a day/);
    expect(text).toMatch(/15-minute cooldown/);
    expect(text).toMatch(/monthly spend budget/);
    expect(text).toMatch(/Metrics, activity and history are unaffected/);
  });

  it("explains how to revoke access and what survives revocation", () => {
    const text = textOf(dataAccessDocument);

    expect(text).toMatch(/github\.com\/settings\/installations/);
    expect(text).toMatch(/github\.com\/settings\/applications/);
    expect(text).toMatch(/Days already recorded are retained/);
  });

  it("explains redaction and account deletion, including what deletion cannot do", () => {
    const text = textOf(dataAccessDocument);

    expect(text).toMatch(/redacts the subjects/);
    expect(text).toMatch(/retaining the counts/);
    expect(text).toMatch(/typing the word DELETE/);
    expect(text).toMatch(/cannot uninstall the GitHub App for you/);
  });

  /**
   * `deleteJournalAccount` runs inline in the server action, deletes through a
   * single cascading statement, and calls `revokeGitHubGrant` best-effort —
   * it swallows a failure and is never retried. The page has to say that, not
   * a more comforting version of it.
   */
  it("describes deletion the way it actually runs", () => {
    for (const document of [dataAccessDocument, termsDocument]) {
      const text = textOf(document);
      expect(text).toMatch(/best-effort/);
      expect(text).not.toMatch(/retries on its own|in the background/);
    }

    const text = textOf(dataAccessDocument);
    expect(text).toMatch(/single database statement/);
    expect(text).toMatch(/it is not retried/);
    expect(text).toMatch(/github\.com\/settings\/applications/);
  });

  it("names every processor in Privacy", () => {
    const text = textOf(privacyDocument);

    for (const processor of ["GitHub", "Neon", "Vercel", "OpenAI"]) {
      expect(text).toContain(processor);
    }
    expect(text).toMatch(/no third-party analytics/);
  });

  it("refuses to promise completeness in Terms", () => {
    const text = textOf(termsDocument);

    expect(text).toMatch(/as-is/);
    expect(text).toMatch(/not a complete or authoritative record/);
    expect(text).toMatch(/not a system of record for performance review/);
  });

  it("gives every document a dated, uniquely anchored structure", () => {
    for (const document of trustDocuments) {
      expect(document.lastUpdated).toMatch(/\d{4}$/);
      expect(document.sections.length).toBeGreaterThan(0);
      const ids = document.sections.map((section) => section.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(trustDocuments.map((document) => document.slug)).toEqual([
      "privacy",
      "terms",
      "data-access",
    ]);
  });
});
