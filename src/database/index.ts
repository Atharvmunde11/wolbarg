/**
 * Database module — re-exports storage for backwards compatibility.
 */

export {
  createDatabaseProvider,
  createStorageProvider,
  SqliteDatabaseProvider,
  SqliteStorageProvider,
  PostgresStorageProvider,
} from "../storage/index.js";

export type {
  DatabaseProvider,
  StorageProvider,
  MemoryRow,
  HistoryRow,
  InsertMemoryInput,
  UpdateMemoryInput,
  RepositoryFilter,
  VectorSearchHit,
} from "../storage/types.js";
