/**
 * Retry with jittered exponential backoff. Shared between server and client.
 *
 * Two jitter modes:
 * - **`additive`** (server default) — total delay = `base × 2^attempt + random(0, base × 2^attempt)`. Range: `[base × 2^attempt, 2 × base × 2^attempt]`.
 * - **`centered`** — total delay = `base × 2^attempt × (0.5 + random(0, 1))`. Range: `[0.5 × base × 2^attempt, 1.5 × base × 2^attempt]`.
 *
 * @module
 */

interface RetryOptions {
  /** Maximum number of retry attempts after the first try (default: 2). */
  maxRetries?: number;
  /** Base delay in milliseconds (default: 200). */
  baseMs?: number;
  /** Add random jitter to the delay (default: true). */
  jitter?: boolean;
  /** Jitter shape — see module docstring. Default: `"additive"`. */
  jitterMode?: "additive" | "centered";
  /** If provided, stop retrying as soon as it returns `false`. */
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Retry `fn` with exponential backoff until it succeeds or retries are
 * exhausted. On final failure the last error is re-thrown.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 2,
    baseMs = 200,
    jitter = true,
    jitterMode = "additive",
    shouldRetry,
  } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
      if (shouldRetry && !shouldRetry(error)) throw error;

      const base = baseMs * 2 ** attempt;
      let delay: number;
      if (!jitter) {
        delay = base;
      } else if (jitterMode === "centered") {
        delay = base * (0.5 + Math.random());
      } else {
        delay = base + Math.random() * base;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
