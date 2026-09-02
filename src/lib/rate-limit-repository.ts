import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { rateLimitCounter } from "@/db/auth-schema";
import type { RateLimitStore } from "@/lib/rate-limit";

/**
 * The counter is one row per policy and subject. Rolling the window and
 * incrementing it happen in the same statement, which is what makes the limit
 * hold under concurrency: the HTTP database driver has no transactions, so a
 * read-then-write would let two simultaneous requests both observe the last
 * allowed count and both proceed.
 */
export function createRateLimitRepository<
  TQueryResult extends PgQueryResultHKT,
>(
  database: PgDatabase<TQueryResult, typeof import("@/db/auth-schema")>,
): RateLimitStore {
  return {
    async increment({ scope, subject, now, windowMs }) {
      const at = sql`${now.toISOString()}::timestamptz`;
      const windowEndsAt = sql`${new Date(
        now.getTime() + windowMs,
      ).toISOString()}::timestamptz`;
      const expired = sql`${rateLimitCounter.windowEndsAt} <= ${at}`;

      const [row] = await database
        .insert(rateLimitCounter)
        .values({
          id: `${scope}:${subject}`,
          scope,
          subject,
          count: 1,
          windowStartedAt: now,
          windowEndsAt: new Date(now.getTime() + windowMs),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [rateLimitCounter.scope, rateLimitCounter.subject],
          set: {
            count: sql`case when ${expired} then 1 else ${rateLimitCounter.count} + 1 end`,
            windowStartedAt: sql`case when ${expired} then ${at} else ${rateLimitCounter.windowStartedAt} end`,
            windowEndsAt: sql`case when ${expired} then ${windowEndsAt} else ${rateLimitCounter.windowEndsAt} end`,
            updatedAt: now,
          },
        })
        .returning({
          count: rateLimitCounter.count,
          windowEndsAt: rateLimitCounter.windowEndsAt,
        });

      if (!row) throw new Error("Rate limit counter did not return a window");
      return { count: row.count, windowEndsAt: row.windowEndsAt };
    },
  };
}

export const rateLimitRepository = createRateLimitRepository(db);
