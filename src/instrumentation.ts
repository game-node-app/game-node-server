import { NodeSDK } from "@opentelemetry/sdk-node";
import {
    BatchSpanProcessor,
    ConsoleSpanExporter,
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import {
    ATTR_SERVICE_NAME,
    SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";

const isProduction = process.env.NODE_ENV === "production";
const useDebugExporter = process.env.OTEL_DEBUG_EXPORTER === "true";

// Configure trace exporter - use console for development debugging
const debugExporter = new ConsoleSpanExporter();
const traceExporter = !useDebugExporter
    ? new OTLPTraceExporter({
          url:
              process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
              "http://localhost:4318/v1/traces",
      })
    : debugExporter;

// Production-optimized configuration
const sdk = new NodeSDK({
    // Sample 10% of traces in production, 100% in development
    sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(isProduction ? 0.1 : 1.0),
    }),

    // Batch export for better performance
    spanProcessor: new BatchSpanProcessor(traceExporter, {
        maxExportBatchSize: isProduction ? 200 : 50,
        exportTimeoutMillis: isProduction ? 5000 : 2000,
        scheduledDelayMillis: isProduction ? 2000 : 1000,
    }),

    resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "game-node-server",
        [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
    }),

    instrumentations: [
        getNodeAutoInstrumentations({
            // Disable high-volume instrumentation in production
            "@opentelemetry/instrumentation-fs": { enabled: false },
            "@opentelemetry/instrumentation-dns": { enabled: false },
            "@opentelemetry/instrumentation-http": {
                enabled: true,
                ignoreIncomingRequestHook: (req) => {
                    const ignorePaths = ["/health", "/metrics", "/favicon.ico"];
                    return ignorePaths.some((path) => req.url?.includes(path));
                },
            },
        }),
    ],
});

process.on("SIGTERM", async () => {
    await sdk.shutdown();
    process.exit(0);
});
process.on("SIGINT", async () => {
    await sdk.shutdown();
    process.exit(0);
});

export default sdk;
