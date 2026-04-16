/**
 * Retry with jittered exponential backoff.
 *
 * @module
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 2). */
  maxRetries?: number;
  /** Base delay in milliseconds (default: 200). */
  baseMs?: number;
  /** Add random jitter to the delay (default: true). */
  jitter?: boolean;
}

/**
 * Retry `fn` with exponential backoff until it succeeds or retries are
 * exhausted. On final failure the last error is re-thrown.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 2, baseMs = 200, jitter = true } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = baseMs * 2 ** attempt;
        const jitterMs = jitter ? Math.random() * delay : 0;
        await new Promise((resolve) => setTimeout(resolve, delay + jitterMs));
      }
    }
  }
  throw lastError;
}
