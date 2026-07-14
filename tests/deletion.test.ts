import { describe, expect, it } from "vitest";
import { MemoryNotFoundError, ValidationError } from "../src/index.js";
import { useClientLifecycle } from "./helpers.js";

describe("deletion", () => {
  const { getClient } = useClientLifecycle();

  it("forgets a memory by id", async () => {
    const ctx = getClient();
    const stored = await ctx.remember({
      agent: "research",
      content: { text: "Temporary fact." },
    });

    const deleted = await ctx.forget({ id: stored.id });
    expect(deleted).toBe(1);

    const results = await ctx.recall({
      query: "Temporary fact.",
      topK: 5,
    });
    expect(results.find((r) => r.id === stored.id)).toBeUndefined();

    await expect(ctx.history({ id: stored.id })).rejects.toBeInstanceOf(
      MemoryNotFoundError,
    );
  });

  it("forgets memories by agent filter", async () => {
    const ctx = getClient();
    await ctx.remember({
      agent: "research",
      content: { text: "Research note one." },
    });
    await ctx.remember({
      agent: "research",
      content: { text: "Research note two." },
    });
    await ctx.remember({
      agent: "writer",
      content: { text: "Writer note." },
    });

    const deleted = await ctx.forget({ filter: { agent: "research" } });
    expect(deleted).toBe(2);

    const stats = await ctx.stats();
    expect(stats.totalMemories).toBe(1);
  });

  it("clears all memories with confirm: true", async () => {
    const ctx = getClient();
    await ctx.remember({
      agent: "a",
      content: { text: "one" },
    });
    await ctx.remember({
      agent: "b",
      content: { text: "two" },
    });

    await expect(ctx.clear({ confirm: false as true })).rejects.toBeInstanceOf(
      ValidationError,
    );

    const deleted = await ctx.clear({ confirm: true });
    expect(deleted).toBe(2);

    const stats = await ctx.stats();
    expect(stats.totalMemories).toBe(0);
    expect(stats.totalAgents).toBe(0);
  });
});
