"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setLoading(true);
    setError(null);

    const result = await authClient.signOut();
    if (result.error) {
      setError("Could not sign out. Please try again.");
      setLoading(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="grid justify-items-end gap-2">
      <Button variant="outline" size="lg" onClick={signOut} loading={loading}>
        <LogOut aria-hidden />
        Sign out
      </Button>
      {error ? (
        <p role="alert" className="text-m3-body-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
