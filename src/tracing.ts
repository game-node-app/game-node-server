import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { BullMQOtel } from "bullmq-otel";

export let bullmqTelemetry: BullMQOtel | undefined;

/**
 * OpenTelemetry bootstrap (traces, metrics and pino logs over OTLP). Must be imported before anything else.
 * Opt-in: does nothing unless OTEL_EXPORTER_OTLP_ENDPOINT is set. Sampling and the rest are
 * standard OTEL_* env vars, see docs/observability.md.
 */
if (
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT &&
    process.env.OTEL_SDK_DISABLED?.toLowerCase() !== "true"
) {
    // Allowlist keeps per-request overhead low (no fs/dns/net spans); override via env.
    process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS ??=
        "http,undici,express,nestjs-core,mysql2,redis,pino,runtime-node";

    const sdk = new NodeSDK({
        instrumentations: getNodeAutoInstrumentations({
            "@opentelemetry/instrumentation-http": {
                // Container healthcheck runs every 30s, its traces are noise.
                ignoreIncomingRequestHook: (req) =>
                    req.url?.startsWith("/v1/health") ?? false,
            },
            "@opentelemetry/instrumentation-mysql2": {
                maskStatement: true,
            },
            // Opt-in only: BullMQ's Lua commands add large, redundant spans inside job traces.
            "@opentelemetry/instrumentation-ioredis": {
                requireParentSpan: true,
                dbStatementSerializer: (command) => command,
            },
            "@opentelemetry/instrumentation-redis": {
                requireParentSpan: true,
            },
        }),
    });
    sdk.start();
    bullmqTelemetry = new BullMQOtel();
    // Flush buffered telemetry on deploys/restarts.
    process.once("SIGTERM", () => void sdk.shutdown());
}
