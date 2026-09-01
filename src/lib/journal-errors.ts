export class JournalNotFoundError extends Error {
  constructor() {
    super("The journal reconciliation has not been started.");
    this.name = "JournalNotFoundError";
  }
}
