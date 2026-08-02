import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { installNativePathPicker } from './runtime/nativePaths.js'
import './styles.css'
import './enhancements.css'
import './phase2.css'
import './phase2-states.css'

installNativePathPicker()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
