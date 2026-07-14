import { describe, expect, it } from "vitest";
import { useClientLifecycle } from "./helpers.js";

describe("metadata", () => {
  const { getClient } = useClientLifecycle();

  it("stores and returns opaque metadata unchanged", async () => {
    const ctx = getClient();
    const metadata = {
      source: "docs",
      nested: { a: 1, b: [true, "x"] },
      flag: false,
      count: 42,
    };

    const stored = await ctx.remember({
      agent: "research",
      content: { text: "Metadata should round-trip exactly." },
      metadata,
    });

    expect(stored.metadata).toEqual(metadata);

    const recalled = await ctx.recall({
      query: "Metadata should round-trip exactly.",
      topK: 1,
    });

    expect(recalled[0]?.metadata).toEqual(metadata);
  });

  it("defaults metadata to empty object", async () => {
    const ctx = getClient();
    const stored = await ctx.remember({
      agent: "research",
      content: { text: "No metadata provided." },
    });
    expect(stored.metadata).toEqual({});
  });

  it("does not interpret metadata fields", async () => {
    const ctx = getClient();
    const stored = await ctx.remember({
      agent: "research",
      content: { text: "Custom keys are fine." },
      metadata: {
        agent: "should-not-override",
        id: "should-not-override",
        organization: "should-not-override",
      },
    });

    expect(stored.agent).toBe("research");
    expect(stored.organization).toBe("test-org");
    expect(stored.id).not.toBe("should-not-override");
    expect(stored.metadata.agent).toBe("should-not-override");
  });
});
