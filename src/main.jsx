import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { installNativePathPicker } from './runtime/nativePaths.js'
import './styles.css'
import './enhancements.css'

installNativePathPicker()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
