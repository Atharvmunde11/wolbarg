/**
 * Memory content normalization + hash for write-time dedupe.
 */

import { createHash } from "node:crypto";

/**
 * Normalize content for exact-match dedupe:
 * 1. Unicode NFC
 * 2. Trim
 * 3. Collapse internal whitespace runs to a single space
 * 4. Do NOT case-fold
 */
export function normalizeMemoryContent(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function hashMemoryContent(text: string): string {
  const normalized = normalizeMemoryContent(text);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export type MemoryDedupeStrategy = "exact" | "near" | "exact-or-near";

export interface MemoryDedupeConfig {
  enabled?: boolean;
  strategy?: MemoryDedupeStrategy;
  /** Cosine similarity threshold for near-dup. Default 0.92 */
  nearThreshold?: number;
  /** Max vector candidates for near-dup. Default 8 */
  nearCandidateLimit?: number;
}

export interface ResolvedMemoryDedupeConfig {
  enabled: boolean;
  strategy: MemoryDedupeStrategy;
  nearThreshold: number;
  nearCandidateLimit: number;
}

export const DEFAULT_MEMORY_DEDUPE: ResolvedMemoryDedupeConfig = {
  enabled: false,
  strategy: "exact-or-near",
  nearThreshold: 0.92,
  nearCandidateLimit: 8,
};

export function resolveMemoryDedupeConfig(
  input?: boolean | MemoryDedupeConfig,
): ResolvedMemoryDedupeConfig {
  if (input === undefined) {
    return { ...DEFAULT_MEMORY_DEDUPE };
  }
  if (typeof input === "boolean") {
    return { ...DEFAULT_MEMORY_DEDUPE, enabled: input };
  }
  return {
    enabled: input.enabled ?? true,
    strategy: input.strategy ?? DEFAULT_MEMORY_DEDUPE.strategy,
    nearThreshold: input.nearThreshold ?? DEFAULT_MEMORY_DEDUPE.nearThreshold,
    nearCandidateLimit:
      input.nearCandidateLimit ?? DEFAULT_MEMORY_DEDUPE.nearCandidateLimit,
  };
}

export function mergeMemoryMetadata(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...incoming };
}
