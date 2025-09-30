import { useEffect, useMemo, useState } from 'react'
import Game from './Game'

type Lang = 'he' | 'en'

export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('eliko.lang') as Lang) || 'he')

  useEffect(() => { localStorage.setItem('eliko.lang', lang) }, [lang])

  const t = useMemo(() => {
    const he = {
      title: 'ELIKO',
      sub: '2025',
      mobile: 'נייד: גררו באצבע כדי לזוז • הקישו בצד ימין כדי לירות',
      desktop: 'מחשב: WASD / חצים • רווח לירי • P השהיה • M השתקה',
      HE: 'עברית', EN: 'English'
    }
    const en = {
      title: 'ELIKO',
      sub: '— Neo-Arcade 2025',
      mobile: 'Mobile: drag left to move • tap/hold right to fire',
      desktop: 'Desktop: WASD / Arrows • Space to fire • P pause • M mute',
      HE: 'עברית', EN: 'English'
    }
    return lang === 'he' ? he : en
  }, [lang])

  return (
    <div dir={lang === 'he' ? 'rtl' : 'ltr'} className="app">
      <header className="header">
        <h1 className="logo">
          {t.title} <span className="sub">{t.sub}</span>
        </h1>

        <nav className="lang" aria-label="language">
          <button
            className={`chip ${lang === 'he' ? 'active' : ''}`}
            onClick={() => setLang('he')}
            title="Hebrew"
          >{t.HE}</button>

          <button
            className={`chip ${lang === 'en' ? 'active' : ''}`}
            onClick={() => setLang('en')}
            title="English"
          >{t.EN}</button>
        </nav>
      </header>

      <main className="stage">
        {/* Game renders a <canvas className="canvas" id="game" /> */}
        <Game />
      </main>

      <footer className="footer" aria-hidden={true}>
        <p>{t.mobile}</p>
        <p className="dim">{t.desktop}</p>
      </footer>
    </div>
  )
}
