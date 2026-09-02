"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  confirmTimeZone,
  type TimeZoneActionState,
} from "@/app/journal/actions";
import { Button } from "@/components/ui/button";

const initialState: TimeZoneActionState = { error: null };

/**
 * Onboarding step 1 — frame 1l of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * No decoration, no icon tile, no card-in-a-card: label, field, help, error,
 * action. The error is bound with `aria-describedby`, announced politely, and
 * the field keeps focus.
 */
export function TimeZoneStep() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(
    confirmTimeZone,
    initialState,
  );

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  }, []);

  return (
    <section
      aria-labelledby="time-zone-heading"
      className="mx-auto max-w-[56ch]"
    >
      <p className="text-m3-label-lg text-m3-on-surface-variant">Step 1 of 2</p>
      <h1
        id="time-zone-heading"
        className="mt-2 text-m3-headline-lg text-balance"
      >
        Start with your local day
      </h1>
      <p className="mt-3 text-m3-body-lg text-m3-on-surface-variant">
        Your journal follows calendar days in this time zone, including local
        midnight and daylight-saving changes.
      </p>

      <form action={formAction} className="mt-8">
        <label
          htmlFor="time-zone"
          className="block text-m3-label-lg text-m3-on-surface"
        >
          Your time zone
        </label>
        <input
          id="time-zone"
          ref={inputRef}
          name="timeZone"
          defaultValue=""
          required
          autoComplete="off"
          aria-describedby="time-zone-help time-zone-error"
          aria-invalid={state.error ? true : undefined}
          className="mt-2 min-h-14 w-full rounded-m3-xs border border-m3-outline bg-transparent px-4 text-m3-body-lg text-m3-on-surface aria-invalid:border-m3-error"
        />
        <p
          id="time-zone-help"
          className="mt-2 text-m3-body-sm text-m3-on-surface-variant"
        >
          Detected from this browser. Replace it with any IANA time zone, such
          as Europe/Paris.
        </p>
        <p
          id="time-zone-error"
          role={state.error ? "alert" : undefined}
          aria-live="polite"
          className="mt-2 min-h-5 text-m3-body-sm text-m3-error"
        >
          {state.error}
        </p>
        <Button
          type="submit"
          size="lg"
          loading={pending}
          className="mt-5 w-full sm:w-auto"
        >
          Confirm time zone
        </Button>
      </form>
    </section>
  );
}
