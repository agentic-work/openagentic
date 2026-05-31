import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import './index.css'
// Canonical openagentic theme — imported LAST so its !important aliases win
// over every other token file (matches https://openagentics.io exactly).
import './styles/openagentic-theme.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
