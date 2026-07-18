/**
 * SQLite multi-writer concurrency defaults and validation.
 */

import { ConfigurationError } from "../../errors/index.js";

export interface ConcurrencyConfig {
  /** Max retry attempts after SQLITE_BUSY. Default: 5 */
  maxRetries?: number;
  /** Base backoff in ms before jitter. Default: 50 */
  baseBackoffMs?: number;
  /** Cap on backoff delay in ms. Default: 2000 */
  maxBackoffMs?: number;
  /** SQLite busy_timeout pragma in ms. Default: 5000 */
  lockTimeoutMs?: number;
}

export interface ResolvedConcurrencyConfig {
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  lockTimeoutMs: number;
}

export const DEFAULT_CONCURRENCY: ResolvedConcurrencyConfig = {
  maxRetries: 5,
  baseBackoffMs: 50,
  maxBackoffMs: 2000,
  lockTimeoutMs: 5000,
};

export function resolveConcurrencyConfig(
  input?: ConcurrencyConfig,
): ResolvedConcurrencyConfig {
  const resolved: ResolvedConcurrencyConfig = {
    maxRetries: input?.maxRetries ?? DEFAULT_CONCURRENCY.maxRetries,
    baseBackoffMs: input?.baseBackoffMs ?? DEFAULT_CONCURRENCY.baseBackoffMs,
    maxBackoffMs: input?.maxBackoffMs ?? DEFAULT_CONCURRENCY.maxBackoffMs,
    lockTimeoutMs: input?.lockTimeoutMs ?? DEFAULT_CONCURRENCY.lockTimeoutMs,
  };

  assertPositiveInt(resolved.maxRetries, "concurrency.maxRetries");
  assertPositiveNumber(resolved.baseBackoffMs, "concurrency.baseBackoffMs");
  assertPositiveNumber(resolved.maxBackoffMs, "concurrency.maxBackoffMs");
  assertPositiveInt(resolved.lockTimeoutMs, "concurrency.lockTimeoutMs");

  if (resolved.maxBackoffMs < resolved.baseBackoffMs) {
    throw new ConfigurationError(
      "concurrency.maxBackoffMs must be >= concurrency.baseBackoffMs",
    );
  }

  return resolved;
}

function assertPositiveInt(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ConfigurationError(`${field} must be a non-negative integer`);
  }
}

function assertPositiveNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ConfigurationError(`${field} must be a non-negative number`);
  }
}
