import { relations } from "drizzle-orm";
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
    kind: text("kind").$type<"push" | "commit">().notNull(),
    deduplicationKey: text("deduplication_key").notNull(),
    actorId: text("actor_id").notNull(),
    actorLogin: text("actor_login").notNull(),
    repositoryId: text("repository_id").notNull(),
    repositoryName: text("repository_name").notNull(),
    evidenceUrl: text("evidence_url").notNull(),
    visibility: text("visibility").$type<"public" | "private">().notNull(),
    source: text("source")
      .$type<"github-events" | "github-repository-commits">()
      .notNull(),
    subjectId: text("subject_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    authoredBeforeDay: boolean("authored_before_day").default(false).notNull(),
    installationId: text("installation_id"),
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
  ],
);

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  journalOnboarding: one(journalOnboarding),
  githubInstallations: many(githubInstallation),
  githubInstallationStates: many(githubInstallationState),
  githubActivities: many(githubActivity),
  journalReconciliations: many(journalReconciliation),
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
