

export BASE_URL="https://ai.openagentic.io"
export ADMIN_EMAIL="admin@openagentic.io"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD env var required}"

mkdir -p e2e/screenshots
npx playwright test e2e/comprehensive-features.spec.ts --project=chromium --reporter=list
