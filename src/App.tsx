// src/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import Game from "./Game";
import "./index.css";

type Lang = "he" | "en";
type ProgressCb = (
  xp: number,
  xpNeeded: number,
  level: number,
  didLevelUp: boolean
) => void;

const App: React.FC = () => {
  const [lang, setLang] = useState<Lang>(
    () => (localStorage.getItem("eliko.lang") as Lang) || "he"
  );

  useEffect(() => {
    localStorage.setItem("eliko.lang", lang);
  }, [lang]);

  // Progress coming from Game
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);
  const [xpNeeded, setXpNeeded] = useState(40);
  const xpPercent = Math.max(0, Math.min(100, (xp / xpNeeded) * 100));

  const t = useMemo(() => {
    const he = { title: "אליקו", level: (n: number) => `רמה ${n}`, he: "עברית", en: "English" };
    const en = { title: "ELIKO", level: (n: number) => `Level ${n}`, he: "עברית", en: "English" };
    return lang === "he" ? he : en;
  }, [lang]);

  const handleProgress: ProgressCb = (nextXp, nextXpNeeded, nextLevel) => {
    setXp(nextXp);
    setXpNeeded(nextXpNeeded);
    setLevel(nextLevel);
  };

  return (
    <div dir={lang === "he" ? "rtl" : "ltr"} className="app">
      <header className="header">
        <h1 className="logo">{t.title}</h1>
      </header>

      <main className="stage">
        {/* Only the imported Game component is used here */}
        <Game lang={lang} onProgress={handleProgress} />
      </main>

      <div className="progress-bars" aria-hidden={false}>
        <div className="xp-bar" title={lang === "he" ? "ניסיון" : "XP"}>
          <div className="fill" style={{ width: `${xpPercent}%` }} />
        </div>
        <div className="level-bar">
          <span>{t.level(level)}</span>
        </div>
      </div>

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
};

export default App;
