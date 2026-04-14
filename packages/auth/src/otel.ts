/**
 * OpenTelemetry integration helpers for Convex Auth.
 *
 * @module
 *
 * Convex Auth exposes tracing hooks through Effect spans, but it does not
 * automatically install OpenTelemetry exporters or boot a telemetry runtime for
 * consumers. The application using Convex Auth owns telemetry setup.
 *
 * Use the helpers in this module when you want Convex Auth spans to participate
 * in your app's existing OpenTelemetry pipeline.
 */

import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { MetricReader } from "@opentelemetry/sdk-metrics";
import type { SpanProcessor, TracerConfig } from "@opentelemetry/sdk-trace-base";
import type { Attributes } from "@opentelemetry/api";
import { Effect } from "effect";
import * as NodeSdk from "@effect/opentelemetry/NodeSdk";
import * as WebSdk from "@effect/opentelemetry/WebSdk";

/**
 * Consumer-provided telemetry configuration for Convex Auth spans.
 *
 * The host application decides the service name, exporters, processors, and
 * readers. Convex Auth only turns this configuration into an Effect layer.
 */
export type TelemetryConfig = {
  /** Service name reported to the telemetry backend. */
  serviceName: string;
  /** Optional service version reported alongside the service name. */
  serviceVersion?: string;
  /** Additional OpenTelemetry resource attributes to attach to all spans. */
  attributes?: Attributes;
  /** Span processor or processors used for tracing export. */
  spanProcessor?: SpanProcessor | ReadonlyArray<SpanProcessor>;
  /** Optional tracer configuration forwarded to the underlying SDK. */
  tracerConfig?: Omit<TracerConfig, "resource">;
  /** Metric reader or readers used for metrics export. */
  metricReader?: MetricReader | ReadonlyArray<MetricReader>;
  /** Log record processor or processors used for logs export. */
  logRecordProcessor?: LogRecordProcessor | ReadonlyArray<LogRecordProcessor>;
};

/**
 * Build a Node.js OpenTelemetry layer for an app using Convex Auth.
 *
 * Convex Auth does not install this layer automatically. Provide it from your
 * application runtime when you want server-side spans, metrics, or logs to be
 * exported.
 *
 * @param config - Telemetry configuration supplied by the host application.
 * @returns An Effect layer that installs the Node OpenTelemetry SDK.
 *
 * @example
 * ```ts
 * import { NodeRuntime } from "@effect/platform-node";
 * import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
 * import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
 * import { nodeTelemetry } from "@robelest/convex-auth/otel";
 * import { Effect } from "effect";
 *
 * const telemetry = nodeTelemetry({
 *   serviceName: "my-app",
 *   spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter()),
 * });
 *
 * Effect.log("ready").pipe(Effect.provide(telemetry), NodeRuntime.runMain);
 * ```
 */
export function nodeTelemetry(config: TelemetryConfig) {
  return NodeSdk.layer(
    Effect.sync(() => ({
      resource: {
        serviceName: config.serviceName,
        serviceVersion: config.serviceVersion,
        attributes: config.attributes,
      },
      spanProcessor: config.spanProcessor,
      tracerConfig: config.tracerConfig,
      metricReader: config.metricReader,
      logRecordProcessor: config.logRecordProcessor,
    })),
  );
}

/**
 * Build a browser OpenTelemetry layer for an app using Convex Auth.
 *
 * Convex Auth does not install this layer automatically. Provide it from your
 * browser runtime when you want client-side Convex Auth spans to be exported.
 *
 * @param config - Telemetry configuration supplied by the host application.
 * @returns An Effect layer that installs the browser OpenTelemetry SDK.
 *
 * @example
 * ```ts
 * import { browserTelemetry } from "@robelest/convex-auth/otel";
 *
 * const telemetry = browserTelemetry({
 *   serviceName: "my-web-app",
 *   attributes: { deployment: "production" },
 * });
 * ```
 */
export function browserTelemetry(config: TelemetryConfig) {
  return WebSdk.layer(
    Effect.sync(() => ({
      resource: {
        serviceName: config.serviceName,
        serviceVersion: config.serviceVersion,
        attributes: config.attributes,
      },
      spanProcessor: config.spanProcessor,
      tracerConfig: config.tracerConfig,
      metricReader: config.metricReader,
      logRecordProcessor: config.logRecordProcessor,
    })),
  );
}
