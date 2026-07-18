/**
 * Unit tests for Postgres NOTIFY payload helpers (no live Postgres required).
 */

import { describe, expect, it } from "vitest";
import {
  parseNotifyPayload,
  serializeNotifyPayload,
} from "../src/subscribe/postgres-listener.js";
import type { MemoryChangeEvent } from "../src/subscribe/types.js";

describe("v0.4 postgres notify payload", () => {
  it("round-trips a memory change event", () => {
    const event: MemoryChangeEvent = {
      event: "remember",
      organization: "org",
      agent: "agent",
      memoryId: "mem-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      traceId: "t1",
      sessionId: "s1",
      upsertAction: "created",
    };
    const raw = serializeNotifyPayload(event);
    expect(raw.length).toBeLessThan(8000);
    const parsed = parseNotifyPayload(raw);
    expect(parsed).toMatchObject({
      event: "remember",
      organization: "org",
      agent: "agent",
      memoryId: "mem-1",
      upsertAction: "created",
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parseNotifyPayload("not-json")).toBeNull();
  });
});
