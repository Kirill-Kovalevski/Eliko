import { useEffect, useMemo, useState } from "react";
import Game from "./Game";
import "./index.css";

type Lang = "he" | "en";

export default function App() {
  const [lang, setLang] = useState<Lang>(
    () => (localStorage.getItem("eliko.lang") as Lang) || "he"
  );
  useEffect(() => {
    localStorage.setItem("eliko.lang", lang);
  }, [lang]);

  // Player progression shown in the app chrome (Game reports progress via callback)
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);
  const [xpNeeded, setXpNeeded] = useState(40); // initial matches Game default

  // % fill for the glowing bar
  const xpPercent = Math.max(0, Math.min(100, (xp / xpNeeded) * 100));

  // Ding on level up (App plays it so it's not tied to Game's audio)
  useEffect(() => {
    // whenever Game bumps level OR xpNeeded resets, we can optionally ding here too
  }, [level, xpNeeded]);

  const t = useMemo(() => {
    const he = {
      title: "אליקו",
      level: (n: number) => `רמה ${n}`,
      he: "עברית",
      en: "English",
    };
    const en = {
      title: "ELIKO",
      level: (n: number) => `Level ${n}`,
      he: "עברית",
      en: "English",
    };
    return lang === "he" ? he : en;
  }, [lang]);

  return (
    <div dir={lang === "he" ? "rtl" : "ltr"} className="app">
      {/* Glowing animated bilingual logo */}
      <header className="header">
        <h1 className="logo">{t.title}</h1>
      </header>

      {/* Centered game surface */}
      <main className="stage">
        {/* Progress UI (glowing XP bar + level badge) */}
<div className="progress-bars" aria-hidden={false}>
  <div className="xp-bar" title={lang === "he" ? "ניסיון" : "XP"}>
    <div className="fill" style={{ width: `${xpPercent}%` }} />
  </div>
  <div className="level-bar">
    <span>{(lang==='he' ? `רמה ${level}` : `Level ${level}`)}</span>
  </div>
</div>
        <Game
          lang={lang}
          // Game will call this every frame or on change:
          onProgress={(nextXp, nextXpNeeded, nextLevel, didLevelUp) => {
            setXp(nextXp);
            setXpNeeded(nextXpNeeded);
            setLevel(nextLevel);
            if (didLevelUp) {
              // short celebratory ding
              new Audio("/level-up.mp3").play().catch(() => {});
            }
          }}
        />
      </main>

      {/* Progress UI (glowing XP bar + level badge) */}
      <div className="progress-bars" aria-hidden={false}>
        <div className="xp-bar" title={lang === "he" ? "ניסיון" : "XP"}>
          <div className="fill" style={{ width: `${xpPercent}%` }} />
        </div>
        <div className="level-bar">
          <span>{t.level(level)}</span>
        </div>
      </div>

      {/* Language toggle */}
      <nav className="langbar" aria-label="language">
        <div className="langchips">
          <button
            onClick={() => setLang("en")}
            className={`chip ${lang === "en" ? "active" : ""}`}
          >
            {t.en}
          </button>
          <button
            onClick={() => setLang("he")}
            className={`chip ${lang === "he" ? "active" : ""}`}
          >
            {t.he}
          </button>
        </div>
      </nav>
    </div>
  );
}
