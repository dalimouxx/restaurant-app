import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Rend l'application installable sur téléphone et tablette.
import { enregistrerServiceWorker } from './lib/install'
enregistrerServiceWorker()
