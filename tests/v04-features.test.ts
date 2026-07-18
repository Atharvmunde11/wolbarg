/**
 * v0.4 — subscribe, embedding cache, memory upsert/dedupe tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Wolbarg } from "../src/index.js";
import {
  createInitializedClient,
  installFetchMock,
  baseInitOptions,
} from "./helpers.js";
import { hashMemoryContent } from "../src/memory/dedupe.js";
import {
  withEmbeddingCache,
  resolveEmbeddingCacheConfig,
  embeddingCacheKey,
} from "../src/embedding/cache.js";
import { MemoryEmbeddingCacheStore } from "../src/embedding/cache-store.js";
import type { EmbeddingProvider } from "../src/embedding/index.js";
import { SqliteSubscribeEmitter } from "../src/subscribe/sqlite-emitter.js";
import { resolveConcurrencyConfig } from "../src/storage/sqlite/concurrency-config.js";
import { StorageLockedError } from "../src/errors/index.js";

describe("v0.4 subscribe()", () => {
  let client: Wolbarg;

  beforeEach(async () => {
    client = await createInitializedClient();
  });

  afterEach(async () => {
    await client.close();
    vi.unstubAllGlobals();
  });

  it("fires remember event after write", async () => {
    const events: unknown[] = [];
    const unsub = client.subscribe(
      { organization: "test-org" },
      (e) => events.push(e),
    );

    await client.remember({
      agent: "a1",
      content: { text: "hello subscribe" },
    });

    expect(events.length).toBe(1);
    expect((events[0] as { event: string }).event).toBe("remember");
    unsub();
  });

  it("unsubscribe stops delivery", async () => {
    const events: unknown[] = [];
    const unsub = client.subscribe(
      { organization: "test-org" },
      (e) => events.push(e),
    );
    unsub();
    await client.remember({
      agent: "a1",
      content: { text: "after unsub" },
    });
    expect(events.length).toBe(0);
  });

  it("throwing callback does not fail write", async () => {
    client.subscribe({ organization: "test-org" }, () => {
      throw new Error("subscriber boom");
    });
    const record = await client.remember({
      agent: "a1",
      content: { text: "still works" },
    });
    expect(record.id).toBeTruthy();
  });
});

describe("v0.4 SqliteSubscribeEmitter unit", () => {
  it("filters by agent and event", () => {
    const emitter = new SqliteSubscribeEmitter();
    const hits: string[] = [];
    emitter.subscribe(
      { organization: "org", agent: "a", event: "update" },
      (e) => hits.push(e.event),
    );
    emitter.emit({
      event: "remember",
      organization: "org",
      agent: "a",
      memoryId: "1",
      timestamp: new Date().toISOString(),
    });
    emitter.emit({
      event: "update",
      organization: "org",
      agent: "a",
      memoryId: "1",
      timestamp: new Date().toISOString(),
    });
    emitter.emit({
      event: "update",
      organization: "org",
      agent: "b",
      memoryId: "2",
      timestamp: new Date().toISOString(),
    });
    expect(hits).toEqual(["update"]);
  });
});

describe("v0.4 embedding cache", () => {
  it("skips provider on cache hit", async () => {
    let calls = 0;
    const provider: EmbeddingProvider = {
      model: "test-model",
      async embed(text: string) {
        calls += 1;
        return Float32Array.from([text.length, 1, 0, 0, 0, 0, 0, 0]);
      },
      async validate() {
        return { dimensions: 8 };
      },
    };
    const store = new MemoryEmbeddingCacheStore();
    const cached = withEmbeddingCache(
      provider,
      store,
      resolveEmbeddingCacheConfig({ enabled: true }),
    );
    await cached.embed("same text");
    await cached.embed("same text");
    expect(calls).toBe(1);
    expect(cached.cacheHits).toBe(1);
    expect(cached.cacheMisses).toBe(1);
  });

  it("model change forces miss", async () => {
    const store = new MemoryEmbeddingCacheStore();
    const p1: EmbeddingProvider = {
      model: "m1",
      async embed() {
        return Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0]);
      },
      async validate() {
        return { dimensions: 8 };
      },
    };
    const p2: EmbeddingProvider = {
      model: "m2",
      async embed() {
        return Float32Array.from([0, 1, 0, 0, 0, 0, 0, 0]);
      },
      async validate() {
        return { dimensions: 8 };
      },
    };
    const c1 = withEmbeddingCache(
      p1,
      store,
      resolveEmbeddingCacheConfig({ enabled: true }),
    );
    await c1.embed("x");
    const c2 = withEmbeddingCache(
      p2,
      store,
      resolveEmbeddingCacheConfig({ enabled: true }),
    );
    await c2.embed("x");
    expect(c2.cacheMisses).toBe(1);
    expect(embeddingCacheKey("x", "m1")).not.toBe(
      embeddingCacheKey("x", "m2"),
    );
  });
});

describe("v0.4 memory upsert / dedupe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates instead of inserting when exact dedupe enabled", async () => {
    installFetchMock();
    const ctx = new Wolbarg({
      organization: "dedupe-org",
      database: { provider: "sqlite", connectionString: ":memory:" },
      embedding: {
        baseUrl: "https://embed.test/v1",
        apiKey: "k",
        model: "m",
      },
      memory: { dedupe: { enabled: true, strategy: "exact" } },
    });
    await ctx.ready();

    const first = await ctx.remember({
      agent: "agent",
      content: { text: "User prefers dark mode" },
      metadata: { a: 1 },
    });
    expect(first.action).toBe("created");

    const second = await ctx.remember({
      agent: "agent",
      content: { text: "User prefers dark mode" },
      metadata: { b: 2 },
    });
    expect(second.action).toBe("updated");
    expect(second.id).toBe(first.id);
    expect(second.metadata).toMatchObject({ a: 1, b: 2 });

    const stats = await ctx.stats();
    expect(stats.activeMemories).toBe(1);
    await ctx.close();
  });

  it("normalizes whitespace for exact match", async () => {
    installFetchMock();
    const ctx = new Wolbarg({
      organization: "dedupe-org2",
      database: { provider: "sqlite", connectionString: ":memory:" },
      embedding: {
        baseUrl: "https://embed.test/v1",
        apiKey: "k",
        model: "m",
      },
      memory: { dedupe: { enabled: true, strategy: "exact" } },
    });
    await ctx.ready();
    const a = await ctx.remember({
      agent: "agent",
      content: { text: "hello   world" },
    });
    const b = await ctx.remember({
      agent: "agent",
      content: { text: " hello world " },
    });
    expect(b.action).toBe("updated");
    expect(b.id).toBe(a.id);
    expect(hashMemoryContent("hello   world")).toBe(
      hashMemoryContent(" hello world "),
    );
    await ctx.close();
  });

  it("default dedupe off creates two rows", async () => {
    const client = await createInitializedClient();
    const a = await client.remember({
      agent: "a",
      content: { text: "dup text" },
    });
    const b = await client.remember({
      agent: "a",
      content: { text: "dup text" },
    });
    expect(a.action).toBe("created");
    expect(b.action).toBe("created");
    expect(a.id).not.toBe(b.id);
    await client.close();
  });

  it("records updated history event", async () => {
    installFetchMock();
    const ctx = new Wolbarg({
      organization: "hist-org",
      database: { provider: "sqlite", connectionString: ":memory:" },
      embedding: {
        baseUrl: "https://embed.test/v1",
        apiKey: "k",
        model: "m",
      },
      memory: { dedupe: { enabled: true, strategy: "exact" } },
    });
    await ctx.ready();
    const first = await ctx.remember({
      agent: "a",
      content: { text: "fact" },
    });
    await ctx.remember({
      agent: "a",
      content: { text: "fact" },
      metadata: { n: 1 },
    });
    const hist = await ctx.history({ id: first.id });
    const types = hist.events.map((e) => e.eventType);
    expect(types).toContain("created");
    expect(types).toContain("updated");
    await ctx.close();
  });

  it("emits update event on upsert", async () => {
    installFetchMock();
    const ctx = new Wolbarg({
      organization: "sub-org",
      database: { provider: "sqlite", connectionString: ":memory:" },
      embedding: {
        baseUrl: "https://embed.test/v1",
        apiKey: "k",
        model: "m",
      },
      memory: { dedupe: { enabled: true, strategy: "exact" } },
    });
    await ctx.ready();
    const events: string[] = [];
    ctx.subscribe({ organization: "sub-org" }, (e) => events.push(e.event));
    await ctx.remember({ agent: "a", content: { text: "x" } });
    await ctx.remember({ agent: "a", content: { text: "x" } });
    expect(events).toEqual(["remember", "update"]);
    await ctx.close();
  });
});

describe("v0.4 concurrency config", () => {
  it("resolves defaults", () => {
    const cfg = resolveConcurrencyConfig();
    expect(cfg.maxRetries).toBe(5);
    expect(cfg.lockTimeoutMs).toBe(5000);
  });

  it("StorageLockedError has stable code", () => {
    const err = new StorageLockedError("locked");
    expect(err.code).toBe("WOLBARG_STORAGE_LOCKED");
  });
});
