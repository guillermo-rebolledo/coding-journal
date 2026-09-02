import { and, eq, lte, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { serviceCircuit } from "@/db/auth-schema";
import type { CircuitSnapshot, CircuitStore } from "@/lib/service-circuit";

/**
 * Every transition is a single conditional statement, so two instances that
 * observe the same failure cannot open the circuit twice or reset a window
 * the other one just rolled.
 */
export function createServiceCircuitRepository<
  TQueryResult extends PgQueryResultHKT,
>(
  database: PgDatabase<TQueryResult, typeof import("@/db/auth-schema")>,
): CircuitStore {
  return {
    async tryEnter({ service, now, configuration }) {
      // Admit calls again once the cooldown has passed. The reset is
      // conditional, so exactly one instance rolls the window.
      const [reset] = await database
        .update(serviceCircuit)
        .set({
          state: "closed",
          failureCount: 0,
          windowStartedAt: now,
          openedAt: null,
          retryAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(serviceCircuit.service, service),
            eq(serviceCircuit.state, "open"),
            lte(serviceCircuit.retryAt, now),
          ),
        )
        .returning({ service: serviceCircuit.service });
      if (reset) return { allowed: true };

      const row = await database.query.serviceCircuit.findFirst({
        where: eq(serviceCircuit.service, service),
      });
      if (!row || row.state === "closed") return { allowed: true };

      const retryAt =
        row.retryAt ?? new Date(now.getTime() + configuration.cooldownMs);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((retryAt.getTime() - now.getTime()) / 1000),
        ),
      };
    },

    async recordSuccess(service, now) {
      await database
        .insert(serviceCircuit)
        .values({
          service,
          state: "closed",
          failureCount: 0,
          windowStartedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: serviceCircuit.service,
          set: {
            state: "closed",
            failureCount: 0,
            windowStartedAt: now,
            openedAt: null,
            retryAt: null,
            updatedAt: now,
          },
        });
    },

    async recordFailure({ service, now, configuration }) {
      const at = sql`${now.toISOString()}::timestamptz`;
      const windowExpired = sql`${serviceCircuit.windowStartedAt} <= ${sql`${new Date(
        now.getTime() - configuration.failureWindowMs,
      ).toISOString()}::timestamptz`}`;

      const [row] = await database
        .insert(serviceCircuit)
        .values({
          service,
          state: "closed",
          failureCount: 1,
          windowStartedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: serviceCircuit.service,
          set: {
            failureCount: sql`case when ${windowExpired} then 1 else ${serviceCircuit.failureCount} + 1 end`,
            windowStartedAt: sql`case when ${windowExpired} then ${at} else ${serviceCircuit.windowStartedAt} end`,
            updatedAt: now,
          },
        })
        .returning({ failureCount: serviceCircuit.failureCount });

      if ((row?.failureCount ?? 0) < configuration.failureThreshold) return;

      await database
        .update(serviceCircuit)
        .set({
          state: "open",
          openedAt: now,
          retryAt: new Date(now.getTime() + configuration.cooldownMs),
          updatedAt: now,
        })
        .where(
          and(
            eq(serviceCircuit.service, service),
            eq(serviceCircuit.state, "closed"),
          ),
        );
    },

    async readAll(): Promise<CircuitSnapshot[]> {
      const rows = await database.query.serviceCircuit.findMany();
      return rows.map((row) => ({
        service: row.service,
        state: row.state,
        failureCount: row.failureCount,
        openedAt: row.openedAt,
        retryAt: row.retryAt,
        updatedAt: row.updatedAt,
      }));
    },
  };
}

export const serviceCircuitRepository = createServiceCircuitRepository(db);
