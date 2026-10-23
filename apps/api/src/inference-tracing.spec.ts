const exporter = jest.fn();
const register = jest.fn();
const shutdown = jest.fn().mockResolvedValue(undefined);
const tracer = {};
const getTracer = jest.fn().mockReturnValue(tracer);
const createProvider = jest.fn();
jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: function (config: unknown) {
    exporter(config);
  },
}));
jest.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: (attributes: unknown) => attributes,
}));
jest.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: class {},
}));
jest.mock('@opentelemetry/sdk-trace-node', () => ({
  NodeTracerProvider: function (config: unknown) {
    createProvider(config);
    return { register, shutdown, getTracer };
  },
}));
import * as tracing from './inference-tracing';

describe('first-party optional tracing', () => {
  const saved = { ...process.env };
  beforeEach(async () => {
    await tracing.shutdownTracing();
    jest.clearAllMocks();
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    delete process.env.CATALYST_OTLP_ENDPOINT;
    delete process.env.CATALYST_OTLP_TOKEN;
  });
  afterEach(async () => {
    await tracing.shutdownTracing();
    process.env = { ...saved };
  });

  it('is a no-op for the deployed unconfigured service', async () => {
    await tracing.initTracing();
    expect(tracing.getAITelemetry('fixture')).toBeUndefined();
    expect(exporter).not.toHaveBeenCalled();
  });
  it('does not invent an endpoint for a token', async () => {
    process.env.CATALYST_OTLP_TOKEN = 'fixture-token';
    await tracing.initTracing();
    expect(exporter).not.toHaveBeenCalled();
  });
  it('uses standard OTLP and excludes prompts and responses', async () => {
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
      'https://collector.example.test/v1/traces';
    process.env.CATALYST_OTLP_TOKEN = 'fixture-token';
    await tracing.initTracing();
    await tracing.initTracing();
    expect(exporter).toHaveBeenCalledWith({
      url: 'https://collector.example.test/v1/traces',
      headers: { Authorization: 'Bearer fixture-token' },
    });
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(tracing.getAITelemetry('fixture')).toEqual({
      isEnabled: true,
      functionId: 'fixture',
      tracer,
      recordInputs: false,
      recordOutputs: false,
    });
    await tracing.shutdownTracing();
    await tracing.shutdownTracing();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
  it('disables invalid optional configuration without stopping the API', async () => {
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
      'http://remote.example.test/v1/traces';
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(tracing.initTracing()).resolves.toBeUndefined();
    expect(exporter).not.toHaveBeenCalled();
    expect(tracing.getAITelemetry('fixture')).toBeUndefined();
    warning.mockRestore();
  });
});
