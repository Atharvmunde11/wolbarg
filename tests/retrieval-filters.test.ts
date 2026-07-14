/**
 * Unit tests for retrieval helpers and metadata matching.
 */

import { describe, expect, it } from "vitest";
import { matchesMetadata, meta } from "../src/filters/index.js";
import {
  adaptiveFetchK,
  applyMmr,
  fuseScores,
  resolveHybridWeights,
  resolveMmr,
} from "../src/retrieval/index.js";
import type { RecallResult } from "../src/types/index.js";
import { Bm25KeywordSearchProvider } from "../src/keyword/index.js";

describe("metadata matching", () => {
  const sample = { project: "alpha", score: 10, tags: ["a", "b"] };

  it("supports eq / gt / contains / and / or / not", () => {
    expect(matchesMetadata(sample, meta.eq("project", "alpha"))).toBe(true);
    expect(matchesMetadata(sample, meta.gt("score", 5))).toBe(true);
    expect(matchesMetadata(sample, meta.contains("project", "alp"))).toBe(true);
    expect(
      matchesMetadata(
        sample,
        meta.and(meta.eq("project", "alpha"), meta.lte("score", 10)),
      ),
    ).toBe(true);
    expect(
      matchesMetadata(
        sample,
        meta.or(meta.eq("project", "beta"), meta.eq("project", "alpha")),
      ),
    ).toBe(true);
    expect(matchesMetadata(sample, meta.not(meta.eq("project", "beta")))).toBe(
      true,
    );
  });
});

describe("retrieval helpers", () => {
  it("fuses semantic and keyword scores", () => {
    const fused = fuseScores(
      new Map([
        ["a", 0.9],
        ["b", 0.2],
      ]),
      new Map([
        ["a", 0.1],
        ["b", 1.0],
      ]),
      { semanticWeight: 0.7, keywordWeight: 0.3 },
    );
    expect(fused.get("a")).toBeGreaterThan(0);
    expect(fused.get("b")).toBeGreaterThan(0);
  });

  it("resolves hybrid / mmr options", () => {
    expect(resolveHybridWeights(true)?.semanticWeight).toBe(0.7);
    expect(resolveHybridWeights(false)).toBeNull();
    expect(resolveMmr(true)).toBe(0.5);
    expect(resolveMmr({ lambda: 0.8 })).toBe(0.8);
    expect(adaptiveFetchK(5, 4, true)).toBe(20);
  });

  it("applies MMR diversification", () => {
    const base = (
      text: string,
      similarity: number,
    ): RecallResult => ({
      id: text,
      organization: "o",
      agent: "a",
      content: { text },
      metadata: {},
      archived: false,
      similarity,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const results = applyMmr(
      [
        base("cats and dogs", 0.99),
        base("cats and kittens", 0.98),
        base("quantum physics", 0.5),
      ],
      2,
      0.5,
    );
    expect(results).toHaveLength(2);
    expect(results[0]!.content.text).toContain("cats and dogs");
  });
});

describe("bm25", () => {
  it("ranks matching documents higher", async () => {
    const provider = new Bm25KeywordSearchProvider();
    const hits = await provider.search(
      "brown fox",
      [
        { id: "1", text: "the quick brown fox" },
        { id: "2", text: "lorem ipsum dolor" },
      ],
      2,
    );
    expect(hits[0]!.memoryId).toBe("1");
    expect(hits[0]!.score).toBeGreaterThan(0);
  });
});
