import React from 'react'
import Game from './Game'

export default function App() {
  return (
    <div dir="rtl" className="app neon">
      <header className="header glass">
        <h1 className="logo">
          ELIKO <span className="sub">— ניאו־ארקייד 2025</span>
        </h1>
      </header>

      <main className="stage">
        <Game />
      </main>

      <footer className="footer">
        <p>נייד: גררו באצבע כדי לזוז • הקישו בצד ימין כדי לירות</p>
        <p className="dim">מחשב: WASD / חצים לתנועה • רווח לירי • P השהיה • M השתקה</p>
      </footer>
    </div>
  )
}
