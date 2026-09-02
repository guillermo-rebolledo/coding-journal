import type { Metadata } from "next";
import type { ReactNode } from "react";

import { RouterAppServices } from "@/components/app-services";
import { ProductAnalytics } from "@/components/product-analytics";
import { ThemeProvider } from "@/components/theme-provider";

import "@fontsource-variable/roboto-flex";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Coding Journal",
    template: "%s · Coding Journal",
  },
  description: "Your GitHub day, distilled into a journal worth keeping.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider defaultTheme="system">
          <RouterAppServices>{children}</RouterAppServices>
        </ThemeProvider>
        <ProductAnalytics />
      </body>
    </html>
  );
}
