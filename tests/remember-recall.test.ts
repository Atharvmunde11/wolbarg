import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/index.js";
import { useClientLifecycle } from "./helpers.js";

describe("remember + recall", () => {
  const { getClient } = useClientLifecycle();

  it("stores and recalls a memory", async () => {
    const ctx = getClient();
    const stored = await ctx.remember({
      agent: "research",
      content: { text: "Stripe supports recurring invoices." },
    });

    expect(stored.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(stored.agent).toBe("research");
    expect(stored.content.text).toBe("Stripe supports recurring invoices.");
    expect(stored.archived).toBe(false);
    expect(stored.metadata).toEqual({});

    const results = await ctx.recall({
      query: "recurring invoices",
      topK: 5,
      filter: { agent: "research" },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe(stored.id);
    expect(results[0]?.content.text).toBe(stored.content.text);
    expect(results[0]?.similarity).toBeGreaterThan(0.5);
  });

  it("rejects empty content", async () => {
    const ctx = getClient();
    await expect(
      ctx.remember({ agent: "a", content: { text: "  " } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("filters by agent", async () => {
    const ctx = getClient();
    await ctx.remember({
      agent: "research",
      content: { text: "alpha billing fact" },
    });
    await ctx.remember({
      agent: "writer",
      content: { text: "alpha tone guideline" },
    });

    const research = await ctx.recall({
      query: "alpha",
      topK: 10,
      filter: { agent: "research" },
    });

    expect(research.every((r) => r.agent === "research")).toBe(true);
    expect(research.some((r) => r.content.text.includes("billing"))).toBe(true);
  });

  it("respects similarity threshold", async () => {
    const ctx = getClient();
    await ctx.remember({
      agent: "research",
      content: { text: "completely unrelated astronomy notes" },
    });

    const strict = await ctx.recall({
      query: "recurring invoices stripe billing",
      topK: 5,
      threshold: 0.99,
    });

    // Deterministic fake embeddings may still score high for short texts;
    // ensure threshold filtering runs without throwing and returns an array.
    expect(Array.isArray(strict)).toBe(true);
    expect(strict.every((r) => r.similarity >= 0.99)).toBe(true);
  });
});
