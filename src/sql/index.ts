/**
 * Prepared-statement SQL templates for the SQLite provider.
 */

export const SQL = {
  getMeta: `SELECT value FROM agentorc_meta WHERE key = ?`,
  setMeta: `
    INSERT INTO agentorc_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,

  insertMemory: `
    INSERT INTO memories (
      id, organization, agent, content_text, metadata_json,
      archived, compressed_into, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)
  `,

  getMemoryById: `
    SELECT rowid, id, organization, agent, content_text, metadata_json,
           archived, compressed_into, created_at, updated_at
    FROM memories
    WHERE id = ? AND organization = ?
  `,

  getMemoryByRowid: `
    SELECT rowid, id, organization, agent, content_text, metadata_json,
           archived, compressed_into, created_at, updated_at
    FROM memories
    WHERE rowid = ? AND organization = ?
  `,

  listMemoriesBase: `
    SELECT rowid, id, organization, agent, content_text, metadata_json,
           archived, compressed_into, created_at, updated_at
    FROM memories
    WHERE organization = ?
  `,

  insertEmbedding: `
    INSERT INTO memory_embeddings (memory_rowid, embedding) VALUES (?, ?)
  `,

  deleteEmbedding: `
    DELETE FROM memory_embeddings WHERE memory_rowid = ?
  `,

  searchVectors: `
    SELECT memory_rowid, distance
    FROM memory_embeddings
    WHERE embedding MATCH ?
      AND k = ?
  `,

  insertEmbeddingBlob: `
    INSERT INTO memory_embeddings_blob (memory_rowid, embedding) VALUES (?, ?)
  `,

  deleteEmbeddingBlob: `
    DELETE FROM memory_embeddings_blob WHERE memory_rowid = ?
  `,

  listEmbeddingsBlob: `
    SELECT memory_rowid, embedding FROM memory_embeddings_blob
  `,

  archiveMemory: `
    UPDATE memories
    SET archived = 1,
        compressed_into = ?,
        updated_at = ?
    WHERE id = ? AND organization = ? AND archived = 0
  `,

  deleteMemoryById: `
    DELETE FROM memories WHERE id = ? AND organization = ?
  `,

  deleteMemoriesByOrg: `
    DELETE FROM memories WHERE organization = ?
  `,

  deleteMemoriesByOrgAgent: `
    DELETE FROM memories WHERE organization = ? AND agent = ?
  `,

  insertHistory: `
    INSERT INTO memory_history (id, memory_id, event_type, related_memory_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,

  getHistory: `
    SELECT id, memory_id, event_type, related_memory_id, created_at
    FROM memory_history
    WHERE memory_id = ?
    ORDER BY created_at ASC
  `,

  countMemories: `
    SELECT COUNT(*) AS count FROM memories WHERE organization = ?
  `,

  countAgents: `
    SELECT COUNT(DISTINCT agent) AS count FROM memories WHERE organization = ?
  `,

  listRowidsForOrg: `
    SELECT rowid FROM memories WHERE organization = ?
  `,

  listRowidsForOrgAgent: `
    SELECT rowid FROM memories WHERE organization = ? AND agent = ?
  `,

  vectorTableExists: `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'memory_embeddings'
  `,

  updateMemoryContent: `
    UPDATE memories
    SET content_text = COALESCE(?, content_text),
        metadata_json = COALESCE(?, metadata_json),
        updated_at = ?
    WHERE id = ? AND organization = ?
  `,

  insertFts: `
    INSERT INTO memories_fts (content_text, memory_id, organization, agent)
    VALUES (?, ?, ?, ?)
  `,

  deleteFts: `
    DELETE FROM memories_fts WHERE memory_id = ?
  `,

  searchFts: `
    SELECT memory_id, bm25(memories_fts) AS rank
    FROM memories_fts
    WHERE memories_fts MATCH ?
      AND organization = ?
    ORDER BY rank
    LIMIT ?
  `,
} as const;
