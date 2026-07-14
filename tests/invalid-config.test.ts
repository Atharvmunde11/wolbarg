import { describe, expect, it } from "vitest";
import { ConfigurationError, ValidationError } from "../src/index.js";
import { validateInitOptions } from "../src/core/validate.js";
import { baseInitOptions } from "./helpers.js";

describe("invalid configs", () => {
  it("rejects empty api keys", () => {
    expect(() =>
      validateInitOptions(
        baseInitOptions({
          embedding: {
            baseUrl: "https://embed.test/v1",
            apiKey: "",
            model: "m",
          },
        }),
      ),
    ).toThrow(ConfigurationError);
  });

  it("rejects invalid temperature", () => {
    expect(() =>
      validateInitOptions(
        baseInitOptions({
          llm: {
            baseUrl: "https://llm.test/v1",
            apiKey: "k",
            model: "m",
            temperature: 5,
          },
        }),
      ),
    ).toThrow(ConfigurationError);
  });

  it("rejects non-object init payload", () => {
    expect(() =>
      validateInitOptions(null as unknown as ReturnType<typeof baseInitOptions>),
    ).toThrow(ConfigurationError);
  });

  it("rejects forget without id or filter", async () => {
    const { createInitializedClient } = await import("./helpers.js");
    const ctx = await createInitializedClient();
    await expect(
      ctx.forget({} as { id: string }),
    ).rejects.toBeInstanceOf(ValidationError);
    await ctx.close();
  });
});
