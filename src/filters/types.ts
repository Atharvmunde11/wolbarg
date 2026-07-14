/**
 * Metadata filter AST for advanced recall filtering.
 */

/** Comparison operators on a single metadata field. */
export type MetadataComparison =
  | { eq: unknown }
  | { contains: string }
  | { gt: number | string }
  | { gte: number | string }
  | { lt: number | string }
  | { lte: number | string }
  | { between: [number | string, number | string] };

/** Recursive metadata filter supporting boolean combinators. */
export type MetadataFilter =
  | { field: string; op: MetadataComparison }
  | { and: MetadataFilter[] }
  | { or: MetadataFilter[] }
  | { not: MetadataFilter };

/** Helpers for building filters fluently. */
export const meta = {
  eq: (field: string, value: unknown): MetadataFilter => ({
    field,
    op: { eq: value },
  }),
  contains: (field: string, value: string): MetadataFilter => ({
    field,
    op: { contains: value },
  }),
  gt: (field: string, value: number | string): MetadataFilter => ({
    field,
    op: { gt: value },
  }),
  gte: (field: string, value: number | string): MetadataFilter => ({
    field,
    op: { gte: value },
  }),
  lt: (field: string, value: number | string): MetadataFilter => ({
    field,
    op: { lt: value },
  }),
  lte: (field: string, value: number | string): MetadataFilter => ({
    field,
    op: { lte: value },
  }),
  between: (
    field: string,
    lo: number | string,
    hi: number | string,
  ): MetadataFilter => ({
    field,
    op: { between: [lo, hi] },
  }),
  and: (...filters: MetadataFilter[]): MetadataFilter => ({ and: filters }),
  or: (...filters: MetadataFilter[]): MetadataFilter => ({ or: filters }),
  not: (filter: MetadataFilter): MetadataFilter => ({ not: filter }),
};
