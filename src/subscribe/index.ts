/**
 * Public subscribe() entry — backend dispatch by storage type.
 */

export type {
  MemoryChangeCallback,
  MemoryChangeEvent,
  SubscribableEvent,
  SubscribeBackend,
  SubscribeFilter,
  Unsubscribe,
} from "./types.js";

export { SqliteSubscribeEmitter } from "./sqlite-emitter.js";
export {
  PostgresSubscribeListener,
  createPostgresListenerFromPool,
  notifyMemoryChange,
  serializeNotifyPayload,
  parseNotifyPayload,
  WOLBARG_NOTIFY_CHANNEL,
} from "./postgres-listener.js";
