# OpenAgenticCode Manager

Container lifecycle manager for OpenAgenticCode sandboxed development environments.

## Overview

This service manages Docker containers for per-user sandboxed coding environments. It provides:

- Container lifecycle management (create, monitor, cleanup)
- WebSocket terminal proxy for real TTY access
- Resource monitoring and enforcement
- Security isolation and command filtering
- Automatic idle timeout and cleanup

## Architecture

```
┌─────────────────────────────────────────┐
│   openagenticchat-api                   │
│   (creates sessions, executes code)     │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│   openagenticcode-manager               │
│   - Container lifecycle                 │
│   - WebSocket terminal proxy            │
│   - Resource monitoring                 │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│   Per-User Containers                   │
│   (openagentic/code-runner:latest)      │
│   - Isolated Linux environment          │
│   - No internet access                  │
│   - Resource limits enforced            │
└─────────────────────────────────────────┘
```

## API Endpoints

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "containers": 3
}
```

### `POST /containers`
Create a new container for a user.

**Request:**
```json
{
  "userId": "user-123",
  "workspacePath": "workspaces/user-123"  // optional
}
```

**Response:**
```json
{
  "containerId": "abc123...",
  "status": "created"  // or "existing"
}
```

### `GET /containers/:containerId`
Get container status.

**Response:**
```json
{
  "id": "abc123...",
  "status": "running",
  "running": true,
  "userId": "user-123",
  "createdAt": "2024-12-01T10:00:00Z",
  "lastActivity": "2024-12-01T10:05:00Z"
}
```

### `POST /containers/:containerId/exec`
Execute a command in the container.

**Request:**
```json
{
  "command": "ls -la",
  "workDir": "/workspace"  // optional
}
```

**Response:**
```json
{
  "stdout": "total 8\ndrwxr-xr-x ...",
  "stderr": "",
  "exitCode": 0
}
```

### `DELETE /containers/:containerId`
Remove a container.

**Response:**
```json
{
  "status": "removed"
}
```

### `WS /ws/terminal?containerId=XXX&token=YYY`
WebSocket connection for terminal access.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3050` | HTTP server port |
| `RUNNER_IMAGE` | `openagentic/code-runner:latest` | Container image to use |
| `MAX_CONTAINERS_PER_USER` | `2` | Max containers per user |
| `CONTAINER_IDLE_TIMEOUT` | `1800` | Idle timeout in seconds (30 min) |
| `CONTAINER_MAX_LIFETIME` | `14400` | Max lifetime in seconds (4 hours) |
| `MEMORY_LIMIT` | `2147483648` | Memory limit in bytes (2GB) |
| `CPU_LIMIT` | `1.0` | CPU cores limit |
| `MINIO_ENDPOINT` | `minio:9000` | MinIO endpoint for workspace sync |
| `MINIO_ACCESS_KEY` | - | MinIO access key |
| `MINIO_SECRET_KEY` | - | MinIO secret key |
| `API_ENDPOINT` | `http://openagenticchat-api:3000` | API endpoint for auth validation |

## Security

### Container Isolation

- Runs as non-root user (`coder`)
- All capabilities dropped, only essential ones added
- No new privileges allowed
- Network: Internal only (no internet access)
- No host filesystem access
- Tmpfs for `/tmp` with `noexec,nosuid`

### Command Filtering

Dangerous commands are blocked at the manager level:

- Package managers (`apt`, `yum`, etc.)
- Privilege escalation (`sudo`, `su`)
- System control (`systemctl`, `iptables`)
- Device access (`/dev/*`, `/proc/sys/*`)
- Pipe-to-shell patterns (`curl | sh`)

### Resource Limits

- Memory: 2GB default (configurable)
- CPU: 1 core default (configurable)
- Processes: 256 max
- Disk: Tmpfs only, 512MB for `/tmp`

## Monitoring

The resource monitor runs every minute and:

1. Checks for idle containers (no activity for > 30 min)
2. Checks for containers exceeding max lifetime (> 4 hours)
3. Checks for stopped/crashed containers
4. Removes containers that violate policies

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Start production server
npm start
```

## Docker Build

```bash
# Build the manager service
docker build -t openagentic/code-manager:latest .

# Run locally
docker run -p 3050:3050 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e MINIO_ACCESS_KEY=your-key \
  -e MINIO_SECRET_KEY=your-secret \
  openagentic/code-manager:latest
```

## Integration

This service is designed to work with:

- **openagenticchat-api**: Creates sessions and executes code
- **openagentic/code-runner**: Container image for user environments
- **MinIO**: Workspace persistence
- **Docker**: Container orchestration

## Troubleshooting

### Container won't start

```bash
# Check Docker socket permissions
ls -la /var/run/docker.sock

# Verify runner image exists
docker images | grep code-runner

# Check manager logs
docker logs openagenticcode-manager
```

### Terminal won't connect

- Ensure WebSocket upgrade is allowed in your reverse proxy
- Verify token is valid
- Check container is running: `GET /containers/:id`

### Network isolation not working

```bash
# Verify internal network exists
docker network ls | grep openagentic-internal

# Test from inside container
docker exec <container-id> ping google.com  # Should fail
docker exec <container-id> ping minio        # Should work
```

## License

Proprietary - OpenAgentic
