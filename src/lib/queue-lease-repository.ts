import { and, count, eq, gt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { serviceLease } from "@/db/auth-schema";
import type {
  QueueLease,
  QueueLeaseStore,
  QueueTopic,
} from "@/lib/queue-lease";

/**
 * Slots are numbered rows, claimed by one statement that picks the lowest free
 * slot and writes it. Two instances can pick the same slot number; the unique
 * primary key then serializes them and the conditional `do update` refuses the
 * loser, which retries and takes the next slot. The bound therefore holds
 * without a transaction, which the HTTP database driver does not offer.
 */
export function createQueueLeaseRepository<
  TQueryResult extends PgQueryResultHKT,
>(
  database: PgDatabase<TQueryResult, typeof import("@/db/auth-schema")>,
): QueueLeaseStore {
  return {
    async acquire({ topic, limit, holder, now, ttlMs }) {
      const expiresAt = new Date(now.getTime() + ttlMs);
      const at = sql`${now.toISOString()}::timestamptz`;
      const until = sql`${expiresAt.toISOString()}::timestamptz`;

      for (let attempt = 0; attempt < limit; attempt += 1) {
        const result = await database.execute(sql`
          insert into "service_lease" ("id", "topic", "slot", "holder", "acquired_at", "expires_at")
          select ${topic} || ':' || s, ${topic}, s, ${holder}, ${at}, ${until}
          from generate_series(1, ${limit}) as s
          where not exists (
            select 1 from "service_lease" existing
            where existing."topic" = ${topic}
              and existing."slot" = s
              and existing."expires_at" > ${at}
          )
          order by s
          limit 1
          on conflict ("id") do update
            set "holder" = excluded."holder",
                "acquired_at" = excluded."acquired_at",
                "expires_at" = excluded."expires_at"
            where "service_lease"."expires_at" <= ${at}
          returning "id", "slot"
        `);

        // Both the HTTP and the embedded driver return `{ rows }`; the shared
        // Drizzle type is deliberately opaque about it.
        const [row] = (
          result as unknown as { rows: Array<{ id: string; slot: number }> }
        ).rows;
        if (row) {
          return {
            id: row.id,
            topic,
            slot: Number(row.slot),
            holder,
            expiresAt,
          } satisfies QueueLease;
        }

        // Either every slot is held, or a concurrent instance won the slot this
        // statement chose. Only the second case is worth retrying.
        const active = await this.activeCount(topic, now);
        if (active >= limit) return null;
      }
      return null;
    },

    async release(lease) {
      await database
        .delete(serviceLease)
        .where(
          and(
            eq(serviceLease.id, lease.id),
            eq(serviceLease.holder, lease.holder),
          ),
        );
    },

    async activeCount(topic: QueueTopic, now: Date) {
      const [row] = await database
        .select({ value: count() })
        .from(serviceLease)
        .where(
          and(eq(serviceLease.topic, topic), gt(serviceLease.expiresAt, now)),
        );
      return row?.value ?? 0;
    },
  };
}

export const queueLeaseRepository = createQueueLeaseRepository(db);
