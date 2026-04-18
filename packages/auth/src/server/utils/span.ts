/**
 * Thin wrapper around `@opentelemetry/api` tracing.
 *
 * @module
 */

import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";

const tracer = trace.getTracer("convex-auth");

const INVALID_TRACE_ID = "00000000000000000000000000000000";
const ACTIVE_CHECK_INTERVAL_MS = 5_000;
let cachedActiveAt = 0;
let cachedActive = false;

function isTracingActive(): boolean {
  const now = Date.now();
  if (now - cachedActiveAt < ACTIVE_CHECK_INTERVAL_MS) {
    return cachedActive;
  }
  const probe = tracer.startSpan("__convex-auth.probe");
  const active = probe.isRecording() || probe.spanContext().traceId !== INVALID_TRACE_ID;
  probe.end();
  cachedActive = active;
  cachedActiveAt = now;
  return active;
}

/**
 * Run `fn` inside an OpenTelemetry span.
 *
 * If `fn` throws, the span is marked as errored and the exception is
 * recorded before re-throwing.
 *
 * When no tracer provider is registered, this is a cheap passthrough that
 * skips span creation altogether.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isTracingActive()) {
    return fn();
  }
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
export function withSpanSync<T>(name: string, attributes: Attributes, fn: () => T): T {
  if (!isTracingActive()) {
    return fn();
  }
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
