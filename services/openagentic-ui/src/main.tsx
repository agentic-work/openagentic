import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
// theme.css is THE source of truth (Tailwind v4 @theme SOT). Imported FIRST so
// it brings in `@import "tailwindcss"` (base+components+utilities) and the
// canonical @theme tokens before any legacy stylesheet — and so theme.css is
// authoritative for the dark/light + accent semantics. See
// docs/design/theme-sot-spec.md.
import './styles/theme.css'
import './index.css'
// Legacy canonical theme — kept during Phase 0 (its !important aliases share
// the same brand values as theme.css, so there is no conflict). Deleted in a
// later phase once call sites read the theme.css tokens directly.
import './styles/openagentic-theme.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
