"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

import { useAppServices } from "@/components/app-services";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const { navigation, session } = useAppServices();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setLoading(true);
    setError(null);

    const result = await session.signOut();
    if (result.error) {
      setError("Could not sign out. Please try again.");
      setLoading(false);
      return;
    }

    navigation.replace("/");
    navigation.refresh();
  }

  return (
    <div className="grid justify-items-end gap-2">
      <Button
        variant="outline"
        size="icon-lg"
        onClick={signOut}
        loading={loading}
        className="sm:w-auto sm:px-6"
      >
        <LogOut aria-hidden />
        <span className="sr-only sm:not-sr-only">Sign out</span>
      </Button>
      {error ? (
        <p role="alert" className="text-m3-body-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
