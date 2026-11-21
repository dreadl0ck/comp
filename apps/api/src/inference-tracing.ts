import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { TelemetrySettings } from 'ai';

let provider: NodeTracerProvider | undefined;

export async function initTracing(): Promise<void> {
  if (provider) return;
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    process.env.CATALYST_OTLP_ENDPOINT;
  if (!endpoint) return;

  try {
    const url = new URL(endpoint);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new Error('A secure collector endpoint is required');
    }
    const token = process.env.CATALYST_OTLP_TOKEN;
    const exporter = new OTLPTraceExporter({
      url: url.toString(),
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    provider = new NodeTracerProvider({
      resource: resourceFromAttributes({ 'service.name': 'compai-api' }),
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });
    provider.register();
  } catch {
    provider = undefined;
    console.warn(
      'Optional tracing is disabled: invalid collector configuration',
    );
  }
}

export async function shutdownTracing(): Promise<void> {
  const active = provider;
  provider = undefined;
  await active?.shutdown();
}

export function getAITelemetry(
  functionId: string,
): TelemetrySettings | undefined {
  if (!provider) return undefined;
  return {
    isEnabled: true,
    functionId,
    tracer: provider.getTracer('compai-api'),
    recordInputs: false,
    recordOutputs: false,
  };
}
