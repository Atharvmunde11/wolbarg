/**
 * Public subscribe() types for real-time memory change events.
 */

export type SubscribableEvent =
  | "remember"
  | "update"
  | "forget"
  | "compress"
  | "ingest"
  | "*";

export interface SubscribeFilter {
  organization: string;
  agent?: string;
  event?: SubscribableEvent | SubscribableEvent[];
}

export interface MemoryChangeEvent {
  event: Exclude<SubscribableEvent, "*">;
  organization: string;
  agent: string;
  memoryId: string | string[];
  timestamp: string;
  traceId?: string;
  sessionId?: string;
  /** Present when upsert path ran during remember/ingest. */
  upsertAction?: "created" | "updated" | "skipped";
}

export type MemoryChangeCallback = (event: MemoryChangeEvent) => void;

export type Unsubscribe = () => void;

export interface SubscribeBackend {
  subscribe(
    filter: SubscribeFilter,
    callback: MemoryChangeCallback,
  ): Unsubscribe;
  emit(event: MemoryChangeEvent): void;
  close(): Promise<void>;
}
