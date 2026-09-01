import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JournalExplorer } from "@/app/journal/journal-explorer";
import type { ActivityRecord } from "@/lib/github-activity";

const common = {
  localDate: "2026-08-31",
  actorId: "7",
  actorLogin: "ada",
  repositoryId: "42",
  visibility: "public" as const,
  source: "github-events" as const,
  subjectNumber: null,
  subjectTitle: null,
  observedAt: new Date("2026-08-31T12:00:00Z"),
  authoredBeforeDay: false,
  installationId: null,
};

const activities: ActivityRecord[] = [
  {
    ...common,
    kind: "push",
    deduplicationKey: "push-1",
    repositoryName: "acme/api",
    subjectId: "push-1",
    evidenceUrl: "https://github.com/acme/api/compare/1...2",
    occurredAt: new Date("2026-08-31T11:00:00Z"),
  },
  {
    ...common,
    kind: "issue-opened",
    deduplicationKey: "issue-1",
    repositoryId: "43",
    repositoryName: "acme/web",
    subjectId: "51",
    subjectNumber: 51,
    subjectTitle: "Keep Today focused",
    evidenceUrl: "https://github.com/acme/web/issues/51",
    occurredAt: new Date("2026-08-31T12:00:00Z"),
  },
  {
    ...common,
    kind: "issue-comment",
    deduplicationKey: "comment-1",
    repositoryName: "acme/api",
    subjectId: "52",
    subjectNumber: 52,
    evidenceUrl: "https://github.com/acme/api/issues/52#issuecomment-1",
    occurredAt: new Date("2026-08-31T11:30:00Z"),
  },
];

describe("Today journal explorer", () => {
  it("starts newest-first and filters by repository and activity category", () => {
    render(
      <JournalExplorer
        activities={activities}
        timeZone="America/Mexico_City"
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Opened issue #51");
    expect(items[1]).toHaveTextContent("Commented on issue #52");
    expect(items[2]).toHaveTextContent("Push");

    fireEvent.change(screen.getByLabelText("Repository"), {
      target: { value: "acme/api" },
    });
    fireEvent.change(screen.getByLabelText("Activity type"), {
      target: { value: "comments" },
    });

    expect(screen.getByText("Commented on issue #52")).toBeInTheDocument();
    expect(screen.queryByText("Opened issue #51")).not.toBeInTheDocument();
    expect(screen.queryByText("Push")).not.toBeInTheDocument();
  });

  it("keeps filters and evidence links when grouping by repository", () => {
    render(
      <JournalExplorer
        activities={activities}
        timeZone="America/Mexico_City"
      />,
    );

    fireEvent.change(screen.getByLabelText("Repository"), {
      target: { value: "acme/api" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Group by repository" }),
    );

    const group = screen.getByRole("region", { name: "acme/api" });
    expect(within(group).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(group).getByRole("link", { name: "View push evidence" }),
    ).toHaveAttribute("href", "https://github.com/acme/api/compare/1...2");
    expect(screen.getByLabelText("Repository")).toHaveValue("acme/api");
  });
});
