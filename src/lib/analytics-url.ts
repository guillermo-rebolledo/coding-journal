/**
 * Normalizes a URL before it leaves the browser for Vercel Analytics or Speed
 * Insights.
 *
 * Coding Journal's paths carry meaning: `/journal/history/2026-08-30` says
 * which day a person was reading, and a query string can carry an onboarding
 * step, a filter, or an installation id. Neither product needs any of it —
 * page and vital measurements only need the route shape — so the date segment
 * becomes its route pattern and the query and fragment are dropped entirely.
 */
export function sanitizeAnalyticsUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "/";
  }

  const path = parsed.pathname
    .replace(
      /^\/journal\/history\/\d{4}-\d{2}-\d{2}\/?$/,
      "/journal/history/[localDate]",
    )
    .replace(/\/+$/, "");

  return `${parsed.origin}${path === "" ? "/" : path}`;
}
