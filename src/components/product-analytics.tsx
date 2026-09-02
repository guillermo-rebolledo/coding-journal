"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { sanitizeAnalyticsUrl } from "@/lib/analytics-url";

/**
 * Vercel Analytics and Speed Insights, with every measurement stripped down to
 * a route before it is sent. Both products are cookieless and neither reads
 * page content, but the URL alone would still say which journal day someone
 * opened, so it is normalized first.
 */
export function ProductAnalytics() {
  return (
    <>
      <Analytics
        beforeSend={(event) => ({
          ...event,
          url: sanitizeAnalyticsUrl(event.url),
        })}
      />
      <SpeedInsights
        beforeSend={(event) => ({
          ...event,
          url: sanitizeAnalyticsUrl(event.url),
        })}
      />
    </>
  );
}
