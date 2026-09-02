import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The development overlay is a fixed-position portal over the bottom of every
  // page, so it intercepts clicks on anything anchored there — the trust-page
  // footer in particular. Browser tests run against `next dev`; hide it there.
  devIndicators: process.env.E2E_AUTH_MODE === "true" ? false : undefined,
};

export default nextConfig;
