import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

describe("tracing bootstrap", () => {
    it.each([
        ["", "false", false],
        ["http://127.0.0.1:4318", "TRUE", false],
        ["http://127.0.0.1:4318", "false", true],
    ])("endpoint=%s disabled=%s", (endpoint, disabled, enabled) => {
        const script = String.raw`
            const assert = require('node:assert/strict');
            const { bullmqTelemetry } = require('./src/tracing');
            assert.equal(Boolean(bullmqTelemetry), ${enabled});
            if (!bullmqTelemetry) {
                assert.equal(process.listenerCount('SIGTERM'), 0);
            } else {
                const { context, trace, ROOT_CONTEXT, TraceFlags } = require('@opentelemetry/api');
                const { trace: queueTrace, SpanKind } = require('bullmq');
                const root = trace.getTracer('test').startSpan('root');
                assert.equal(root.isRecording(), true);
                root.end();
                async function check() {
                    for (const sampled of [true, false]) {
                        const parent = trace.wrapSpanContext({
                            traceId: '12345678901234567890123456789012',
                            spanId: '1234567890123456',
                            traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
                            isRemote: true,
                        });
                        await context.with(trace.setSpan(ROOT_CONTEXT, parent), () =>
                            queueTrace(bullmqTelemetry, SpanKind.PRODUCER, 'test', 'add', 'test',
                                async (span, metadata) => {
                                    assert.ok(JSON.parse(metadata).traceparent);
                                    await context.with(ROOT_CONTEXT, () =>
                                        queueTrace(bullmqTelemetry, SpanKind.CONSUMER, 'test', 'process', 'test',
                                            async () => {
                                                const active = trace.getSpan(context.active());
                                                await Promise.resolve();
                                                assert.equal(trace.getSpan(context.active()), active);
                                                assert.equal(active.spanContext().traceId, parent.spanContext().traceId);
                                                assert.equal(active.isRecording(), sampled);
                                            }, metadata));
                                }));
                    }
                    process.emit('SIGTERM');
                }
                check().catch(error => { console.error(error); process.exitCode = 1; });
            }
        `;

        expect(() =>
            execFileSync(
                process.execPath,
                ["-r", "ts-node/register/transpile-only", "-e", script],
                {
                    cwd: resolve(__dirname, ".."),
                    timeout: 15000,
                    stdio: "pipe",
                    env: {
                        ...process.env,
                        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
                        OTEL_SDK_DISABLED: disabled,
                        OTEL_TRACES_EXPORTER: "console",
                        OTEL_METRICS_EXPORTER: "none",
                        OTEL_LOGS_EXPORTER: "none",
                        OTEL_TRACES_SAMPLER: "parentbased_traceidratio",
                        OTEL_TRACES_SAMPLER_ARG: "1",
                        OTEL_NODE_ENABLED_INSTRUMENTATIONS: "mysql2",
                    },
                },
            ),
        ).not.toThrow();
    });
});
