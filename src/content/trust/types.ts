/**
 * The trust pages — frame 1m of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * The documents are data rather than JSX so that the shell renders all three
 * identically and so tests can assert what a document must say — the
 * acceptance criteria of issue #17 are claims about content, not about markup.
 */

export type TrustBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: readonly string[] }
  | {
      kind: "definitions";
      items: readonly { term: string; description: string }[];
    };

export type TrustSection = {
  /** Anchor target; also the "On this page" link. */
  id: string;
  heading: string;
  blocks: readonly TrustBlock[];
};

export type TrustDocument = {
  slug: "privacy" | "terms" | "data-access";
  /** Short name for navigation between the three pages. */
  navLabel: string;
  title: string;
  /** Metadata title and description. */
  description: string;
  lede: string;
  lastUpdated: string;
  sections: readonly TrustSection[];
};
