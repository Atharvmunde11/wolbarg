/**
 * Re-export storage types under the legacy database path.
 */

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
