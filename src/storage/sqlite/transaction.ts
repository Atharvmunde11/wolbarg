/**
 * BEGIN IMMEDIATE transactions with SQLITE_BUSY retry + jitter backoff.
 */

import type { DatabaseSync } from "node:sqlite";
import { StorageLockedError } from "../../errors/index.js";
import type { ResolvedConcurrencyConfig } from "./concurrency-config.js";

export function isSqliteBusyError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  return (
    lower.includes("database is locked") ||
    lower.includes("sqlite_busy") ||
    lower.includes("busy")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(
  attempt: number,
  config: ResolvedConcurrencyConfig,
): number {
  const exp = Math.min(
    config.maxBackoffMs,
    config.baseBackoffMs * 2 ** attempt,
  );
  const jitter = Math.random() * config.baseBackoffMs;
  return Math.min(config.maxBackoffMs, exp + jitter);
}

/**
 * Run `fn` inside BEGIN IMMEDIATE … COMMIT, retrying on SQLITE_BUSY.
 */
export function withImmediateTransactionSync<T>(
  db: DatabaseSync,
  config: ResolvedConcurrencyConfig,
  fn: () => T,
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void,
): T {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ignore rollback errors
        }
        throw error;
      }
    } catch (error) {
      lastError = error;
      const isBusy = isSqliteBusyError(error);
      if (!isBusy) {
        throw error;
      }
      if (attempt >= config.maxRetries) {
        break;
      }
      const delay = backoffDelay(attempt, config);
      onRetry?.(attempt + 1, delay, error);
      // Sync path: busy-wait is unavoidable for node:sqlite sync API.
      const end = Date.now() + delay;
      while (Date.now() < end) {
        /* spin */
      }
    }
  }
  throw new StorageLockedError(
    `SQLite write lock could not be acquired after ${config.maxRetries} retries`,
    {
      cause: lastError instanceof Error ? lastError : undefined,
      reason: "SQLITE_BUSY exhausted retries",
      suggestion:
        "Increase concurrency.maxRetries or concurrency.lockTimeoutMs, or consider the Postgres backend for high-concurrency multi-agent workloads.",
    },
  );
}

/**
 * Async variant — preferred when callers can await between retries.
 */
export async function withImmediateTransaction<T>(
  db: DatabaseSync,
  config: ResolvedConcurrencyConfig,
  fn: () => T | Promise<T>,
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ignore
        }
        throw error;
      }
    } catch (error) {
      lastError = error;
      const isBusy = isSqliteBusyError(error);
      if (!isBusy) {
        throw error;
      }
      if (attempt >= config.maxRetries) {
        break;
      }
      const delay = backoffDelay(attempt, config);
      onRetry?.(attempt + 1, delay, error);
      await sleep(delay);
    }
  }
  throw new StorageLockedError(
    `SQLite write lock could not be acquired after ${config.maxRetries} retries`,
    {
      cause: lastError instanceof Error ? lastError : undefined,
      reason: "SQLITE_BUSY exhausted retries",
      suggestion:
        "Increase concurrency.maxRetries or concurrency.lockTimeoutMs, or consider the Postgres backend for high-concurrency multi-agent workloads.",
    },
  );
}
