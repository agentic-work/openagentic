

"""
OpenTelemetry Setup for OAT Executor

Configures tracing, metrics, and log correlation for full observability.
"""

import os
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.semconv.resource import ResourceAttributes

# Metrics
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter

def setup_telemetry():
    """Initialize OpenTelemetry with OTLP exporters."""

    service_name = os.environ.get("OTEL_SERVICE_NAME", "openagentic-synth")
    otlp_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")

    # Resource attributes
    resource = Resource.create({
        ResourceAttributes.SERVICE_NAME: service_name,
        ResourceAttributes.SERVICE_VERSION: "1.0.0",
        ResourceAttributes.DEPLOYMENT_ENVIRONMENT: os.environ.get("ENVIRONMENT", "development"),
        "oat.executor.instance": os.environ.get("HOSTNAME", "unknown"),
    })

    # === Tracing ===
    trace_provider = TracerProvider(resource=resource)

    # Only add exporter if endpoint is configured
    if otlp_endpoint and otlp_endpoint != "disabled":
        try:
            otlp_trace_exporter = OTLPSpanExporter(
                endpoint=otlp_endpoint,
                insecure=True,
            )
            trace_provider.add_span_processor(BatchSpanProcessor(otlp_trace_exporter))
        except Exception as e:
            print(f"Warning: Could not configure OTLP trace exporter: {e}")

    trace.set_tracer_provider(trace_provider)

    # === Metrics ===
    if otlp_endpoint and otlp_endpoint != "disabled":
        try:
            otlp_metric_exporter = OTLPMetricExporter(
                endpoint=otlp_endpoint,
                insecure=True,
            )
            metric_reader = PeriodicExportingMetricReader(
                otlp_metric_exporter,
                export_interval_millis=30000,
            )
            meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
            metrics.set_meter_provider(meter_provider)
        except Exception as e:
            print(f"Warning: Could not configure OTLP metric exporter: {e}")

    return trace.get_tracer(__name__)

# Global tracer instance
tracer = trace.get_tracer(__name__)

# Global meter instance
meter = metrics.get_meter(__name__)

# Metrics definitions
execution_counter = meter.create_counter(
    "oat.executions.total",
    description="Total number of OAT code executions",
    unit="1",
)

execution_duration = meter.create_histogram(
    "oat.execution.duration",
    description="Duration of OAT code executions",
    unit="ms",
)

execution_errors = meter.create_counter(
    "oat.executions.errors",
    description="Number of failed OAT executions",
    unit="1",
)

active_executions = meter.create_up_down_counter(
    "oat.executions.active",
    description="Number of currently running executions",
    unit="1",
)

memory_usage = meter.create_histogram(
    "oat.execution.memory",
    description="Memory used by executions",
    unit="bytes",
)
