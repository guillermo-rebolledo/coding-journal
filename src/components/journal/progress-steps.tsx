import { cn } from "@/lib/utils";

/**
 * The reusable progress pattern — frame 1l of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * A determinate bar plus a named step list inside a `role="status"` region.
 * The step labels alone convey progress, so the global reduced-motion block
 * can stop the bar's animation without removing any information. There is no
 * full-page spinner takeover: stored facts render underneath as soon as they
 * exist.
 */
export type ProgressStep = {
  label: string;
  state: "done" | "working" | "waiting";
};

const stateLabels: Record<ProgressStep["state"], string> = {
  done: "Done",
  working: "Working…",
  waiting: "Waiting",
};

export function ProgressSteps({
  headingId,
  title,
  description,
  steps,
  className,
}: {
  headingId: string;
  title: string;
  description: string;
  steps: ProgressStep[];
  className?: string;
}) {
  const done = steps.filter((step) => step.state === "done").length;
  const percent = Math.round((done / Math.max(steps.length, 1)) * 100);

  return (
    <section
      role="status"
      aria-labelledby={headingId}
      className={cn(
        "rounded-m3-xl bg-m3-surface-container-low px-5 py-8 sm:px-8 sm:py-10",
        className,
      )}
    >
      <h1 id={headingId} className="text-m3-headline-sm text-m3-on-surface">
        {title}
      </h1>
      <p className="mt-2 max-w-[62ch] text-m3-body-lg text-m3-on-surface-variant">
        {description}
      </p>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${done} of ${steps.length} steps complete`}
        className="mt-7 h-1 w-full overflow-hidden rounded-m3-full bg-m3-surface-container-highest"
      >
        <div
          className="h-full rounded-m3-full bg-m3-primary transition-[width] duration-(--m3-spring-spatial-default-duration) ease-(--m3-spring-spatial-default)"
          style={{ width: `${Math.max(percent, 4)}%` }}
        />
      </div>

      <ol className="mt-5 divide-y divide-m3-outline-variant">
        {steps.map((step) => (
          <li
            key={step.label}
            className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5"
          >
            <span
              className={cn(
                "text-m3-body-md",
                step.state === "waiting"
                  ? "text-m3-on-surface-variant"
                  : "text-m3-on-surface",
              )}
            >
              {step.label}
            </span>
            <span
              className={cn(
                "text-m3-label-md",
                step.state === "working"
                  ? "text-m3-primary"
                  : "text-m3-on-surface-variant",
              )}
            >
              {stateLabels[step.state]}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
