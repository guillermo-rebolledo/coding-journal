// @vitest-environment node

import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { AnyPgTable, getTableConfig, PgTable } from "drizzle-orm/pg-core";

import * as schema from "@/db/auth-schema";

describe("user-owned schema", () => {
  it("cascades every table with a userId column when the user is deleted", () => {
    const userScopedTables = Object.values(schema).filter(
      (value) => is(value, PgTable) && "userId" in value,
    ) as AnyPgTable[];

    expect(userScopedTables.length).toBeGreaterThan(0);
    for (const table of userScopedTables) {
      const config = getTableConfig(table);
      const userForeignKey = config.foreignKeys.find((foreignKey) =>
        foreignKey
          .reference()
          .columns.some((column) => column.name === "user_id"),
      );
      expect(
        userForeignKey,
        `${config.name}.user_id has a foreign key`,
      ).toBeDefined();
      expect(userForeignKey?.onDelete, `${config.name}.user_id cascades`).toBe(
        "cascade",
      );
    }
  });
});
