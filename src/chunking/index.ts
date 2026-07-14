/**
 * Chunking strategies for document ingestion.
 */

export interface Chunk {
  text: string;
  index: number;
}

export interface ChunkingOptions {
  chunkSize?: number;
  overlap?: number;
}

export interface ChunkingStrategy {
  readonly name: string;
  chunk(text: string, options?: ChunkingOptions): Chunk[];
}

function clampOptions(options?: ChunkingOptions): {
  chunkSize: number;
  overlap: number;
} {
  const chunkSize = Math.max(32, options?.chunkSize ?? 800);
  const overlap = Math.min(
    Math.max(0, options?.overlap ?? 100),
    Math.floor(chunkSize / 2),
  );
  return { chunkSize, overlap };
}

function windowChunks(
  pieces: string[],
  chunkSize: number,
  overlap: number,
  joiner: string,
): Chunk[] {
  if (pieces.length === 0) {
    return [];
  }
  const chunks: Chunk[] = [];
  let buf = "";
  let index = 0;

  const flush = (): void => {
    const trimmed = buf.trim();
    if (trimmed) {
      chunks.push({ text: trimmed, index });
      index += 1;
    }
  };

  for (const piece of pieces) {
    const candidate = buf ? `${buf}${joiner}${piece}` : piece;
    if (candidate.length <= chunkSize) {
      buf = candidate;
      continue;
    }
    flush();
    if (piece.length > chunkSize) {
      // Hard-split oversized piece
      let start = 0;
      while (start < piece.length) {
        const end = Math.min(start + chunkSize, piece.length);
        chunks.push({ text: piece.slice(start, end).trim(), index });
        index += 1;
        start = Math.max(end - overlap, end);
      }
      buf = "";
    } else {
      buf = piece;
    }
  }
  flush();

  if (overlap > 0 && chunks.length > 1) {
    // Rebuild with overlap by sliding on joined text for stability
    const full = pieces.join(joiner);
    return slidingWindow(full, chunkSize, overlap);
  }
  return chunks;
}

function slidingWindow(
  text: string,
  chunkSize: number,
  overlap: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const slice = text.slice(start, end).trim();
    if (slice) {
      chunks.push({ text: slice, index });
      index += 1;
    }
    if (end >= text.length) {
      break;
    }
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export class FixedChunkingStrategy implements ChunkingStrategy {
  readonly name = "fixed";
  chunk(text: string, options?: ChunkingOptions): Chunk[] {
    const { chunkSize, overlap } = clampOptions(options);
    return slidingWindow(text, chunkSize, overlap);
  }
}

export class SentenceChunkingStrategy implements ChunkingStrategy {
  readonly name = "sentence";
  chunk(text: string, options?: ChunkingOptions): Chunk[] {
    const { chunkSize, overlap } = clampOptions(options);
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return windowChunks(sentences, chunkSize, overlap, " ");
  }
}

export class ParagraphChunkingStrategy implements ChunkingStrategy {
  readonly name = "paragraph";
  chunk(text: string, options?: ChunkingOptions): Chunk[] {
    const { chunkSize, overlap } = clampOptions(options);
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    return windowChunks(paragraphs, chunkSize, overlap, "\n\n");
  }
}

export class MarkdownChunkingStrategy implements ChunkingStrategy {
  readonly name = "markdown";
  chunk(text: string, options?: ChunkingOptions): Chunk[] {
    const { chunkSize, overlap } = clampOptions(options);
    const sections = text
      .split(/(?=^#{1,6}\s)/m)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sections.length <= 1) {
      return new ParagraphChunkingStrategy().chunk(text, options);
    }
    return windowChunks(sections, chunkSize, overlap, "\n\n");
  }
}

export class HeadingChunkingStrategy implements ChunkingStrategy {
  readonly name = "heading";
  chunk(text: string, options?: ChunkingOptions): Chunk[] {
    return new MarkdownChunkingStrategy().chunk(text, options);
  }
}

export function createChunkingStrategy(
  name: "fixed" | "sentence" | "paragraph" | "markdown" | "heading" = "sentence",
): ChunkingStrategy {
  switch (name) {
    case "fixed":
      return new FixedChunkingStrategy();
    case "paragraph":
      return new ParagraphChunkingStrategy();
    case "markdown":
      return new MarkdownChunkingStrategy();
    case "heading":
      return new HeadingChunkingStrategy();
    case "sentence":
    default:
      return new SentenceChunkingStrategy();
  }
}

export function inferChunkingStrategy(text: string): ChunkingStrategy {
  if (/^#{1,6}\s/m.test(text)) {
    return new MarkdownChunkingStrategy();
  }
  return new SentenceChunkingStrategy();
}
