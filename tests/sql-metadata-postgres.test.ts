import { describe, expect, it } from "vitest";
import { compileMetadataFilterToPostgres } from "../src/filters/sql-compile-postgres.js";
import { meta } from "../src/filters/types.js";

describe("compileMetadataFilterToPostgres", () => {
  it("compiles eq as jsonb containment", () => {
    const compiled = compileMetadataFilterToPostgres(meta.eq("topic", "ops"), 2);
    expect(compiled).not.toBeNull();
    expect(compiled!.expression).toContain("metadata_json @>");
    expect(compiled!.expression).toContain("$2");
    expect(compiled!.params[0]).toBe(JSON.stringify({ topic: "ops" }));
  });

  it("compiles and/or with rising param indexes", () => {
    const compiled = compileMetadataFilterToPostgres(
      meta.and(meta.eq("a", 1), meta.eq("b", "x")),
      2,
    );
    expect(compiled).not.toBeNull();
    expect(compiled!.params).toHaveLength(2);
    expect(compiled!.expression).toMatch(/\$2/);
    expect(compiled!.expression).toMatch(/\$3/);
  });

  it("compiles numeric comparisons", () => {
    const compiled = compileMetadataFilterToPostgres(meta.gte("score", 0.5), 1);
    expect(compiled).not.toBeNull();
    expect(compiled!.expression).toContain("::numeric");
    expect(compiled!.params).toEqual([0.5]);
  });
});
