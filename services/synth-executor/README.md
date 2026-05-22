# Synth Executor

Secure, minimal Python execution environment for Synth (formerly "Synth / On-demand Agent Tooling").

## Overview

The Synth Executor runs synthesized Python code in isolated subprocesses with:

- **Resource limits** - Memory and CPU time constraints
- **No shell access** - Direct Python execution only
- **Code validation** - Blocked modules and dangerous operations
- **Full audit logging** - Every execution is logged with context
- **OpenTelemetry** - Traces and metrics for observability
- **Horizontal scaling** - HPA scales based on load

## Architecture

```
┌─────────────────────┐     ┌─────────────────────────────────────┐
│  openagentic-api    │────▶│  synth-executor (K8s Deployment)      │
│  (SynthService)       │     │                                     │
└─────────────────────┘     │  ┌─────────────────────────────┐    │
                            │  │  FastAPI Server (port 8090)  │    │
                            │  │                              │    │
                            │  │  POST /execute               │    │
                            │  │    └─▶ Subprocess execution  │    │
                            │  │        - Resource limits     │    │
                            │  │        - Timeout             │    │
                            │  │        - Code validation     │    │
                            │  └─────────────────────────────┘    │
                            │                                     │
                            │  Replicas: 2-20 (HPA managed)       │
                            └─────────────────────────────────────┘
```

## Security Features

### Code Validation

Before execution, code is validated to block:

- `subprocess`, `os.system`, `os.popen` - Shell access
- `exec`, `eval`, `compile` - Dynamic code execution
- `ctypes`, `cffi` - Native code access
- `pickle`, `marshal` - Deserialization attacks
- File access outside `/tmp`

### Resource Limits

Each execution has:

| Resource | Default | Max |
|----------|---------|-----|
| Memory | 256 MB | 1 GB |
| CPU Time | 30s | 300s |
| Open Files | 64 | 64 |
| Processes | 0 | 0 |

### Network Isolation

NetworkPolicy restricts:

- **Ingress**: Only from `openagentic-api` pods
- **Egress**: Only HTTPS to external APIs + OTEL collector

### Container Security

- Distroless base image (no shell)
- Non-root user (65532)
- Read-only filesystem
- No privilege escalation
- Dropped all capabilities

## API

### POST /execute

Execute Python code.

**Request:**
```json
{
  "execution_id": "uuid",
  "code": "print('hello')",
  "intent": "Say hello",
  "user_id": "user-123",
  "user_email": "user@example.com",
  "timeout_seconds": 30,
  "max_memory_mb": 256,
  "credentials": {
    "AWS_ACCESS_KEY_ID": "...",
    "AWS_SECRET_ACCESS_KEY": "..."
  },
  "capabilities": ["http", "json", "datetime"]
}
```

**Response:**
```json
{
  "execution_id": "uuid",
  "success": true,
  "stdout": "hello",
  "stderr": null,
  "result": null,
  "error": null,
  "execution_time_ms": 42,
  "memory_used_bytes": 12345678,
  "code_hash": "abc123...",
  "started_at": "2026-02-12T10:00:00Z",
  "completed_at": "2026-02-12T10:00:00Z"
}
```

### GET /health

Health check for K8s probes.

### GET /ready

Readiness check - returns 503 if at capacity.

### GET /metrics

Current executor metrics.

## Capabilities

Capabilities determine which Python modules are allowed:

| Capability | Allowed Modules |
|------------|-----------------|
| `http` | requests, httpx, urllib, aiohttp |
| `json` | json, orjson, ujson |
| `datetime` | datetime, time, calendar, dateutil |
| `aws` | boto3, botocore |
| `azure` | azure.* |
| `gcp` | google.cloud.*, googleapiclient |
| `github` | github, PyGithub |

Always allowed: math, re, collections, itertools, base64, hashlib, etc.

## Building

```bash
# Build with distroless (most secure)
docker build -t synth-executor:latest .

# Build with slim (if distroless doesn't work)
docker build -f Dockerfile.slim -t synth-executor:latest .

# Push to registry
docker tag synth-executor:latest harbor.agenticwork.io/openagentic/synth-executor:latest
docker push harbor.agenticwork.io/openagentic/synth-executor:latest
```

## Deploying

```bash
# Apply K8s manifests
kubectl apply -f k8s/deployment.yaml -n openagentic

# Or via Helm (add to main values.yaml)
# See k8s/helm-values.yaml for configuration

# Check status
kubectl get pods -l app=synth-executor -n openagentic
kubectl get hpa synth-executor-hpa -n openagentic
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNTH_EXECUTOR_PORT` | 8090 | Server port |
| `SYNTH_MAX_EXECUTION_TIME` | 30 | Default timeout (seconds) |
| `SYNTH_MAX_MEMORY_MB` | 256 | Default memory limit |
| `SYNTH_MAX_CONCURRENT` | 5 | Max concurrent executions per pod |
| `SYNTH_LOG_LEVEL` | INFO | Log level |
| `OTEL_SERVICE_NAME` | synth-executor | OTEL service name |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | - | OTEL collector endpoint |

## Monitoring

### Metrics (via OTEL)

- `oat.executions.total` - Total executions (by capability)
- `oat.execution.duration` - Execution duration histogram
- `oat.executions.errors` - Failed executions (by error type)
- `oat.executions.active` - Currently running executions
- `oat.execution.memory` - Memory usage histogram

### Logs

All logs are structured JSON with:

- `execution_id` - Unique execution identifier
- `user_id` - User who initiated
- `trace_id` / `span_id` - OTEL correlation
- `code_hash` - SHA256 of executed code
- `intent` - Original user intent

## Scaling

HPA configuration:

- **Min replicas**: 2 (for availability)
- **Max replicas**: 20
- **Scale up**: At 70% CPU or 80% memory
- **Scale down**: After 5 minutes of low usage

## Troubleshooting

### Execution timing out

1. Check if code has infinite loops
2. Increase `timeout_seconds` if legitimate long operation
3. Check pod resources with `kubectl top pods`

### Out of memory errors

1. Increase `max_memory_mb` (up to 1024)
2. Check for memory leaks in synthesized code
3. Consider breaking into smaller operations

### Network errors

1. Verify NetworkPolicy allows egress to target
2. Check DNS resolution
3. Verify `http` capability is included

### Pod not scaling

1. Check HPA status: `kubectl describe hpa synth-executor-hpa`
2. Verify metrics-server is running
3. Check pod resource requests are set
