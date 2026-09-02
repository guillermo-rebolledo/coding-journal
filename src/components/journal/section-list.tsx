import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The list surface that replaces the product's card galleries — the
 * "lists before cards" rule from the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`, frames 1a and 1n).
 *
 * One `surface-container-low` block at the 8dp shape step, level 0 elevation,
 * and 1px `outline-variant` rules between rows. Structure comes from the
 * divider, never from a shadow around every item.
 */
export function ListSurface<T extends ElementType = "div">({
  as,
  className,
  ...props
}: { as?: T } & Omit<ComponentPropsWithoutRef<T>, "as">) {
  // SAFETY: `as` is constrained to `ElementType` by the props type; the
  // default fills in the same contract when the caller omits it.
  const Component = (as ?? "div") as ElementType;
  return (
    <Component
      className={cn(
        "divide-y divide-m3-outline-variant overflow-hidden rounded-m3-sm bg-m3-surface-container-low",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Settings row — pattern 5. Label, current value as supporting text, and at
 * most one action. Supporting text changes with state instead of going grey,
 * so a row never signals "disabled" when it is merely informative.
 */
export function SettingsRow({
  label,
  supporting,
  action,
  children,
  className,
}: {
  label: ReactNode;
  supporting?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-5",
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-m3-title-sm wrap-anywhere text-m3-on-surface">
          {label}
        </p>
        {supporting ? (
          <div className="mt-1 text-m3-body-md wrap-anywhere text-m3-on-surface-variant">
            {supporting}
          </div>
        ) : null}
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * A labelled group of rows. The label is a real heading so the settings and
 * history pages keep one `h1` and a flat, navigable heading outline.
 */
export function SectionGroup({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <h2 id={id} className="text-m3-title-md text-m3-on-surface">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 max-w-[66ch] text-m3-body-md text-m3-on-surface-variant">
          {description}
        </p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}
