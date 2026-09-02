import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrustPage } from "@/components/trust/trust-page";
import { ThemeProvider } from "@/components/theme-provider";
import { dataAccessDocument, trustDocuments } from "@/content/trust";

function renderTrustPage(document = dataAccessDocument) {
  render(
    <ThemeProvider storageKey={null}>
      <TrustPage document={document} />
    </ThemeProvider>,
  );
}

describe("trust page shell", () => {
  it("gives the document one h1 and a heading per section", () => {
    renderTrustPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: dataAccessDocument.title,
      }),
    ).toBeInTheDocument();
    for (const section of dataAccessDocument.sections) {
      expect(
        screen.getByRole("heading", { level: 2, name: section.heading }),
      ).toBeInTheDocument();
    }
  });

  it("anchors every 'On this page' link to a section that exists", () => {
    renderTrustPage();

    const onThisPage = screen.getByRole("navigation", {
      name: "On this page",
    });
    for (const section of dataAccessDocument.sections) {
      const links = within(onThisPage).getAllByRole("link", {
        name: section.heading,
      });
      for (const link of links) {
        expect(link).toHaveAttribute("href", `#${section.id}`);
      }
      expect(document.getElementById(section.id)).not.toBeNull();
    }
  });

  it("reaches the other two trust pages and sign-in from every trust page", () => {
    renderTrustPage();

    const footer = screen.getByRole("navigation", { name: "Trust pages" });
    for (const other of trustDocuments) {
      expect(
        within(footer).getByRole("link", { name: other.navLabel }),
      ).toHaveAttribute("href", `/${other.slug}`);
    }
    expect(
      within(footer).getByRole("link", { name: "Data access" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });

  it("renders permissions as a definition list rather than cards", () => {
    renderTrustPage();

    expect(screen.getByText("Contents · read").tagName).toBe("DT");
  });
});
