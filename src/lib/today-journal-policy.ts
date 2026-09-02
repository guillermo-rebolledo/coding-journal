/** The one cooldown used by Today reads, refreshes and final reconciliation. */
export const journalReconciliationCooldownMs = 15 * 60 * 1000;

export function nextJournalSyncAt(lastAttemptAt: Date) {
  return new Date(lastAttemptAt.getTime() + journalReconciliationCooldownMs);
}
