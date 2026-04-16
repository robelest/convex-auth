/**
 * Thin wrapper around `@opentelemetry/api` tracing.
 *
 * @module
 */

import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";

const tracer = trace.getTracer("convex-auth");

/**
 * Run `fn` inside an OpenTelemetry span.
 *
 * If `fn` throws, the span is marked as errored and the exception is
 * recorded before re-throwing.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn();
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Synchronous version of {@link withSpan} for non-async operations.
 */
export function withSpanSync<T>(
  name: string,
  attributes: Attributes,
  fn: () => T,
): T {
  return tracer.startActiveSpan(name, { attributes }, (span) => {
    try {
      const result = fn();
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}
