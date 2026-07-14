/**
 * Keyword / BM25 search providers.
 */

export interface KeywordSearchHit {
  memoryId: string;
  score: number;
}

export interface KeywordDocument {
  id: string;
  text: string;
}

/** Contract for keyword / lexical search. */
export interface KeywordSearchProvider {
  readonly name: string;
  search(
    query: string,
    documents: KeywordDocument[],
    topK: number,
  ): Promise<KeywordSearchHit[]>;
}

/** Simple in-memory BM25 (Okapi). */
export class Bm25KeywordSearchProvider implements KeywordSearchProvider {
  readonly name = "bm25";
  private readonly k1: number;
  private readonly b: number;

  constructor(options?: { k1?: number; b?: number }) {
    this.k1 = options?.k1 ?? 1.2;
    this.b = options?.b ?? 0.75;
  }

  async search(
    query: string,
    documents: KeywordDocument[],
    topK: number,
  ): Promise<KeywordSearchHit[]> {
    if (documents.length === 0 || topK <= 0) {
      return [];
    }

    const docs = documents.map((doc) => ({
      id: doc.id,
      tokens: tokenize(doc.text),
    }));
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const N = docs.length;
    const avgdl =
      docs.reduce((sum, d) => sum + d.tokens.length, 0) / Math.max(N, 1);

    const df = new Map<string, number>();
    for (const term of new Set(queryTokens)) {
      let count = 0;
      for (const doc of docs) {
        if (doc.tokens.includes(term)) {
          count += 1;
        }
      }
      df.set(term, count);
    }

    const scored = docs.map((doc) => {
      const tfMap = new Map<string, number>();
      for (const token of doc.tokens) {
        tfMap.set(token, (tfMap.get(token) ?? 0) + 1);
      }
      let score = 0;
      for (const term of queryTokens) {
        const tf = tfMap.get(term) ?? 0;
        if (tf === 0) {
          continue;
        }
        const n = df.get(term) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        const denom =
          tf + this.k1 * (1 - this.b + this.b * (doc.tokens.length / avgdl));
        score += idf * ((tf * (this.k1 + 1)) / denom);
      }
      return { memoryId: doc.id, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score > 0).slice(0, topK);
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

/** Factory for in-memory BM25 keyword search. */
export function bm25(options?: { k1?: number; b?: number }): KeywordSearchProvider {
  return new Bm25KeywordSearchProvider(options);
}
