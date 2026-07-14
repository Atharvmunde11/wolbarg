/**
 * Memory compression — provider-based summarization.
 */

import type { LlmProvider } from "../llm/index.js";
import type { MemoryRecord } from "../types/index.js";
import { CompressionError } from "../errors/index.js";

const SYSTEM_PROMPT = `You are a memory compression engine for multi-agent systems.
Given related memories from a single agent, produce ONE concise summary that preserves:
- Key facts and decisions
- Important entities, numbers, and identifiers
- Actionable conclusions

Rules:
- Output plain text only (no markdown headings, no bullet lists unless essential)
- Do not invent facts that are not present
- Prefer precision over verbosity
- Keep the summary self-contained`;

/** Contract for memory compression backends. */
export interface CompressionProvider {
  readonly name: string;
  compress(memories: MemoryRecord[]): Promise<string>;
}

/** Default compression provider wrapping an {@link LlmProvider}. */
export class LlmCompressionProvider implements CompressionProvider {
  readonly name = "llm";
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  async compress(memories: MemoryRecord[]): Promise<string> {
    return compressMemories(this.llm, memories);
  }
}

export async function compressMemories(
  llm: LlmProvider,
  memories: MemoryRecord[],
): Promise<string> {
  if (memories.length === 0) {
    throw new CompressionError("No memories available to compress");
  }

  const payload = memories
    .map((memory, index) => {
      const meta =
        Object.keys(memory.metadata).length > 0
          ? `\nMetadata: ${JSON.stringify(memory.metadata)}`
          : "";
      return `[${index + 1}] (id=${memory.id}, created=${memory.createdAt.toISOString()})${meta}\n${memory.content.text}`;
    })
    .join("\n\n");

  try {
    return await llm.complete([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Compress the following ${memories.length} memories into a single concise summary:\n\n${payload}`,
      },
    ]);
  } catch (error) {
    if (error instanceof CompressionError) {
      throw error;
    }
    throw new CompressionError(
      `Compression failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export function createCompressionProvider(
  llm: LlmProvider,
): CompressionProvider {
  return new LlmCompressionProvider(llm);
}
