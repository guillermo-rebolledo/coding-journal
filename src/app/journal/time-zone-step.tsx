"use client";

import { Clock3 } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";

import {
  confirmTimeZone,
  type TimeZoneActionState,
} from "@/app/journal/actions";
import { Button } from "@/components/ui/button";

const initialState: TimeZoneActionState = { error: null };

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
      className="mx-auto grid max-w-4xl gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center"
    >
      <div>
        <span className="bg-primary-container grid size-14 place-items-center rounded-m3-lg text-primary">
          <Clock3 aria-hidden />
        </span>
        <p className="text-m3-label-lg-emphasized mt-7 text-primary">
          STEP 1 OF 2
        </p>
        <h1 id="time-zone-heading" className="mt-3 text-m3-headline-lg">
          Start with your local day
        </h1>
        <p className="mt-4 text-m3-body-lg text-muted-foreground">
          Your journal follows calendar days in this time zone, including local
          midnight and daylight-saving changes.
        </p>
      </div>

      <form
        action={formAction}
        className="rounded-m3-2xl bg-card p-6 shadow-m3-2 sm:p-8"
      >
        <label
          htmlFor="time-zone"
          className="text-m3-title-md-emphasized block"
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
          className="mt-3 min-h-14 w-full rounded-m3-md border border-border bg-background px-4 text-m3-body-lg text-foreground"
        />
        <p
          id="time-zone-help"
          className="mt-2 text-m3-body-sm text-muted-foreground"
        >
          Detected from this browser. You can replace it with another IANA time
          zone, such as Europe/Paris.
        </p>
        <p
          id="time-zone-error"
          role={state.error ? "alert" : undefined}
          aria-live="polite"
          className="mt-3 min-h-5 text-m3-body-sm text-destructive"
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
