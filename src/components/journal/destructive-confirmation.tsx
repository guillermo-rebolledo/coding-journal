"use client";

import {
  type FormEvent,
  type ReactNode,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { LimitNotice } from "@/components/journal/limit-notice";
import { Button } from "@/components/ui/button";

type ConfirmationResult =
  | {
      status: "idle" | "accepted" | "limited" | "unavailable";
      message: string;
    }
  | undefined;

/**
 * The shared typed-confirmation interaction for irreversible journal actions.
 * It owns exact-match validation, announcement, focus and dismissal so account
 * deletion and narrative redaction cannot quietly drift apart.
 */
export function DestructiveConfirmation({
  action,
  literal,
  fieldLabel,
  submitLabel,
  description,
  triggerLabel,
  cancelLabel,
  initiallyOpen = false,
}: {
  action: (formData: FormData) => Promise<ConfirmationResult>;
  literal: string;
  fieldLabel: string;
  submitLabel: string;
  description: ReactNode;
  triggerLabel?: string;
  cancelLabel?: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [result, submit, pending] = useActionState<
    ConfirmationResult,
    FormData
  >(async (_previous, formData) => action(formData), undefined);
  const fieldId = useId();
  const descriptionId = `${fieldId}-description`;
  const errorId = `${fieldId}-error`;
  const field = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && !initiallyOpen) field.current?.focus();
  }, [initiallyOpen, open]);

  function validate(event: FormEvent<HTMLFormElement>) {
    if (value === literal) {
      setError("");
      return;
    }
    event.preventDefault();
    setError(`Type ${literal} exactly as shown to continue.`);
    field.current?.focus();
  }

  function dismiss() {
    setOpen(false);
    setValue("");
    setError("");
    requestAnimationFrame(() => trigger.current?.focus());
  }

  if (!open) {
    return (
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        {triggerLabel ?? submitLabel}
      </Button>
    );
  }

  return (
    <div
      role="region"
      aria-label={`${submitLabel} confirmation`}
      aria-live="polite"
    >
      <p id={descriptionId} className="max-w-[62ch] text-m3-body-md">
        {description}
      </p>
      <form
        action={submit}
        noValidate
        onSubmit={validate}
        className="mt-3 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end"
      >
        <label
          htmlFor={fieldId}
          className="flex-1 text-m3-label-lg text-current"
        >
          {fieldLabel}
          <input
            ref={field}
            id={fieldId}
            name="confirmation"
            required
            autoComplete="off"
            value={value}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ""}`}
            onChange={(event) => {
              const next = event.target.value;
              setValue(next);
              if (next === literal) setError("");
            }}
            className="mt-2 min-h-12 w-full rounded-m3-xs border border-current bg-transparent px-4 text-m3-body-lg text-current m3-medium:text-m3-body-md"
          />
          {error ? (
            <span id={errorId} className="mt-1 block text-m3-body-sm">
              {error}
            </span>
          ) : null}
        </label>
        <div className="flex flex-wrap gap-2 sm:mb-0.5">
          <Button type="submit" variant="destructive" loading={pending}>
            {submitLabel}
          </Button>
          {cancelLabel ? (
            <Button type="button" variant="ghost" onClick={dismiss}>
              {cancelLabel}
            </Button>
          ) : null}
        </div>
      </form>
      {result?.status === "accepted" ? (
        <p role="status" aria-live="polite" className="mt-3 text-m3-body-md">
          {result.message}
        </p>
      ) : result && result.status !== "idle" ? (
        <LimitNotice message={result.message} className="mt-3" />
      ) : null}
    </div>
  );
}
