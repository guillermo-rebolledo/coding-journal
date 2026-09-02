import type {
  ActivityKind,
  ActivityMetrics,
  ActivityRecord,
  ActivityStatus,
} from "../lib/github-activity";
import type { StoredSecondarySourceFreshness } from "../lib/github-secondary";
import type { SummaryOutput } from "../lib/journal-summary";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("account_issuer_accountId_uidx").on(
      table.issuer,
      table.accountId,
    ),
    index("account_userId_idx").on(table.userId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const journalOnboarding = pgTable("journal_onboarding", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  timeZone: text("time_zone"),
  githubAccessMode: text("github_access_mode").$type<"best-effort" | "app">(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const githubInstallationState = pgTable(
  "github_installation_state",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    returnTo: text("return_to").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("github_installation_state_userId_idx").on(table.userId)],
);

export const githubInstallation = pgTable(
  "github_installation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    installationId: text("installation_id"),
    accountId: text("account_id"),
    accountLogin: text("account_login"),
    accountType: text("account_type").$type<"User" | "Organization">(),
    repositorySelection: text("repository_selection").$type<
      "all" | "selected"
    >(),
    repositoryCount: integer("repository_count"),
    permissions: jsonb("permissions").$type<Record<string, string>>(),
    status: text("status")
      .$type<"active" | "pending" | "disconnected">()
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_installation_userId_installationId_uidx").on(
      table.userId,
      table.installationId,
    ),
    index("github_installation_userId_idx").on(table.userId),
    index("github_installation_installationId_idx").on(table.installationId),
  ],
);

export const githubWebhookDelivery = pgTable(
  "github_webhook_delivery",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id").notNull(),
    eventType: text("event_type").notNull(),
    installationId: text("installation_id"),
    status: text("status")
      .$type<
        | "received"
        | "ignored"
        | "enqueued"
        | "enqueue-failed"
        | "processed"
        | "skipped"
        | "failed"
        | "poisoned"
      >()
      .notNull(),
    errorId: text("error_id"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_webhook_delivery_deliveryId_uidx").on(table.deliveryId),
  ],
);

export const journalReconciliation = pgTable(
  "journal_reconciliation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    timeZone: text("time_zone").notNull(),
    status: text("status")
      .$type<"loading" | "complete" | "partial" | "error">()
      .notNull(),
    lastAttemptAt: timestamp("last_attempt_at", {
      withTimezone: true,
    }).notNull(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
    sourceFreshness:
      jsonb("source_freshness").$type<StoredSecondarySourceFreshness[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("journal_reconciliation_user_date_uidx").on(
      table.userId,
      table.localDate,
    ),
  ],
);

export const githubActivity = pgTable(
  "github_activity",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    kind: text("kind").$type<ActivityKind>().notNull(),
    deduplicationKey: text("deduplication_key").notNull(),
    actorId: text("actor_id").notNull(),
    actorLogin: text("actor_login").notNull(),
    repositoryId: text("repository_id").notNull(),
    repositoryName: text("repository_name").notNull(),
    evidenceUrl: text("evidence_url").notNull(),
    visibility: text("visibility").$type<"public" | "private">().notNull(),
    source: text("source")
      .$type<
        | "github-events"
        | "github-repository-commits"
        | "github-webhook"
        | "github-projects-preview"
        | "github-gists"
      >()
      .notNull(),
    subjectId: text("subject_id").notNull(),
    subjectNumber: integer("subject_number"),
    subjectTitle: text("subject_title"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    authoredBeforeDay: boolean("authored_before_day").default(false).notNull(),
    installationId: text("installation_id"),
    status: text("status").$type<ActivityStatus>(),
    statusOccurredAt: timestamp("status_occurred_at", { withTimezone: true }),
    narrativeEligible: boolean("narrative_eligible").default(true).notNull(),
    attributionKeys: jsonb("attribution_keys").$type<string[]>(),
    attributed: boolean("attributed").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_activity_user_deduplication_uidx").on(
      table.userId,
      table.deduplicationKey,
    ),
    index("github_activity_user_date_idx").on(table.userId, table.localDate),
    index("github_activity_user_attributed_idx").on(
      table.userId,
      table.attributed,
    ),
  ],
);

export const journalSummary = pgTable(
  "journal_summary",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    model: text("model").notNull(),
    output: jsonb("output").$type<SummaryOutput>().notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    estimatedCostMicrousd: integer("estimated_cost_microusd")
      .default(0)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("journal_summary_user_snapshot_uidx").on(
      table.userId,
      table.snapshotHash,
    ),
    index("journal_summary_user_date_idx").on(table.userId, table.localDate),
    index("journal_summary_created_at_idx").on(table.createdAt),
  ],
);

export const journalSummaryGeneration = pgTable(
  "journal_summary_generation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    status: text("status")
      .$type<"active" | "complete" | "failed" | "rejected">()
      .notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("journal_summary_generation_user_snapshot_uidx").on(
      table.userId,
      table.snapshotHash,
    ),
    index("journal_summary_generation_usage_idx").on(
      table.userId,
      table.localDate,
      table.claimedAt,
    ),
  ],
);

export const journalFinalization = pgTable(
  "journal_finalization",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    timeZone: text("time_zone").notNull(),
    status: text("status")
      .$type<"scheduled" | "finalizing" | "finalized" | "recoverable-error">()
      .notNull(),
    completeness: text("completeness").$type<
      "loading" | "complete" | "partial" | "error"
    >(),
    metrics: jsonb("metrics").$type<ActivityMetrics>(),
    narrative: jsonb("narrative").$type<SummaryOutput>(),
    snapshotHash: text("snapshot_hash"),
    evidenceKeys: jsonb("evidence_keys").$type<string[]>(),
    evidence: jsonb("evidence").$type<ActivityRecord[]>(),
    lastFailure: text("last_failure").$type<
      "reconciliation-failed" | "summary-failed"
    >(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    finalizationStartedAt: timestamp("finalization_started_at", {
      withTimezone: true,
    }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    narrativeRedactedAt: timestamp("narrative_redacted_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("journal_finalization_user_date_uidx").on(
      table.userId,
      table.localDate,
    ),
    index("journal_finalization_history_idx").on(table.userId, table.localDate),
    index("journal_finalization_status_idx").on(table.status),
  ],
);

export const privacyOperation = pgTable(
  "privacy_operation",
  {
    id: text("id").primaryKey(),
    operationHash: text("operation_hash").notNull().unique(),
    kind: text("kind")
      .$type<
        | "installation-suspended"
        | "installation-removed"
        | "repositories-removed"
        | "authorization-revoked"
        | "retention"
        | "account-deletion"
      >()
      .notNull(),
    status: text("status").$type<"running" | "complete" | "failed">().notNull(),
    attemptCount: integer("attempt_count").default(1).notNull(),
    affectedUsers: integer("affected_users").default(0).notNull(),
    deletedActivities: integer("deleted_activities").default(0).notNull(),
    redactedJournals: integer("redacted_journals").default(0).notNull(),
    errorId: text("error_id"),
    claimToken: text("claim_token")
      .default(sql`md5(random()::text || clock_timestamp()::text)`)
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("privacy_operation_status_idx").on(table.status, table.updatedAt),
  ],
);

export const githubAccessBlock = pgTable(
  "github_access_block",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scopeKey: text("scope_key").notNull(),
    installationId: text("installation_id"),
    repositoryId: text("repository_id"),
    allPrivate: boolean("all_private").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_access_block_user_scope_uidx").on(
      table.userId,
      table.scopeKey,
    ),
    index("github_access_block_user_idx").on(table.userId),
  ],
);

/**
 * Fixed-window request and product budgets. One row per policy and subject, so
 * the table stays bounded: the atomic upsert in the repository resets the
 * window in place instead of accumulating one row per window. Subjects are
 * opaque digests, never a user id, so a counter cannot re-identify anyone
 * after their account is deleted.
 */
export const rateLimitCounter = pgTable(
  "rate_limit_counter",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    subject: text("subject").notNull(),
    count: integer("count").default(0).notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    windowEndsAt: timestamp("window_ends_at", {
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("rate_limit_counter_scope_subject_uidx").on(
      table.scope,
      table.subject,
    ),
    index("rate_limit_counter_window_idx").on(table.windowEndsAt),
  ],
);

/**
 * Circuit-breaker state for an outbound provider. One row per service, so the
 * breaker is shared by every function instance instead of living in a single
 * process that Fluid Compute can recycle at any time.
 */
export const serviceCircuit = pgTable("service_circuit", {
  service: text("service").primaryKey(),
  state: text("state").$type<"closed" | "open">().notNull(),
  failureCount: integer("failure_count").default(0).notNull(),
  windowStartedAt: timestamp("window_started_at", {
    withTimezone: true,
  }).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  retryAt: timestamp("retry_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Bounded concurrency for queue consumers. Slots are numbered, so a consumer
 * either takes a free slot or is told the topic is saturated; it never guesses
 * from a count that another instance is already changing.
 */
export const serviceLease = pgTable(
  "service_lease",
  {
    id: text("id").primaryKey(),
    topic: text("topic").notNull(),
    slot: integer("slot").notNull(),
    holder: text("holder").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("service_lease_topic_idx").on(table.topic, table.slot)],
);

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  journalOnboarding: one(journalOnboarding),
  githubInstallations: many(githubInstallation),
  githubInstallationStates: many(githubInstallationState),
  githubActivities: many(githubActivity),
  journalReconciliations: many(journalReconciliation),
  journalSummaries: many(journalSummary),
  journalSummaryGenerations: many(journalSummaryGeneration),
  journalFinalizations: many(journalFinalization),
  githubAccessBlocks: many(githubAccessBlock),
}));

export const githubActivityRelations = relations(githubActivity, ({ one }) => ({
  user: one(user, {
    fields: [githubActivity.userId],
    references: [user.id],
  }),
}));

export const journalReconciliationRelations = relations(
  journalReconciliation,
  ({ one }) => ({
    user: one(user, {
      fields: [journalReconciliation.userId],
      references: [user.id],
    }),
  }),
);

export const journalSummaryRelations = relations(journalSummary, ({ one }) => ({
  user: one(user, {
    fields: [journalSummary.userId],
    references: [user.id],
  }),
}));

export const journalSummaryGenerationRelations = relations(
  journalSummaryGeneration,
  ({ one }) => ({
    user: one(user, {
      fields: [journalSummaryGeneration.userId],
      references: [user.id],
    }),
  }),
);

export const journalFinalizationRelations = relations(
  journalFinalization,
  ({ one }) => ({
    user: one(user, {
      fields: [journalFinalization.userId],
      references: [user.id],
    }),
  }),
);

export const githubAccessBlockRelations = relations(
  githubAccessBlock,
  ({ one }) => ({
    user: one(user, {
      fields: [githubAccessBlock.userId],
      references: [user.id],
    }),
  }),
);

export const githubInstallationRelations = relations(
  githubInstallation,
  ({ one }) => ({
    user: one(user, {
      fields: [githubInstallation.userId],
      references: [user.id],
    }),
  }),
);

export const githubInstallationStateRelations = relations(
  githubInstallationState,
  ({ one }) => ({
    user: one(user, {
      fields: [githubInstallationState.userId],
      references: [user.id],
    }),
  }),
);

export const journalOnboardingRelations = relations(
  journalOnboarding,
  ({ one }) => ({
    user: one(user, {
      fields: [journalOnboarding.userId],
      references: [user.id],
    }),
  }),
);

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
