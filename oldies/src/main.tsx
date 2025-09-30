import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// Prevent page scroll on space/arrow keys while the app is focused
const block = new Set(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'])
window.addEventListener('keydown', (e) => {
  if (block.has(e.code)) e.preventDefault()
})

// Fix 1px jumps on mobile by ensuring the root always fills dynamic viewport
function setRootSize() {
  const r = document.documentElement
  r.style.setProperty('--dvh', `${Math.max(1, window.innerHeight)}px`)
}
setRootSize()
addEventListener('resize', setRootSize, { passive: true })
addEventListener('orientationchange', setRootSize, { passive: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
