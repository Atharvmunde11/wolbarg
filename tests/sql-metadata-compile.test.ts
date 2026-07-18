/**
 * Unit tests for MetadataFilter → SQLite json_extract compilation.
 */

import { describe, expect, it } from "vitest";
import { compileMetadataFilterToSql } from "../src/filters/sql-compile.js";
import { meta } from "../src/filters/types.js";

describe("compileMetadataFilterToSql", () => {
  it("compiles eq on a simple field", () => {
    const compiled = compileMetadataFilterToSql(meta.eq("project", "alpha"));
    expect(compiled).not.toBeNull();
    expect(compiled!.expression).toContain("json_extract(metadata_json, '$.project')");
    expect(compiled!.params).toEqual(["alpha"]);
  });

  it("compiles nested field paths", () => {
    const compiled = compileMetadataFilterToSql(meta.eq("a.b", 1));
    expect(compiled!.expression).toContain("$.a.b");
    expect(compiled!.params).toEqual([1]);
  });

  it("compiles and/or/not trees", () => {
    const compiled = compileMetadataFilterToSql(
      meta.and(meta.eq("project", "alpha"), meta.gt("priority", 1)),
    );
    expect(compiled!.expression).toContain(" AND ");
    expect(compiled!.params).toEqual(["alpha", 1]);
  });

  it("rejects unsafe field names", () => {
    expect(
      compileMetadataFilterToSql({
        field: "project'; DROP TABLE memories;--",
        op: { eq: "x" },
      }),
    ).toBeNull();
  });

  it("rejects object equality (fallback to JS)", () => {
    expect(
      compileMetadataFilterToSql(meta.eq("meta", { nested: true })),
    ).toBeNull();
  });
});
