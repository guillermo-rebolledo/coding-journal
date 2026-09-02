"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * The two framework services client components in this app reach for: moving
 * the user somewhere, and ending their session.
 *
 * They are read from context rather than imported, so the app supplies the
 * router-backed implementation once at the root and a caller that renders a
 * subtree — including a test — supplies its own without replacing modules.
 */
export type AppServices = {
  navigation: {
    replace: (href: string) => void;
    refresh: () => void;
  };
  session: {
    signOut: () => Promise<{ error?: unknown }>;
  };
};

const AppServicesContext = createContext<AppServices | null>(null);

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (!services) {
    throw new Error(
      "App services are unavailable. Render this inside an AppServicesProvider.",
    );
  }
  return services;
}

export function AppServicesProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return (
    <AppServicesContext.Provider value={services}>
      {children}
    </AppServicesContext.Provider>
  );
}

/** The production services, backed by the app router and the auth client. */
export function RouterAppServices({ children }: { children: ReactNode }) {
  const router = useRouter();
  const services = useMemo<AppServices>(
    () => ({
      navigation: {
        replace: (href) => router.replace(href),
        refresh: () => router.refresh(),
      },
      session: { signOut: () => authClient.signOut() },
    }),
    [router],
  );

  return (
    <AppServicesProvider services={services}>{children}</AppServicesProvider>
  );
}
