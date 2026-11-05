import { IconContext } from '@phosphor-icons/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* duotone everywhere: solid outline + a soft tint of the same colour */}
    <IconContext.Provider value={{ weight: 'duotone', size: 18 }}>
      <App />
    </IconContext.Provider>
  </StrictMode>,
)
