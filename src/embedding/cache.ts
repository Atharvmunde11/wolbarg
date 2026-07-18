/**
 * Transparent embedding cache wrapping any EmbeddingProvider.
 */

import { createHash } from "node:crypto";

/** Minimal provider contract — avoids circular import with embedding/index.ts */
export interface EmbeddingProviderLike {
  readonly model: string;
  embed(text: string): Promise<Float32Array>;
  embedBatch?(texts: string[]): Promise<Float32Array[]>;
  validate(): Promise<{ dimensions: number }>;
}

export interface EmbeddingCacheConfig {
  /** Default true in 0.4 */
  enabled?: boolean;
  /** Lazy TTL expiry on read; default no expiry */
  ttlMs?: number;
  /** LRU eviction when set; default unbounded */
  maxEntries?: number;
}

export interface ResolvedEmbeddingCacheConfig {
  enabled: boolean;
  ttlMs: number | null;
  maxEntries: number | null;
}

export function resolveEmbeddingCacheConfig(
  input?: EmbeddingCacheConfig,
): ResolvedEmbeddingCacheConfig {
  return {
    enabled: input?.enabled ?? true,
    ttlMs: input?.ttlMs ?? null,
    maxEntries: input?.maxEntries ?? null,
  };
}

export function embeddingCacheKey(content: string, model: string): string {
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  return `${hash}:${model}`;
}

export interface EmbeddingCacheStore {
  get(cacheKey: string): Promise<Float32Array | null>;
  set(cacheKey: string, model: string, vector: Float32Array): Promise<void>;
  touch(cacheKey: string): Promise<void>;
  evictIfNeeded(maxEntries: number): Promise<void>;
}

export interface CacheAwareEmbedding extends EmbeddingProviderLike {
  readonly cacheHits: number;
  readonly cacheMisses: number;
  resetCacheStats(): void;
}

/**
 * Wrap an embedding provider with a content+model cache.
 * Cache check happens per-item before batch assembly.
 */
export function withEmbeddingCache(
  provider: EmbeddingProviderLike,
  store: EmbeddingCacheStore,
  config: ResolvedEmbeddingCacheConfig,
): CacheAwareEmbedding {
  let cacheHits = 0;
  let cacheMisses = 0;

  async function embedOne(text: string): Promise<Float32Array> {
    if (!config.enabled) {
      cacheMisses += 1;
      return provider.embed(text);
    }
    const key = embeddingCacheKey(text, provider.model);
    const cached = await store.get(key);
    if (cached) {
      cacheHits += 1;
      // LRU touch is batched inside SqliteEmbeddingCacheStore.get — no per-hit write here.
      return cached;
    }
    cacheMisses += 1;
    const vector = await provider.embed(text);
    // Fire-and-forget durable write — L1 is updated synchronously inside set().
    void store.set(key, provider.model, vector);
    if (config.maxEntries !== null) {
      void store.evictIfNeeded(config.maxEntries);
    }
    return vector;
  }

  async function embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!config.enabled || texts.length === 0) {
      if (provider.embedBatch) {
        cacheMisses += texts.length;
        return provider.embedBatch(texts);
      }
      return Promise.all(texts.map((t) => embedOne(t)));
    }

    const results: Array<Float32Array | null> = new Array(texts.length).fill(
      null,
    );
    const missIndexes: number[] = [];
    const missTexts: string[] = [];

    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i]!;
      const key = embeddingCacheKey(text, provider.model);
      const cached = await store.get(key);
      if (cached) {
        cacheHits += 1;
        results[i] = cached;
      } else {
        missIndexes.push(i);
        missTexts.push(text);
      }
    }

    if (missTexts.length > 0) {
      cacheMisses += missTexts.length;
      const vectors = provider.embedBatch
        ? await provider.embedBatch(missTexts)
        : await Promise.all(missTexts.map((t) => provider.embed(t)));
      for (let j = 0; j < missIndexes.length; j += 1) {
        const idx = missIndexes[j]!;
        const vector = vectors[j]!;
        results[idx] = vector;
        const key = embeddingCacheKey(missTexts[j]!, provider.model);
        void store.set(key, provider.model, vector);
      }
      if (config.maxEntries !== null) {
        void store.evictIfNeeded(config.maxEntries);
      }
    }

    return results as Float32Array[];
  }

  return {
    model: provider.model,
    embed: embedOne,
    embedBatch,
    validate: () => provider.validate(),
    get cacheHits() {
      return cacheHits;
    },
    get cacheMisses() {
      return cacheMisses;
    },
    resetCacheStats() {
      cacheHits = 0;
      cacheMisses = 0;
    },
  };
}
