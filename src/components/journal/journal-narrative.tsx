import { EvidenceLink } from "@/components/journal/evidence-link";
import type { ActivityRecord } from "@/lib/github-activity";
import {
  summaryEvidenceLinks,
  type SummaryOutput,
} from "@/lib/journal-summary";
import { cn } from "@/lib/utils";

type EvidenceIndex = Map<
  string,
  ReturnType<typeof summaryEvidenceLinks>[number]
>;

export function JournalNarrative({
  narrative,
  evidence: activities,
  generatedAt,
  immutable = false,
  emptyMessage,
  headingId = "summary-heading",
}: {
  narrative: SummaryOutput | null;
  evidence: ActivityRecord[];
  generatedAt: string | null;
  immutable?: boolean;
  emptyMessage: string;
  headingId?: string;
}) {
  const evidence: EvidenceIndex = new Map(
    summaryEvidenceLinks(activities).map((item) => [item.id, item]),
  );

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "mt-8 rounded-m3-xl p-6 sm:p-7",
        narrative
          ? "bg-m3-tertiary-container text-m3-on-tertiary-container"
          : "bg-m3-surface-container-low text-m3-on-surface",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={headingId} className="text-m3-title-lg">
          Written for you
        </h2>
        <p className="text-m3-label-md">
          {immutable ? "Immutable" : "Read-only"}
          {generatedAt ? ` · generated ${generatedAt}` : null}
        </p>
      </div>
      {narrative ? (
        <div className="mt-4 grid gap-6">
          <p className="max-w-[62ch] text-m3-body-lg">{narrative.overview}</p>
          {narrative.accomplishments.length ? (
            <SummaryClaims
              title="Accomplishments"
              claims={narrative.accomplishments}
              evidence={evidence}
              withRepository
            />
          ) : null}
          {narrative.collaboration.length ? (
            <SummaryClaims
              title="Reviews and collaboration"
              claims={narrative.collaboration}
              evidence={evidence}
            />
          ) : null}
          {narrative.inProgress.length ? (
            <SummaryClaims
              title="In progress"
              claims={narrative.inProgress}
              evidence={evidence}
            />
          ) : null}
          <p className="text-m3-body-sm">
            Every claim links to the recorded event it came from. Gists and
            social activity are excluded from the narrative.
          </p>
        </div>
      ) : (
        <p className="mt-3 max-w-[62ch] text-m3-body-md text-m3-on-surface-variant">
          {emptyMessage}
        </p>
      )}
    </section>
  );
}

function SummaryClaims({
  title,
  claims,
  evidence,
  withRepository = false,
}: {
  title: string;
  claims: Array<{ summary: string; evidenceIds: string[] }>;
  evidence: EvidenceIndex;
  withRepository?: boolean;
}) {
  return (
    <div>
      <h3 className="text-m3-title-sm">{title}</h3>
      <ul className="mt-2 grid gap-4">
        {claims.map((claim, index) => {
          const repository = withRepository
            ? evidence.get(claim.evidenceIds[0] ?? "")?.repositoryName
            : null;
          return (
            <li key={`${title}-${index}`} className="max-w-[62ch]">
              {repository ? (
                <p className="text-m3-label-md wrap-anywhere">{repository}</p>
              ) : null}
              <p className="text-m3-body-md">{claim.summary}</p>
              <div className="flex flex-wrap gap-x-4">
                {claim.evidenceIds.flatMap((id) => {
                  const item = evidence.get(id);
                  return item
                    ? [<EvidenceLink key={id} href={item.url} noun="source" />]
                    : [];
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
