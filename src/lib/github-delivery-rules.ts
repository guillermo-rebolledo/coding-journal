/** Deliveries older than this window are acknowledged without journal data. */
export const githubDeliveryStaleAfterMs = 7 * 24 * 60 * 60 * 1000;
export const githubSubjectTitleMaxLength = 120;

export function isStaleGitHubDelivery(receivedAt: Date, occurredAt: Date) {
  return (
    receivedAt.getTime() - occurredAt.getTime() > githubDeliveryStaleAfterMs
  );
}

/** Narrows a header or decoded string to GitHub's delivery-id form. */
export function validGitHubDeliveryId(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9-]{1,100}$/.test(value);
}

export function boundedGitHubTitle(value: string | null) {
  if (value === null) return null;
  const title = value.trim();
  if (!title) return null;
  return title.length > githubSubjectTitleMaxLength
    ? `${title.slice(0, githubSubjectTitleMaxLength - 1)}…`
    : title;
}
