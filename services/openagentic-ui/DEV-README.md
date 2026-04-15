# UI Hot Reload Development Setup

## Quick Start (Fastest Method)

Run the UI locally with hot reload while backend services run in Docker:

```bash
# 1. Start backend services in Docker (from repo root)
docker compose up -d openagentic-api mcp-proxy redis postgres caddy

# 2. Run UI locally with hot reload (from this directory)
cd services/openagentic-ui
npm install
npm run dev
```

The UI will be available at http://localhost:3000 with instant hot module replacement (HMR).

## How It Works

- Vite dev server runs locally on port 3000
- API calls proxy to localhost:8080 (Caddy) → openagentic-api:8000
- Changes to `.tsx`, `.ts`, `.css` files reload instantly

## Environment Variables

Create a `.env.local` file in this directory for any overrides:

```bash
# Example: Point to a different API
VITE_API_BASE_URL=http://localhost:8000/api
```

## Debugging

Enable debug logging:

```bash
DEBUG_SSE=true DEBUG_THINKING=true npm run dev
```
