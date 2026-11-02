# Observability

The server sends traces, metrics and logs over OTLP to the shared OpenObserve instance
(Coolify project "Shared Infrastructure", `https://observe.gamenode.app`). Setup lives in
`src/tracing.ts`, which is the first import of `main.ts`.

## Enabling

Set these on the `gamenode-server` Coolify application, then redeploy:

| Variable | Value |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://observe.gamenode.app/api/default` (empty = telemetry off) |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Basic <token>`. In OpenObserve: Data sources → Custom → OTEL Collector, copy the value after `Authorization: Basic`. |

Local dev and tests leave the endpoint unset, so the SDK and BullMQ telemetry stay off.

## What is collected

- **Traces:** incoming HTTP (Express + Nest handlers, with the exception on failed handlers),
  BullMQ enqueue/processing, MySQL queries, Redis calls, outgoing HTTP/fetch. `/v1/health` is ignored.
  BullMQ uses its [official telemetry adapter](https://docs.bullmq.io/guide/telemetry/getting-started)
  in the shared Nest configuration, so every registered queue and worker participates. Trace context
  and sampling decisions travel with jobs, connecting requests to background processing and its
  MySQL/HTTP calls. Scheduled jobs without a parent start their own sampled traces.
  Job failures appear as `job failed` events on processing spans.
- **MySQL:** query duration, database/server identity, and query text with literals masked;
  covers TypeORM and Better Auth's `mysql2/promise` pool. Bound values are not interpolated into
  captured query text, and result rows are not collected. SQL comments carrying trace context are
  left off, so queries sent to MySQL are unchanged.
- **Redis:** the `redis` client requires a parent span. `ioredis` (used by BullMQ and TypeORM's
  cache) is excluded by default: queue/job spans already describe the work, and tracing every Lua
  command adds volume and serialization overhead. If explicitly enabled, only command names are
  captured, with a parent span required; command arguments and job payloads are not serialized.
- **Logs:** every pino log line, tagged with `trace_id`/`span_id`. Still written to stdout too.
- **Metrics:** HTTP request duration/count and Node runtime (event loop delay, GC, heap), every 60s.

To trace a user report: search logs around the reported time (level `error`, user or route),
open the `trace_id` to see the full request.

## Performance knobs

All standard OpenTelemetry env vars; set them in Coolify, no code change needed.

| Variable | Effect |
|---|---|
| `OTEL_TRACES_SAMPLER_ARG` | With `OTEL_TRACES_SAMPLER=parentbased_traceidratio`, fraction of root traces kept, from `0` to `1`. Production Compose defaults to `1` (100%); evaluate volume and overhead before lowering it. Parent decisions are preserved across jobs. Outside Compose, set both variables explicitly; the SDK otherwise samples everything. |
| `OTEL_NODE_ENABLED_INSTRUMENTATIONS` | Override the auto-instrumentation allowlist in `src/tracing.ts`, e.g. drop `mysql2` or `runtime-node`, or add `ioredis` temporarily. BullMQ's native telemetry is separate from this list. |
| `OTEL_BSP_MAX_QUEUE_SIZE` / `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` | Bound buffered spans/export batches (SDK defaults `2048` / `512`). Exports are batched; when the queue fills, spans are dropped rather than blocking jobs. |
| `OTEL_METRIC_EXPORT_INTERVAL` | Metric export period in ms (default `60000`). |
| `OTEL_LOGS_EXPORTER=none` / `OTEL_METRICS_EXPORTER=none` | Turn off a signal. |
| `OTEL_SDK_DISABLED=true` | Turn everything off without removing the endpoint. |
| `OTEL_LOG_LEVEL=debug` | Print SDK diagnostics, for when nothing shows up in OpenObserve. |

Sampling only drops traces. Logs (with their `trace_id`) and HTTP metrics are independent,
so errors stay findable in logs even when their traces were not sampled. Keeping only failed
requests/jobs needs tail sampling in an OTel Collector. Sampling reduces recording/export work,
but instrumentation and SQL masking still have some cost, especially in query-heavy imports.

## Retention

7 days, set on the OpenObserve service with `ZO_COMPACT_DATA_RETENTION_ENABLED=true` and
`ZO_COMPACT_DATA_RETENTION_DAYS=7`. Per-stream overrides are in OpenObserve's stream settings.

## Limits

MySQL data here means client query traces, not server metrics such as slow-query logs, lock
waits, or buffer-pool utilization; those need separate MySQL monitoring. SQL masking is the
instrumentation's built-in literal masker; SQL comments and driver error messages can still contain sensitive data.
BullMQ's native spans can include job return values and failure messages; avoid returning secrets.
`bullmq-otel` is pinned to `1.3.0` to support the existing BullMQ 5 version without upgrading the queue engine.
