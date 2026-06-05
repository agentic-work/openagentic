// Runtime configuration - this file will be replaced at runtime by the entrypoint script
window.__CONFIG__ = {
  VITE_API_URL: "VITE_API_URL_PLACEHOLDER",
  // Login-path IdP placeholders (VITE_AAD_* / VITE_AZURE_* / *_LOGIN_ENABLED /
  // VITE_AUTH_PROVIDER) removed: identity providers are now a runtime, DB-driven
  // registry served by GET /api/auth/directories — no client-id is ever shipped
  // to the browser.
  VITE_API_KEY: "VITE_API_KEY_PLACEHOLDER",
  VITE_FRONTEND_SECRET: "VITE_FRONTEND_SECRET_PLACEHOLDER",
  VITE_SIGNING_SECRET: "VITE_SIGNING_SECRET_PLACEHOLDER",
  VITE_AUTH_MODE: "VITE_AUTH_MODE_PLACEHOLDER",
  VITE_MAINTENANCE_MODE: "VITE_MAINTENANCE_MODE_PLACEHOLDER",
  VITE_DEV_LOGIN_PAGE: "VITE_DEV_LOGIN_PAGE_PLACEHOLDER",
  VITE_FLOWISE_URL: "VITE_FLOWISE_URL_PLACEHOLDER"
};
