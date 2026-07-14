/**
 * PostgreSQL storage provider with optional pgvector support.
 * Requires the optional `pg` peer dependency.
 */

import { DatabaseError, InitializationError, ConfigurationError } from "../../errors/index.js";
import { matchesMetadata } from "../../filters/match.js";
import { SCHEMA_VERSION, META_KEYS } from "../../schema/index.js";
import {
  deserializeMetadata,
  serializeMetadata,
} from "../../utils/index.js";
import { cosineDistance } from "../../utils/vector.js";
import type {
  HistoryRow,
  InsertMemoryInput,
  MemoryRow,
  RepositoryFilter,
  StorageProvider,
  UpdateMemoryInput,
  VectorSearchHit,
} from "../types.js";

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end: () => Promise<void>;
  connect: () => Promise<{
    query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
    release: () => void;
  }>;
};

export interface PostgresProviderOptions {
  connectionString: string;
  maxPoolSize?: number;
}

export class PostgresStorageProvider implements StorageProvider {
  readonly name = "postgres";

  private readonly connectionString: string;
  private readonly maxPoolSize: number;
  private pool: PgPool | null = null;
  private vectorDimensions: number | null = null;
  private hasPgvector = false;

  constructor(options: PostgresProviderOptions) {
    this.connectionString = options.connectionString;
    this.maxPoolSize = options.maxPoolSize ?? 10;
  }

  async open(): Promise<void> {
    let PoolCtor: new (config: {
      connectionString: string;
      max: number;
    }) => PgPool;
    try {
      const mod = await import("pg");
      PoolCtor = (mod as { Pool: typeof PoolCtor }).Pool ?? (mod as { default: { Pool: typeof PoolCtor } }).default.Pool;
    } catch {
      throw new ConfigurationError(
        'PostgreSQL storage requires the optional "pg" package. Install it with: npm install pg',
      );
    }

    try {
      this.pool = new PoolCtor({
        connectionString: this.connectionString,
        max: this.maxPoolSize,
      });
      await this.pool.query("SELECT 1");
      await this.runMigrations();
      const dims = await this.getEmbeddingDimensions();
      if (dims !== null) {
        this.vectorDimensions = dims;
      }
    } catch (error) {
      await this.pool?.end().catch(() => undefined);
      this.pool = null;
      if (error instanceof ConfigurationError || error instanceof InitializationError) {
        throw error;
      }
      throw new InitializationError(
        `Failed to open PostgreSQL database: ${this.describe(error)}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }

  async close(): Promise<void> {
    if (!this.pool) {
      return;
    }
    await this.pool.end();
    this.pool = null;
  }

  async ensureVectorSchema(dimensions: number): Promise<void> {
    const existing = await this.getEmbeddingDimensions();
    if (existing !== null && existing !== dimensions) {
      throw new InitializationError(
        `Embedding dimensions mismatch: database is configured for ${existing}-d vectors, but the embedding model returned ${dimensions}-d vectors.`,
      );
    }
    this.hasPgvector = await this.tryEnablePgvector();
    if (this.hasPgvector) {
      await this.pool!.query(`
        CREATE TABLE IF NOT EXISTS memory_embeddings (
          memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
          embedding vector(${dimensions})
        )
      `);
    } else {
      await this.pool!.query(`
        CREATE TABLE IF NOT EXISTS memory_embeddings_blob (
          memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
          embedding BYTEA NOT NULL
        )
      `);
    }
    if (existing === null) {
      await this.setEmbeddingDimensions(dimensions);
    }
    this.vectorDimensions = dimensions;
  }

  async getEmbeddingDimensions(): Promise<number | null> {
    const result = await this.pool!.query(
      `SELECT value FROM agentorc_meta WHERE key = $1`,
      [META_KEYS.embeddingDimensions],
    );
    const value = result.rows[0]?.value;
    if (typeof value !== "string") {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async setEmbeddingDimensions(dimensions: number): Promise<void> {
    await this.pool!.query(
      `INSERT INTO agentorc_meta (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [META_KEYS.embeddingDimensions, String(dimensions)],
    );
    this.vectorDimensions = dimensions;
  }

  async insertMemory(input: InsertMemoryInput): Promise<MemoryRow> {
    const rows = await this.insertMemoriesBatch([input]);
    return rows[0]!;
  }

  async insertMemoriesBatch(inputs: InsertMemoryInput[]): Promise<MemoryRow[]> {
    if (inputs.length === 0) {
      return [];
    }
    this.requireVectorReady();
    return this.withTransaction(async () => {
      const pool = this.requirePool();
      const out: MemoryRow[] = [];

      for (const input of inputs) {
        const inserted = await pool.query(
          `INSERT INTO memories (
            id, organization, agent, content_text, metadata_json,
            archived, compressed_into, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,false,NULL,$6,$7)
          RETURNING id, organization, agent, content_text, metadata_json,
                    archived::int AS archived, compressed_into, created_at, updated_at`,
          [
            input.id,
            input.organization,
            input.agent,
            input.contentText,
            serializeMetadata(input.metadata),
            input.createdAt,
            input.updatedAt,
          ],
        );
        const row = this.mapRow(inserted.rows[0]!);
        await this.insertEmbedding(input.id, input.embedding);
        await pool.query(
          `INSERT INTO memory_history (id, memory_id, event_type, related_memory_id, created_at)
           VALUES ($1,$2,'created',NULL,$3)`,
          [crypto.randomUUID(), input.id, input.createdAt],
        );
        out.push(row);
      }
      return out;
    });
  }

  async updateMemory(input: UpdateMemoryInput): Promise<MemoryRow | null> {
    const existing = await this.getMemoryById(input.id, input.organization);
    if (!existing) {
      return null;
    }
    const pool = this.requirePool();
    await pool.query(
      `UPDATE memories SET
        content_text = COALESCE($1, content_text),
        metadata_json = COALESCE($2, metadata_json),
        updated_at = $3
       WHERE id = $4 AND organization = $5`,
      [
        input.contentText ?? null,
        input.metadata !== undefined ? serializeMetadata(input.metadata) : null,
        input.updatedAt,
        input.id,
        input.organization,
      ],
    );
    if (input.embedding) {
      await this.deleteEmbedding(input.id);
      await this.insertEmbedding(input.id, input.embedding);
    }
    return this.getMemoryById(input.id, input.organization);
  }

  async getMemoryById(id: string, organization: string): Promise<MemoryRow | null> {
    const result = await this.requirePool().query(
      `SELECT id, organization, agent, content_text, metadata_json,
              archived::int AS archived, compressed_into, created_at, updated_at
       FROM memories WHERE id = $1 AND organization = $2`,
      [id, organization],
    );
    const row = result.rows[0];
    return row ? this.mapRow(row) : null;
  }

  async getMemoryByRowid(rowid: number, organization: string): Promise<MemoryRow | null> {
    // Postgres uses memory id as key; rowid is encoded as hash slot in vector hits.
    // We store integer surrogate via ctid isn't stable — use lookup table.
    const result = await this.requirePool().query(
      `SELECT m.id, m.organization, m.agent, m.content_text, m.metadata_json,
              m.archived::int AS archived, m.compressed_into, m.created_at, m.updated_at,
              e.row_num AS rowid
       FROM memories m
       JOIN memory_row_map e ON e.memory_id = m.id
       WHERE e.row_num = $1 AND m.organization = $2`,
      [rowid, organization],
    );
    const row = result.rows[0];
    return row ? this.mapRow(row) : null;
  }

  async listMemories(filter: RepositoryFilter, limit?: number): Promise<MemoryRow[]> {
    const clauses = [`organization = $1`];
    const params: unknown[] = [filter.organization];
    let idx = 2;
    if (filter.agent) {
      clauses.push(`agent = $${idx++}`);
      params.push(filter.agent);
    }
    if (!filter.includeArchived) {
      clauses.push(`archived = false`);
    }
    let sql = `
      SELECT id, organization, agent, content_text, metadata_json,
             archived::int AS archived, compressed_into, created_at, updated_at
      FROM memories
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at ASC
    `;
    if (limit !== undefined) {
      sql += ` LIMIT $${idx}`;
      params.push(limit);
    }
    const result = await this.requirePool().query(sql, params);
    let rows = result.rows.map((r) => this.mapRow(r));
    if (filter.metadata) {
      rows = rows.filter((row) =>
        matchesMetadata(deserializeMetadata(row.metadata_json), filter.metadata!),
      );
    }
    return rows;
  }

  async searchByMetadata(
    filter: RepositoryFilter,
    limit?: number,
  ): Promise<MemoryRow[]> {
    return this.listMemories(filter, limit);
  }

  async searchVectors(
    embedding: Float32Array,
    topK: number,
  ): Promise<VectorSearchHit[]> {
    this.requireVectorReady();
    const pool = this.requirePool();

    if (this.hasPgvector) {
      const vectorLiteral = `[${Array.from(embedding).join(",")}]`;
      const result = await pool.query(
        `SELECT r.row_num AS memory_rowid,
                (e.embedding <=> $1::vector) AS distance
         FROM memory_embeddings e
         JOIN memory_row_map r ON r.memory_id = e.memory_id
         ORDER BY e.embedding <=> $1::vector
         LIMIT $2`,
        [vectorLiteral, topK],
      );
      return result.rows.map((row) => ({
        memoryRowid: Number(row.memory_rowid),
        distance: Number(row.distance),
      }));
    }

    const result = await pool.query(
      `SELECT r.row_num AS memory_rowid, e.embedding
       FROM memory_embeddings_blob e
       JOIN memory_row_map r ON r.memory_id = e.memory_id`,
    );
    const scored = result.rows.map((row) => {
      const buf = row.embedding as Buffer;
      const vec = new Float32Array(
        buf.buffer,
        buf.byteOffset,
        buf.byteLength / Float32Array.BYTES_PER_ELEMENT,
      );
      return {
        memoryRowid: Number(row.memory_rowid),
        distance: cosineDistance(embedding, vec),
      };
    });
    scored.sort((a, b) => a.distance - b.distance);
    return scored.slice(0, topK);
  }

  async archiveMemories(
    ids: string[],
    organization: string,
    compressedIntoId: string,
    archivedAt: string,
  ): Promise<string[]> {
    const pool = this.requirePool();
    const archived: string[] = [];
    for (const id of ids) {
      const result = await pool.query(
        `UPDATE memories
         SET archived = true, compressed_into = $1, updated_at = $2
         WHERE id = $3 AND organization = $4 AND archived = false`,
        [compressedIntoId, archivedAt, id, organization],
      );
      if ((result.rowCount ?? 0) > 0) {
        archived.push(id);
        await pool.query(
          `INSERT INTO memory_history (id, memory_id, event_type, related_memory_id, created_at)
           VALUES ($1,$2,'archived',$3,$4)`,
          [crypto.randomUUID(), id, compressedIntoId, archivedAt],
        );
        await pool.query(
          `INSERT INTO memory_history (id, memory_id, event_type, related_memory_id, created_at)
           VALUES ($1,$2,'compressed',$3,$4)`,
          [crypto.randomUUID(), compressedIntoId, id, archivedAt],
        );
      }
    }
    return archived;
  }

  async deleteMemoryById(id: string, organization: string): Promise<boolean> {
    const result = await this.requirePool().query(
      `DELETE FROM memories WHERE id = $1 AND organization = $2`,
      [id, organization],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteMemoriesByFilter(filter: RepositoryFilter): Promise<number> {
    if (!filter.agent) {
      throw new DatabaseError("deleteMemoriesByFilter requires an agent filter");
    }
    const result = await this.requirePool().query(
      `DELETE FROM memories WHERE organization = $1 AND agent = $2`,
      [filter.organization, filter.agent],
    );
    return result.rowCount ?? 0;
  }

  async clearOrganization(organization: string): Promise<number> {
    const result = await this.requirePool().query(
      `DELETE FROM memories WHERE organization = $1`,
      [organization],
    );
    return result.rowCount ?? 0;
  }

  async getHistory(memoryId: string): Promise<HistoryRow[]> {
    const result = await this.requirePool().query(
      `SELECT id, memory_id, event_type, related_memory_id, created_at
       FROM memory_history WHERE memory_id = $1 ORDER BY created_at ASC`,
      [memoryId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      memory_id: String(row.memory_id),
      event_type: row.event_type as HistoryRow["event_type"],
      related_memory_id:
        row.related_memory_id === null ? null : String(row.related_memory_id),
      created_at: String(row.created_at),
    }));
  }

  async insertHistoryEvent(event: HistoryRow): Promise<void> {
    await this.requirePool().query(
      `INSERT INTO memory_history (id, memory_id, event_type, related_memory_id, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        event.id,
        event.memory_id,
        event.event_type,
        event.related_memory_id,
        event.created_at,
      ],
    );
  }

  async getStats(
    organization: string,
  ): Promise<{ totalMemories: number; totalAgents: number }> {
    const pool = this.requirePool();
    const memories = await pool.query(
      `SELECT COUNT(*)::int AS count FROM memories WHERE organization = $1`,
      [organization],
    );
    const agents = await pool.query(
      `SELECT COUNT(DISTINCT agent)::int AS count FROM memories WHERE organization = $1`,
      [organization],
    );
    return {
      totalMemories: Number(memories.rows[0]?.count ?? 0),
      totalAgents: Number(agents.rows[0]?.count ?? 0),
    };
  }

  async getDatabaseSizeBytes(): Promise<number> {
    const result = await this.requirePool().query(
      `SELECT pg_database_size(current_database())::bigint AS size`,
    );
    return Number(result.rows[0]?.size ?? 0);
  }

  async withTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const client = await this.requirePool().connect();
    try {
      await client.query("BEGIN");
      const result = await fn();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof DatabaseError || error instanceof InitializationError) {
        throw error;
      }
      throw new DatabaseError(`Transaction failed: ${this.describe(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    } finally {
      client.release();
    }
  }

  private async runMigrations(): Promise<void> {
    const pool = this.requirePool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agentorc_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY NOT NULL,
        organization TEXT NOT NULL,
        agent TEXT NOT NULL,
        content_text TEXT NOT NULL,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        archived BOOLEAN NOT NULL DEFAULT false,
        compressed_into TEXT NULL REFERENCES memories(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memory_history (
        id TEXT PRIMARY KEY NOT NULL,
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK (event_type IN ('created', 'archived', 'compressed')),
        related_memory_id TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memory_row_map (
        memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        row_num BIGSERIAL UNIQUE NOT NULL
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_memories_org_agent ON memories(organization, agent)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_memories_org_archived ON memories(organization, archived)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_memories_metadata ON memories USING GIN (metadata_json)`,
    );

    const versionRow = await pool.query(
      `SELECT value FROM agentorc_meta WHERE key = $1`,
      [META_KEYS.schemaVersion],
    );
    if (!versionRow.rows[0]) {
      await pool.query(
        `INSERT INTO agentorc_meta (key, value) VALUES ($1, $2)`,
        [META_KEYS.schemaVersion, String(SCHEMA_VERSION)],
      );
    }
  }

  private async tryEnablePgvector(): Promise<boolean> {
    try {
      await this.requirePool().query(`CREATE EXTENSION IF NOT EXISTS vector`);
      return true;
    } catch {
      return false;
    }
  }

  private async insertEmbedding(memoryId: string, embedding: Float32Array): Promise<void> {
    const pool = this.requirePool();
    await pool.query(
      `INSERT INTO memory_row_map (memory_id) VALUES ($1)
       ON CONFLICT (memory_id) DO NOTHING`,
      [memoryId],
    );
    if (this.hasPgvector) {
      const vectorLiteral = `[${Array.from(embedding).join(",")}]`;
      await pool.query(
        `INSERT INTO memory_embeddings (memory_id, embedding) VALUES ($1, $2::vector)
         ON CONFLICT (memory_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
        [memoryId, vectorLiteral],
      );
      return;
    }
    const buf = Buffer.from(
      embedding.buffer,
      embedding.byteOffset,
      embedding.byteLength,
    );
    await pool.query(
      `INSERT INTO memory_embeddings_blob (memory_id, embedding) VALUES ($1, $2)
       ON CONFLICT (memory_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [memoryId, buf],
    );
  }

  private async deleteEmbedding(memoryId: string): Promise<void> {
    const pool = this.requirePool();
    await pool.query(`DELETE FROM memory_embeddings WHERE memory_id = $1`, [memoryId]).catch(() => undefined);
    await pool.query(`DELETE FROM memory_embeddings_blob WHERE memory_id = $1`, [memoryId]).catch(() => undefined);
  }

  private mapRow(row: Record<string, unknown>): MemoryRow {
    return {
      id: String(row.id),
      organization: String(row.organization),
      agent: String(row.agent),
      content_text: String(row.content_text),
      metadata_json:
        typeof row.metadata_json === "string"
          ? row.metadata_json
          : JSON.stringify(row.metadata_json ?? {}),
      archived: Number(row.archived ?? 0),
      compressed_into:
        row.compressed_into === null || row.compressed_into === undefined
          ? null
          : String(row.compressed_into),
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(String(row.updated_at)).toISOString(),
      rowid: row.rowid !== undefined ? Number(row.rowid) : undefined,
    };
  }

  private requirePool(): PgPool {
    if (!this.pool) {
      throw new DatabaseError("Database is not open. Call open() first.");
    }
    return this.pool;
  }

  private requireVectorReady(): void {
    if (this.vectorDimensions === null) {
      throw new DatabaseError(
        "Vector index is not ready. Embedding dimensions have not been initialized.",
      );
    }
  }

  private describe(error: unknown): string {
    if (error instanceof Error) {
      const aggregate = error as Error & { errors?: unknown[] };
      if (Array.isArray(aggregate.errors) && aggregate.errors.length > 0) {
        const nested = aggregate.errors
          .map((item) => (item instanceof Error ? item.message : String(item)))
          .join("; ");
        return `${error.message || error.name}: ${nested}`;
      }
      return error.message || error.name;
    }
    return String(error);
  }
}
