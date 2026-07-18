/**
 * Schema v4 / SQLite write-path optimizations.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Wolbarg, meta } from "../src/index.js";
import { createInitializedClient } from "./helpers.js";
import { SCHEMA_VERSION } from "../src/schema/index.js";

describe("sqlite schema v4 optimizations", () => {
  let client: Wolbarg;

  beforeEach(async () => {
    client = await createInitializedClient();
  });

  afterEach(async () => {
    await client.close();
    vi.unstubAllGlobals();
  });

  it("opens at schema version 4", async () => {
    const db = (client as unknown as { storage: { getDatabase: () => { prepare: (s: string) => { get: (k: string) => { value: string } } } } }).storage.getDatabase();
    const row = db
      .prepare("SELECT value FROM Wolbarg_meta WHERE key = ?")
      .get("schema_version") as { value: string };
    expect(Number(row.value)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(4);
  });

  it("does not create the redundant global created_at index", async () => {
    const db = (
      client as unknown as {
        storage: {
          getDatabase: () => {
            prepare: (s: string) => {
              all: () => Array<{ name: string }>;
            };
          };
        };
      }
    ).storage.getDatabase();
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
      .all() as Array<{ name: string }>;
    expect(indexes.some((i) => i.name === "idx_memories_created_at")).toBe(
      false,
    );
    expect(
      indexes.some((i) => i.name === "idx_memories_org_agent_active_created"),
    ).toBe(true);
  });

  it("filters list/searchByMetadata via SQL pushdown for eq", async () => {
    await client.remember({
      agent: "a1",
      content: { text: "alpha memory" },
      metadata: { project: "alpha" },
    });
    await client.remember({
      agent: "a1",
      content: { text: "beta memory" },
      metadata: { project: "beta" },
    });

    const hits = await client.recall({
      query: "memory",
      topK: 10,
      filter: { metadata: meta.eq("project", "alpha") },
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.every((h) => h.metadata.project === "alpha")).toBe(true);
  });

  it("removes archived memories from vector ANN after compress", async () => {
    const a = await client.remember({
      agent: "research",
      content: { text: "unique compressible fact about otters" },
    });
    const b = await client.remember({
      agent: "research",
      content: { text: "another unique compressible fact about otters" },
    });

    const result = await client.compress({ agent: "research" });
    expect(result.archivedIds).toEqual(expect.arrayContaining([a.id, b.id]));

    const db = (
      client as unknown as {
        storage: {
          getDatabase: () => {
            prepare: (s: string) => {
              get: (...a: unknown[]) => { c: number | bigint } | undefined;
              all: (...a: unknown[]) => unknown[];
            };
          };
          name: string;
        };
      }
    ).storage.getDatabase();

    // Active rows remain in FTS; archived must not.
    const fts = db
      .prepare(`SELECT COUNT(*) AS c FROM memories_fts WHERE memory_id = ?`)
      .get(a.id) as { c: number | bigint };
    expect(Number(fts.c)).toBe(0);

    // Prefer sqlite-vec table when present; else blob table.
    const hasVec = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'`,
      )
      .get() as { name: string } | undefined;
    if (hasVec) {
      const emb = db
        .prepare(
          `SELECT COUNT(*) AS c FROM memory_embeddings WHERE memory_rowid = (
             SELECT rowid FROM memories WHERE id = ?
           )`,
        )
        .get(a.id) as { c: number | bigint };
      expect(Number(emb.c)).toBe(0);
    } else {
      const emb = db
        .prepare(
          `SELECT COUNT(*) AS c FROM memory_embeddings_blob WHERE memory_rowid = (
             SELECT rowid FROM memories WHERE id = ?
           )`,
        )
        .get(a.id) as { c: number | bigint };
      expect(Number(emb.c)).toBe(0);
    }
  });

  it("clears an organization without leaving orphan FTS/embedding rows", async () => {
    await client.remember({
      agent: "a1",
      content: { text: "to be cleared" },
    });
    await client.clear({ confirm: true });

    const db = (
      client as unknown as {
        storage: {
          getDatabase: () => {
            prepare: (s: string) => {
              get: (...a: unknown[]) => { c: number | bigint };
            };
          };
        };
      }
    ).storage.getDatabase();

    const mem = db
      .prepare(`SELECT COUNT(*) AS c FROM memories`)
      .get() as { c: number | bigint };
    const fts = db
      .prepare(`SELECT COUNT(*) AS c FROM memories_fts`)
      .get() as { c: number | bigint };
    expect(Number(mem.c)).toBe(0);
    expect(Number(fts.c)).toBe(0);
  });
});
