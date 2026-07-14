/**
 * Public factory helpers for storage / providers.
 */

import type { PostgresDatabaseConfig, SqliteDatabaseConfig } from "../types/index.js";
import { SqliteStorageProvider } from "../storage/providers/sqlite.js";
import { PostgresStorageProvider } from "../storage/providers/postgres.js";
import type { StorageProvider } from "../storage/types.js";

/** Create a SQLite storage provider from a path or `:memory:`. */
export function sqlite(
  connectionString: string,
): StorageProvider {
  return new SqliteStorageProvider({ connectionString });
}

/** Create a SQLite storage config object (for init / options). */
export function sqliteConfig(
  connectionString: string,
): SqliteDatabaseConfig {
  return { provider: "sqlite", connectionString };
}

/** Create a PostgreSQL storage provider. Requires optional peer dependency `pg`. */
export function postgres(
  options: string | { connectionString: string; maxPoolSize?: number },
): StorageProvider {
  const opts =
    typeof options === "string"
      ? { connectionString: options }
      : options;
  return new PostgresStorageProvider(opts);
}

/** Create a PostgreSQL storage config object. */
export function postgresConfig(
  connectionString: string,
  options?: { maxPoolSize?: number },
): PostgresDatabaseConfig {
  return {
    provider: "postgres",
    connectionString,
    ...options,
  };
}
