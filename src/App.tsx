import { useEffect, useMemo, useState } from 'react'
import Game from './Game'
import './index.css'

type Lang = 'he' | 'en'

export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('eliko.lang') as Lang) || 'he')
  useEffect(() => { localStorage.setItem('eliko.lang', lang) }, [lang])

  const t = useMemo(() => {
    const he = { title:'ELIKO', sub:'— ניאו־ארקייד 2025', HE:'עברית', EN:'English' }
    const en = { title:'ELIKO', sub:'— Neo-Arcade 2025',  HE:'עברית', EN:'English' }
    return lang === 'he' ? he : en
  }, [lang])

  return (
    <div dir={lang === 'he' ? 'rtl' : 'ltr'} className="app">
      <header className="header">
        <h1 className="logo">
          {t.title} <span className="sub">{t.sub}</span>
        </h1>
      </header>

      <main className="stage">
        <Game />
      </main>

      {/* language toggle */}
      <nav
        className="langbar"
        aria-label="language"
      >
        <div className="langchips">
          <button
            onClick={()=>setLang('he')}
            className={`chip ${lang==='he' ? 'active' : ''}`}
          >{t.HE}</button>
          <button
            onClick={()=>setLang('en')}
            className={`chip ${lang==='en' ? 'active' : ''}`}
          >{t.EN}</button>
        </div>
      </nav>
    </div>
  )
}
