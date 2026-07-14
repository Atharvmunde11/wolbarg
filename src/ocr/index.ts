/**
 * Optional OCR provider — extract text from images.
 */

export interface OcrResult {
  text: string;
}

export interface OCRProvider {
  readonly name: string;
  recognize(image: Buffer, mimeType?: string): Promise<OcrResult>;
}

/**
 * Placeholder Tesseract adapter.
 * Requires optional peer packages (`tesseract.js`) when used.
 */
export function tesseract(): OCRProvider {
  return {
    name: "tesseract",
    async recognize(image: Buffer): Promise<OcrResult> {
      try {
        const mod = await import("tesseract.js" as string);
        const createWorker =
          (mod as { createWorker?: (lang: string) => Promise<{
            recognize: (img: Buffer) => Promise<{ data: { text: string } }>;
            terminate: () => Promise<void>;
          }> }).createWorker ??
          (mod as { default?: { createWorker: (lang: string) => Promise<{
            recognize: (img: Buffer) => Promise<{ data: { text: string } }>;
            terminate: () => Promise<void>;
          }> } }).default?.createWorker;
        if (!createWorker) {
          return { text: "" };
        }
        const worker = await createWorker("eng");
        try {
          const result = await worker.recognize(image);
          return { text: result.data.text.trim() };
        } finally {
          await worker.terminate();
        }
      } catch {
        return { text: "" };
      }
    },
  };
}
