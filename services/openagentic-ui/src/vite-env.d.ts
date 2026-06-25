/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_ENABLE_CHAIN_OF_THOUGHT?: string

  // Build-time feature flags
  readonly VITE_FEATURE_OLLAMA?: string
  readonly VITE_FEATURE_MULTIMODEL?: string
  // 2026-04-19 — VITE_FEATURE_SLIDER removed (task #144, slider rip).
  readonly VITE_FEATURE_MCP?: string

  // Onboarding control
  readonly VITE_DISABLE_ONBOARDING?: string

  // Kubernetes namespace the platform is deployed into — scopes the
  // admin MCP Kubernetes view's kube_* PromQL. Default "openagentic".
  readonly VITE_K8S_NAMESPACE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
