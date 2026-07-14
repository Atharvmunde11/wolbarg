/**
 * Optional vision provider — captions / descriptions / entities from images.
 */

export interface VisionResult {
  caption: string;
  description: string;
  entities: string[];
}

export interface VisionProvider {
  readonly name: string;
  analyze(image: Buffer, mimeType?: string): Promise<VisionResult>;
}

interface VisionHttpOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

class OpenAICompatibleVisionProvider implements VisionProvider {
  readonly name: string;
  private readonly options: VisionHttpOptions;

  constructor(options: VisionHttpOptions) {
    this.name = options.name;
    this.options = options;
  }

  async analyze(image: Buffer, mimeType = "image/png"): Promise<VisionResult> {
    const base = this.options.baseUrl.replace(/\/+$/, "");
    const url = `${base}/chat/completions`;
    const dataUrl = `data:${mimeType};base64,${image.toString("base64")}`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 60_000,
    );
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: 'Describe this image. Reply as JSON: {"caption":"...","description":"...","entities":["..."]}',
                },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          max_tokens: 512,
        }),
        signal: controller.signal,
      });
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content ?? "";
      return parseVisionJson(content);
    } catch {
      return { caption: "", description: "", entities: [] };
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseVisionJson(content: string): VisionResult {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      return { caption: content.trim(), description: content.trim(), entities: [] };
    }
    const parsed = JSON.parse(match[0]) as Partial<VisionResult>;
    return {
      caption: String(parsed.caption ?? ""),
      description: String(parsed.description ?? ""),
      entities: Array.isArray(parsed.entities)
        ? parsed.entities.map(String)
        : [],
    };
  } catch {
    return { caption: content.trim(), description: content.trim(), entities: [] };
  }
}

export function geminiVision(options: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}): VisionProvider {
  return new OpenAICompatibleVisionProvider({
    name: "gemini",
    baseUrl:
      options.baseUrl ??
      "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: options.apiKey,
    model: options.model ?? "gemini-2.0-flash",
    timeoutMs: options.timeoutMs,
  });
}

export function openaiVision(options: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}): VisionProvider {
  return new OpenAICompatibleVisionProvider({
    name: "openai-vision",
    baseUrl: options.baseUrl ?? "https://api.openai.com/v1",
    apiKey: options.apiKey,
    model: options.model ?? "gpt-4o-mini",
    timeoutMs: options.timeoutMs,
  });
}
