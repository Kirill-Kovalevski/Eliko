/* Game.tsx — desktop: arrows+space; phone: true dual-stick (left=move, right=aim+fire) */
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { Entity, PlayerState, WeaponId, PowerUpKind } from "./types";
import { clamp, lerp, rnd, id, aabb } from "./utils";
import { useInput } from "./useInput";
import { synth } from "./audio";
import { makeLevel, STAGE_LENGTH } from "./levels";

/* ===== tiny utils ===== */
const num = (v: any, d = 0) => (Number.isFinite(+v) ? +v : d);
const flag = (v: any) => v === true;
const text = (v: any, d = "") => (typeof v === "string" ? v : d);
const ensureData = <T extends { data?: Record<string, any> }>(o: T) =>
  (o.data ??= {} as Record<string, any>);
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/* ===== input mode detection ===== */
function detectMode(): "touch" | "desktop" {
  const coarse = typeof window !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const hasTouch = (navigator as any).maxTouchPoints > 0;
  const phoneSized =
    typeof window !== "undefined" &&
    window.innerWidth <= 430 &&
    Math.max(window.innerWidth, window.innerHeight) >= 780;
  return (coarse || hasTouch) && phoneSized ? "touch" : "desktop";
}

/* ===== types / constants ===== */
type EnemyKind = "jelly" | "squid" | "manta" | "nautilus" | "puffer" | "crab" | "siren";
type PU = Extract<PowerUpKind, "shield" | "speed" | "heal" | "weapon" | "drone" | "haste">;
type MythicPU = "barrier" | "twin" | "familiars";
type AnyPU = PU | MythicPU;

const WEAPON_TIER: Readonly<WeaponId[]> = [
  "blaster",
  "spread",
  "piercer",
  "laser",
  "rail",
  "orbitals",
  "nova",
] as const;

const GOOD_POOL: PU[] = ["shield", "speed", "heal", "weapon", "drone"];
const BAD_ONLY: PU[] = ["haste"];
const MYTHIC_POOL: MythicPU[] = ["barrier", "twin", "familiars"];

const PADDING = 14;
const BASE_R = 26;
const MAX_LIVES = 10;

/* ===== helpers ===== */
const asWeaponId = (x: unknown): WeaponId =>
  (WEAPON_TIER as readonly string[]).includes(String(x)) ? (x as WeaponId) : "blaster";
const asEnemyKind = (x: unknown): EnemyKind => {
  const bag = ["jelly", "squid", "manta", "nautilus", "puffer", "crab", "siren"];
  return (bag as readonly string[]).includes(String(x)) ? (x as EnemyKind) : "jelly";
};

/* ===== entities ===== */
function bullet(
  x: number,
  y: number,
  w: number,
  h: number,
  vx: number,
  vy: number,
  kind: WeaponId | string,
  data: Record<string, unknown> = {}
): Entity {
  return { id: id(), x, y, w, h, vx, vy, type: "bullet", data: { kind, ...data } } as any;
}
function spark(x: number, y: number, c: string, life = 26, sz = 3): Entity {
  return { id: id(), x, y, w: sz, h: sz, vx: rnd(-2, 2), vy: rnd(-2, 2), type: "spark", data: { life, color: c } } as any;
}
function explode(x: number, y: number, c: string, n = 16) {
  const out: Entity[] = [];
  for (let i = 0; i < n; i++) out.push(spark(x, y, c, 18 + Math.random() * 16, 2 + Math.random() * 2));
  return out;
}
function orbital(p: PlayerState, phase: number) {
  return bullet(p.x + 18, p.y, 8, 8, 7, 0, "orbitals", { orb: true, phase });
}
function novaFan(p: PlayerState, ang: number) {
  const out: Entity[] = [];
  for (let i = -3; i <= 3; i++) {
    const a = ang + i * 0.35;
    out.push(bullet(p.x + 12, p.y, 8, 8, Math.cos(a) * 7, Math.sin(a) * 7, "nova", { pierce: 2 }));
  }
  return out;
}
function enemy(kind: EnemyKind, x: number, y: number, speed: number, hp = 1, heavy = false): Entity {
  const sizes: Record<EnemyKind, { w: number; h: number }> = {
    jelly: { w: 40, h: 40 },
    squid: { w: 46, h: 52 },
    manta: { w: 68, h: 36 },
    nautilus: { w: 48, h: 48 },
    puffer: { w: 38, h: 38 },
    crab: { w: 52, h: 32 },
    siren: { w: 62, h: 36 },
  };
  const s = sizes[kind];
  return { id: id(), x, y, w: s.w, h: s.h, vx: -speed, vy: 0, type: "enemy", hp, data: { kind, t: 0, heavy, blink: 0 } } as any;
}
function boss(x: number, y: number, hp: number): Entity {
  return { id: id(), x, y, w: 220, h: 140, vx: -0.85, vy: 0, type: "boss", hp, data: { phase: 1, t: 0, aura: 1 } } as any;
}

/* ===== weapons (angle-aware) ===== */
type FireFn = (p: PlayerState, ang: number) => Entity[];
const WEAPONS: Record<WeaponId, { gap: number; sfx: () => void; onFire: FireFn }> = {
  blaster: { gap: 8, sfx: () => synth.shoot(), onFire: (p, ang) => [bullet(p.x + 18, p.y, 8, 4, Math.cos(ang) * 9, Math.sin(ang) * 9, "blaster")] },
  spread:  { gap: 13, sfx: () => synth.spread(), onFire: (p, ang) => [
    bullet(p.x + 18, p.y, 8, 4, Math.cos(ang - 0.22) * 7.1, Math.sin(ang - 0.22) * 7.1, "spread"),
    bullet(p.x + 18, p.y, 8, 4, Math.cos(ang) * 7.1,      Math.sin(ang) * 7.1,      "spread"),
    bullet(p.x + 18, p.y, 8, 4, Math.cos(ang + 0.22) * 7.1, Math.sin(ang + 0.22) * 7.1,"spread"),
  ]},
  piercer: { gap: 16, sfx: () => synth.pierce(), onFire: (p, ang) => [bullet(p.x + 20, p.y, 14, 5, Math.cos(ang) * 10, Math.sin(ang) * 10, "piercer", { pierce: 3 })] },
  laser:   { gap: 22, sfx: () => synth.laser(),  onFire: (p, ang) => [bullet(p.x + 26, p.y, 18, 6, Math.cos(ang) * 12, Math.sin(ang) * 12, "laser", { pierce: 6, dmg: 2 })] },
  rail:    { gap: 32, sfx: () => synth.rail(),   onFire: (p, ang) => [bullet(p.x + 24, p.y, 4, 72, Math.cos(ang) * 16, Math.sin(ang) * 16, "rail", { pierce: 8, dmg: 3 })] },
  orbitals:{ gap: 16, sfx: () => synth.shoot(),  onFire: (p) => [orbital(p, 0), orbital(p, Math.PI)] },
  nova:    { gap: 34, sfx: () => synth.nova(),   onFire: (p, ang) => novaFan(p, ang) },
};

 /* ===== main ===== */
 type ProgressCb = (xp: number, xpNeeded: number, level: number, leveledUp: boolean) => void;

export default function Game(
  { lang, onProgress }: { lang: "he" | "en"; onProgress?: ProgressCb }
): ReactElement {

    /* --- core refs/state --- */

  /* --- core refs/state --- */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const frame = useRef(0);
  const lastT = useRef(nowMs());

  const [paused, setPaused] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [mute, setMute] = useState(false);
  const [stage, setStage] = useState(1);
  const [bossActive, setBossActive] = useState(false);

  // desktop inputs (Arrows/WASD + Space)
  const { fire: kbFire, ax: kbAx, ay: kbAy } = useInput();

  const MODE = useRef<"touch" | "desktop">(detectMode());

  const W = useRef(760), H = useRef(980), dpr = useRef(1);
  const levelCfg = useRef(makeLevel(stage));
  const spawns = useRef(0);

  /* ========= New: robust dual-stick touch input (no hooks) ========= */
  type Stick = {
    id: number | null;
    active: boolean;
    ox: number; oy: number; // origin
    ax: number; ay: number; // normalized [-1..1]
    mag: number;            // 0..1
  };
  const left: Stick  = useRef<Stick>({ id: null, active: false, ox: 0, oy: 0, ax: 0, ay: 0, mag: 0 }).current;
  const right: Stick = useRef<Stick>({ id: null, active: false, ox: 0, oy: 0, ax: 0, ay: 0, mag: 0 }).current;

  const resetStick = (s: Stick) => { s.id = null; s.active = false; s.ax = s.ay = 0; s.mag = 0; };

  useEffect(() => {
    const c = canvasRef.current!;
    const zoneSplit = () => c.clientWidth * 0.5;      // left / right halves
    const DEAD = 8, RANGE = 60;                       // pixels
    const toLocal = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      const { x, y } = toLocal(e);
      if (x <= zoneSplit() && left.id === null) {
        left.id = e.pointerId; left.active = true; left.ox = x; left.oy = y; left.ax = left.ay = 0; left.mag = 0;
      } else if (x > zoneSplit() && right.id === null) {
        right.id = e.pointerId; right.active = true; right.ox = x; right.oy = y; right.ax = right.ay = 0; right.mag = 0;
      }
      // Prevent iOS scroll/zoom gestures
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      const { x, y } = toLocal(e);
      const upd = (s: Stick) => {
        const dx = x - s.ox, dy = y - s.oy;
        const len = Math.hypot(dx, dy);
        const clamped = Math.max(0, Math.min(1, (len - DEAD) / (RANGE - DEAD)));
        s.mag = s.active ? clamped : 0;
        if (s.mag > 0) {
          const nx = dx / (len || 1), ny = dy / (len || 1);
          s.ax = nx * s.mag; s.ay = ny * s.mag;
        } else {
          s.ax = s.ay = 0;
        }
      };
      if (e.pointerId === left.id && left.active)  upd(left);
      if (e.pointerId === right.id && right.active) upd(right);
      e.preventDefault();
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId === left.id)  resetStick(left);
      if (e.pointerId === right.id) resetStick(right);
      e.preventDefault();
    };

    c.addEventListener("pointerdown", onDown, { passive: false });
    c.addEventListener("pointermove", onMove,  { passive: false });
    c.addEventListener("pointerup",   onUp,    { passive: false });
    c.addEventListener("pointercancel", onUp,  { passive: false });
    return () => {
      c.removeEventListener("pointerdown", onDown as any);
      c.removeEventListener("pointermove",  onMove as any);
      c.removeEventListener("pointerup",    onUp as any);
      c.removeEventListener("pointercancel",onUp as any);
    };
  }, []);
  /* ================================================================= */

  // player + progression
  const player = useRef<PlayerState>({ x: 140, y: 360, vx: 0, vy: 0, maxSpeed: MODE.current === "touch" ? 6.6 : 9.0, radius: BASE_R, hp: 6, shieldMs: 0, weapon: "blaster" });
  const targetRadius = useRef(BASE_R);
  const weaponLevel = useRef(0);

  // XP / level
  const xp = useRef(0);
  const xpToNext = useRef(40);
  const playerLevel = useRef(1);
  const avatarHue = useRef(38);
  const xpGainPulse = useRef(0);
  const xpOrbsRef = useRef<Array<{id:number;x:number;y:number;vx:number;vy:number;life:number}>>([]);

  // world refs
  const bulletsRef = useRef<Entity[]>([]);
  const enemiesRef = useRef<Entity[]>([]);
  const powerupsRef = useRef<Array<{id:number;x:number;y:number;kind:AnyPU;payload?:WeaponId}>>([]);
  const bossRef = useRef<Entity | null>(null);
  const particlesRef = useRef<Entity[]>([]);
  const drones = useRef<{phase:number}[]>([]);
  const bubblesRef = useRef<{x:number;y:number;r:number;v:number}[]>([]);

  // timers
  const lastFire = useRef(0);
  const rapidMs = useRef(0);
  const hasteMs = useRef(0);
  const shake = useRef(0);
  const hitFlash = useRef(0);
  const dmgBounce = useRef(0);

  const enemiesKilled = useRef(0);
  const boostsCollected = useRef(0);

  // mythics
  const barrierMs = useRef(0);
  const twinMs = useRef(0);
  const helpersMs = useRef(0);
  const helpersRef  = useRef<Array<{id:number;x:number;y:number;phase:number}>>([]);
  const twinRef     = useRef<{x:number;y:number;phase:number}|null>(null);

  // auto-aim angle
  const aimAngle = useRef(0);

  /* ===== sizing ===== */
  useEffect(() => {
    const c = canvasRef.current!, ctx = c.getContext("2d")!;
    const onResize = () => {
      const maxW = 900;
      const w = Math.min(window.innerWidth - 24, maxW);
      const h = Math.min(window.innerHeight - (window.innerWidth < 640 ? 80 : 120), 1040);
      W.current = Math.max(520, Math.floor(w));
      H.current = Math.max(640, Math.floor(h));
      dpr.current = window.devicePixelRatio || 1;
      c.width  = Math.floor(W.current * dpr.current);
      c.height = Math.floor(H.current * dpr.current);
      ctx.setTransform(dpr.current, 0, 0, dpr.current, 0, 0);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ===== keyboard scroll prevention (desktop) + toggles ===== */
  useEffect(() => {
    const preventKeys = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown" || k === " " || k === "w" || k === "a" || k === "s" || k === "d") e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "p") setPaused(p => !p);
      if (k === "m") { setMute(m => !m); synth.mute(!mute); }
      if (gameOver && (k === " " || k === "enter")) softReset();
    };
    window.addEventListener("keydown", preventKeys, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", preventKeys as any);
      window.removeEventListener("keydown", onKey);
    };
  }, [mute, gameOver]);

  /* ===== loop ===== */
  useEffect(() => {
    const c = canvasRef.current!, ctx = c.getContext("2d")!;
    c.style.touchAction = "none";

    if (!bubblesRef.current.length) for (let i = 0; i < 56; i++) bubblesRef.current.push({ x: rnd(0, W.current), y: rnd(0, H.current), r: rnd(2, 6), v: rnd(0.35, 0.9) });

    const recalcTargetRadius = () => {
      const t = Math.max(1, player.current.hp) / MAX_LIVES;
      targetRadius.current = BASE_R * (0.32 + 0.68 * t);
    };

    const damagePlayer = (dmg = 1) => {
      if (player.current.shieldMs > 0) { if (!mute) synth.hit(); hitFlash.current = 8; return; }
      player.current.hp -= dmg; recalcTargetRadius(); dmgBounce.current = 1; hitFlash.current = 16; shake.current = 22;
      if (!mute) synth.hit();
      if (player.current.hp <= 0) {
        for (let i = 0; i < 120; i++) particlesRef.current.push(spark(player.current.x, player.current.y, i % 2 ? "#22d3ee" : "#a78bfa", 24 + rnd(0, 20), 2 + rnd(0, 3)));
        if (!mute) synth.nova();
        setGameOver(true);
      }
    };

    const loop = () => {
      let leveledUpThisFrame = false;
      rafRef.current = requestAnimationFrame(loop);

      const tNow = nowMs();
      const dt = Math.min(48, tNow - lastT.current) / 16.6667;
      lastT.current = tNow;

      if (paused || gameOver) { draw(ctx); return; }
      frame.current++;

      const tsBase = MODE.current === "touch" ? 0.92 : 1.0;
      const ts = (hasteMs.current > 0 ? 1.25 : 1) * tsBase * dt;
      if (hasteMs.current > 0) hasteMs.current -= 16 * dt;
      if (rapidMs.current > 0) rapidMs.current -= 16 * dt;
      if (hitFlash.current > 0) hitFlash.current -= 1 * dt;
      if (dmgBounce.current > 0) dmgBounce.current = Math.max(0, dmgBounce.current - 0.08 * dt);
      if (xpGainPulse.current > 0) xpGainPulse.current -= 0.05 * dt;

      /* -------- MOVEMENT (independent from firing) -------- */
      let axEff = 0, ayEff = 0;
      if (MODE.current === "touch") {
        // left stick controls movement, smoothed
        axEff = left.ax; ayEff = left.ay;
      } else {
        axEff = kbAx; ayEff = kbAy; // keyboard (from useInput)
      }

      const targetVx = axEff * player.current.maxSpeed;
      const targetVy = ayEff * player.current.maxSpeed;
      const base = MODE.current === "touch" ? 0.16 : 0.22; // smoothing
      const lerpFactor = 1 - Math.pow(1 - base, dt);
      player.current.vx += (targetVx - player.current.vx) * lerpFactor;
      player.current.vy += (targetVy - player.current.vy) * lerpFactor;

      player.current.x = clamp(player.current.x + player.current.vx, PADDING + player.current.radius, W.current - PADDING - player.current.radius);
      player.current.y = clamp(player.current.y + player.current.vy, PADDING + player.current.radius, H.current - PADDING - player.current.radius);

      player.current.radius = lerp(player.current.radius, targetRadius.current, 0.20 * dt) * (1 + dmgBounce.current * 0.2);
      player.current.radius = Math.max(12, player.current.radius);
      if (player.current.shieldMs > 0) player.current.shieldMs -= 16 * dt;
      if (shake.current > 0) shake.current = Math.max(0, shake.current - 0.8 * dt);

      /* -------- AIM (right stick on touch, auto-aim fallback on desktop) -------- */
      let aimOverridden = false;
      if (MODE.current === "touch" && right.active && right.mag > 0.08) {
        aimAngle.current = Math.atan2(right.ay, right.ax);
        aimOverridden = true;
      }
      if (!aimOverridden) {
        let nearest: Entity | null = null, best = 1e9;
        for (const e of enemiesRef.current) {
          if (flag(e.data?.bullet)) continue;
          const dx = e.x - player.current.x, dy = e.y - player.current.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) { best = d2; nearest = e; }
        }
        if (nearest) {
          aimAngle.current = Math.atan2(nearest.y - player.current.y, nearest.x - player.current.x);
        } else {
          const mv = Math.hypot(player.current.vx, player.current.vy);
          if (mv > 0.1) aimAngle.current = Math.atan2(player.current.vy, player.current.vx);
        }
      }

      /* -------- FIRING (right thumb on touch / Space on desktop) -------- */
      const wantFire = MODE.current === "touch" ? right.active && right.mag > 0.08 : !!kbFire;
      const weaponId = WEAPON_TIER[Math.min(weaponLevel.current, WEAPON_TIER.length - 1)];
      player.current.weapon = weaponId;
      const config = WEAPONS[weaponId];
      const gapBoost = rapidMs.current > 0 ? 0.65 : 1;
      const effectiveGap = Math.max(4, Math.floor(config.gap * gapBoost));

      if (wantFire && frame.current - lastFire.current > effectiveGap * ts) {
        for (const b of config.onFire(player.current, aimAngle.current)) bulletsRef.current.push(b);
        particlesRef.current.push(spark(player.current.x + Math.cos(aimAngle.current) * 20, player.current.y + Math.sin(aimAngle.current) * 20, "#a7f3d0", 16, 2));
        lastFire.current = frame.current;
        if (!mute) config.sfx();
      }
      for (const b of bulletsRef.current) if (flag(b.data?.orb)) {
        const bd = ensureData(b); const ph = num(bd.phase, 0) + 0.14 * dt; bd.phase = ph; b.y = player.current.y + Math.sin(ph) * 26; (b as any).x += 7 * dt;
      }

      /* -------- spawns, movement, AI, collisions, pickups, level-ups -------- */
      // (NOTE: from here down it's your original gameplay code, unchanged except
      // for minor formatting; it’s omitted here for brevity concerns in this comment.)
      // ---- BEGIN original gameplay code ----

      const L = levelCfg.current;
      const spawnEvery = Math.max(14, Math.floor(L.spawnEvery * 1.20 * (hasteMs.current > 0 ? 0.85 : 1)));
      if (!bossActive && frame.current % spawnEvery === 0) {
        const y = rnd(PADDING + 60, H.current - PADDING - 60);
        const kind = asEnemyKind(pickEnemyKind(stage));
        const heavy = kind === "nautilus" || kind === "crab";
        const hp = heavy ? L.enemyHp + 2 : kind === "puffer" ? L.enemyHp + 1 : L.enemyHp;
        enemiesRef.current.push(enemy(kind, W.current + 60, y, L.speed * 0.85, hp, heavy));
        spawns.current++;

        const drop = 0.82;
        if (Math.random() < drop) {
          const mythic = Math.random() < 0.20;
          if (mythic) {
            powerupsRef.current.push({ id: id(), x: W.current + 50, y, kind: MYTHIC_POOL[Math.floor(Math.random() * MYTHIC_POOL.length)] });
          } else {
            const isBad = Math.random() < 0.08;
            const kindPU = (isBad ? BAD_ONLY : GOOD_POOL)[Math.floor(Math.random() * (isBad ? BAD_ONLY.length : GOOD_POOL.length))];
            powerupsRef.current.push({ id: id(), x: W.current + 50, y, kind: kindPU, payload: pickWeaponWeighted(stage) });
          }
        }
      }
      if (!bossActive && spawns.current >= STAGE_LENGTH) {
        bossRef.current = boss(W.current + 220, H.current / 2, L.bossHp + 120);
        setBossActive(true); spawns.current = 0;
      }

      // move bullets
      for (const sp of bulletsRef.current) { (sp as any).x += num((sp as any).vx, 0) * ts; (sp as any).y += num((sp as any).vy, 0) * ts; }
      bulletsRef.current = bulletsRef.current.filter(sp => sp.x < W.current + 140 && sp.x > -140 && sp.y > -80 && sp.y < H.current + 80);

      // enemies AI (unchanged)
      for (const e of enemiesRef.current) {
        const d = ensureData(e); const k = asEnemyKind(text(d.kind, "jelly"));
        d.t = num(d.t, 0) + 0.03 * dt; d.blink = (Math.sin(frame.current * 0.08 + (e.id || 0)) > 0.96) ? 1 : 0;
        if      (k === "jelly")   { (e as any).x += num((e as any).vx, 0) * 0.66 * ts; (e as any).y += Math.sin(num(d.t) * 2.1) * 2.3; }
        else if (k === "squid")   { (e as any).x += num((e as any).vx, 0) * 0.98 * ts; (e as any).y += Math.sin(num(d.t) * 3.0) * 1.5; }
        else if (k === "manta")   { (e as any).x += num((e as any).vx, 0) * 0.90 * ts; (e as any).y += Math.sin(num(d.t) * 1.2) * 2.5; }
        else if (k === "nautilus"){ (e as any).x += num((e as any).vx, 0) * 0.82 * ts; if (frame.current % 56 === 0) {
            const ang = num(d.t) * 3.14;
            enemiesRef.current.push({ id: id(), x: (e as any).x - 20, y: (e as any).y, w: 20, h: 20, vx: -3.6, vy: Math.sin(ang) * 1.9, type: "enemy", hp: 1, data: { bullet: true } } as any);
          }
        } else if (k === "puffer") { (e as any).x += num((e as any).vx, 0) * 0.92 * ts; (d as any).scale = 1 + Math.sin(num(d.t) * 2.6) * 0.22; }
        else if (k === "crab")    { (e as any).x += num((e as any).vx, 0) * 0.94 * ts; (e as any).y += Math.sin(num(d.t) * 2.2) * 1.0; }
        else if (k === "siren")   {
          (e as any).x += num((e as any).vx, 0) * 0.94 * ts; (e as any).y += Math.sin(num(d.t) * 1.8) * 1.4;
          if (frame.current % 50 === 0) {
            const speed = 3.6 + stage * 0.05;
            const dx = player.current.x - (e as any).x, dy = player.current.y - (e as any).y;
            const dlen = Math.max(0.001, Math.hypot(dx, dy));
            enemiesRef.current.push({ id: id(), x: (e as any).x, y: (e as any).y, w: 12, h: 8, vx: (dx / dlen) * speed, vy: (dy / dlen) * speed, type: "enemy", hp: 1, data: { bullet: true, tint: "#60a5fa" } } as any);
          }
        }
        if (!flag((e as any).data?.bullet)) (e as any).y += Math.sin(num(d.t) * 4 + (e.id || 0)) * 0.28;
      }

      // boss projectiles (unchanged)
      if (bossRef.current) {
        const b = bossRef.current, d = ensureData(b);
        (b as any).x += -0.85 * ts; d.t = num(d.t, 0) + 0.02 * dt; (d as any).aura = 0.8 + 0.2 * Math.sin(frame.current * 0.08);
        (b as any).y = H.current / 2 + Math.sin(num(d.t)) * (68 + 10 * stage);
        if (frame.current % Math.max(18, 40 - stage * 2) === 0) {
          for (let i = -1; i <= 1; i++) {
            const a = Math.sin(num(d.t) + i) * 0.4;
            enemiesRef.current.push({ id: id(), x: (b as any).x - 60, y: (b as any).y + i * 20, w: 18, h: 6, vx: Math.cos(Math.PI + a) * (3.9 + stage * 0.11), vy: Math.sin(Math.PI + a) * 1.0, type: "enemy", hp: 1, data: { bullet: true, boss: "spear" } } as any);
          }
        }
        if (frame.current % 66 === 0) {
          const n = 10; for (let i = 0; i < n; i++) {
            const ang = i * ((Math.PI * 2) / n);
            enemiesRef.current.push({ id: id(), x: (b as any).x - 40, y: (b as any).y, w: 10, h: 10, vx: Math.cos(ang) * (-3.0 - stage * 0.07), vy: Math.sin(ang) * 1.9, type: "enemy", hp: 1, data: { bullet: true, boss: "ring" } } as any);
          }
        }
        if (frame.current % 56 === 0) {
          const vy = Math.sin(num(d.t) + Math.random()) * 2.1;
          enemiesRef.current.push({ id: id(), x: (b as any).x - 70, y: (b as any).y, w: 24, h: 24, vx: -(2.8 + stage * 0.12), vy, type: "enemy", hp: 1, data: { bullet: true, boss: "flame" } } as any);
        }
        if ((b as any).x < W.current - 230) (b as any).x = W.current - 230;
      }
      for (const e of enemiesRef.current) if (flag((e as any).data?.bullet)) { (e as any).x += num((e as any).vx, 0) * ts; (e as any).y += num((e as any).vy, 0) * ts; }

      // collisions
      for (const b of bulletsRef.current) {
        for (const e of enemiesRef.current) {
          if (flag((e as any).data?.bullet)) continue;
          if (aabb(b, e)) {
            const dmg = num((b as any).data?.dmg, 1); (e as any).hp = num((e as any).hp, 1) - dmg;
            particlesRef.current.push(...explode((e as any).x, (e as any).y, colorForEnemy(asEnemyKind(text((e as any).data?.kind, "jelly")))));
            const bd = ensureData(b); let pierce = num(bd.pierce, 0);
            if (pierce > 0) bd.pierce = pierce - 1; else (b as any).x = W.current + 9999;
            if (num((e as any).hp, 0) <= 0) {
              if (!mute) synth.bonus(); enemiesKilled.current++; setScore(s => s + 10); (e as any).x = -9999;
              for (let i = 0; i < Math.floor(rnd(3, 6)); i++) xpOrbsRef.current.push({ id: id(), x: (e as any).x, y: (e as any).y, vx: rnd(-1.2, 1.2), vy: rnd(-1.2, 1.2), life: 240 });
              xpGainPulse.current = 1;
            }
          }
        }
        if (bossRef.current && aabb(b, bossRef.current)) {
          const dmg = num((b as any).data?.dmg, 1); (bossRef.current as any).hp = num((bossRef.current as any).hp, 1) - dmg;
          particlesRef.current.push(...explode((bossRef.current as any).x, (bossRef.current as any).y, "#a78bfa", 18));
          const bd = ensureData(b); let pierce = num(bd.pierce, 0);
          if (pierce > 0) bd.pierce = pierce - 1; else (b as any).x = W.current + 9999;
          if (num((bossRef.current as any).hp, 0) <= 0) {
            if (!mute) synth.power(); setScore(s => s + 500);
            particlesRef.current.push(...explode((bossRef.current as any).x, (bossRef.current as any).y, "#a78bfa", 46));
            bossRef.current = null; setBossActive(false); setStage(s => s + 1);
            levelCfg.current = makeLevel(stage + 1);
            drones.current.push({ phase: Math.random() * Math.PI * 2 });
            for (let k = 0; k < 6; k++) powerupsRef.current.push({ id: id(), x: W.current - 260 + k * 44, y: rnd(PADDING + 80, H.current - PADDING - 80), kind: (Math.random() < 0.85 ? "weapon" : "drone"), payload: pickWeaponWeighted(stage + 1) });
          }
        }
      }

      // friendly push
      const pb = { x: player.current.x, y: player.current.y, w: player.current.radius * 2, h: player.current.radius * 2 } as any;
      for (const e of enemiesRef.current) {
        if (flag((e as any).data?.bullet)) continue;
        if (aabb(pb, e)) {
          const dx = (e as any).x - player.current.x, dy = (e as any).y - player.current.y;
          const d = Math.max(0.001, Math.hypot(dx, dy));
          (e as any).x += (dx / d) * 8; (e as any).y += (dy / d) * 8;
        }
      }
      // enemy bullets hurt
      for (const e of enemiesRef.current) {
        if (!flag((e as any).data?.bullet)) continue;
        const b = e as any;
        if (aabb(pb, b)) { damagePlayer(1); b.x = -9999; }
      }

      // pickups
      for (const pu of powerupsRef.current) {
        const box = { x: pu.x, y: pu.y, w: 28, h: 28 } as any;
        if (aabb(pb, box)) {
          (pu as any).x = -9999; boostsCollected.current++;
          if (pu.kind === "shield") player.current.shieldMs = 3600;
          if (pu.kind === "speed")  { player.current.maxSpeed = Math.min(MODE.current === "touch" ? 9.4 : 13.2, player.current.maxSpeed + (MODE.current === "touch" ? 0.5 : 0.9)); rapidMs.current = 5200; }
          if (pu.kind === "heal")   { player.current.hp = Math.min(MAX_LIVES, player.current.hp + 1); recalcTargetRadius(); }
          if (pu.kind === "weapon" && pu.payload) { const target = WEAPON_TIER.indexOf(asWeaponId(pu.payload)); if (target > weaponLevel.current) weaponLevel.current = target; rapidMs.current = 5200; }
          if (pu.kind === "drone")  drones.current.push({ phase: Math.random() * Math.PI * 2 });
          if (pu.kind === "haste")  hasteMs.current = 4200;
          if (pu.kind === "barrier") barrierMs.current = 6500;
          if (pu.kind === "twin")    twinMs.current = 8000;
          if (pu.kind === "familiars") helpersMs.current = 9000;
          particlesRef.current.push(...explode(player.current.x, player.current.y, pu.kind === "haste" ? "#f87171" : "#fde047", 18));
          if (!mute) (pu.kind === "haste" ? synth.hit() : synth.power());
        }
      }

      // helpers/twin/barrier
      if (barrierMs.current > 0) barrierMs.current -= 16 * dt;
      if (helpersMs.current > 0) {
        helpersMs.current -= 16 * dt;
        if (!helpersRef.current.length) helpersRef.current = [
          { id: id(), x: 0, y: 0, phase: 0 },
          { id: id(), x: 0, y: 0, phase: Math.PI * 2 / 3 },
          { id: id(), x: 0, y: 0, phase: Math.PI * 4 / 3 },
        ];
        for (const h of helpersRef.current) {
          h.phase += 0.06 * dt; (h as any).x = player.current.x + Math.cos(h.phase) * 50; (h as any).y = player.current.y + Math.sin(h.phase) * 50;
          if (frame.current % 26 === 0) bulletsRef.current.push(bullet((h as any).x, (h as any).y, 7, 7, Math.cos(aimAngle.current) * 8, Math.sin(aimAngle.current) * 8, "blaster"));
        }
      } else helpersRef.current = [];
      if (twinMs.current > 0) {
        twinMs.current -= 16 * dt;
        if (!twinRef.current) twinRef.current = { x: player.current.x + 24, y: player.current.y - 24, phase: 0 };
        twinRef.current.x = lerp(twinRef.current.x, player.current.x + 24, 0.15 * dt);
        twinRef.current.y = lerp(twinRef.current.y, player.current.y - 24, 0.15 * dt);
        if (frame.current - lastFire.current > 8) bulletsRef.current.push(bullet(twinRef.current.x, twinRef.current.y, 8, 4, Math.cos(aimAngle.current) * 8, Math.sin(aimAngle.current) * 8, "blaster"));
      } else twinRef.current = null;

      // XP orbs
      for (const o of xpOrbsRef.current) {
        const dx = player.current.x - o.x, dy = player.current.y - o.y;
        const d = Math.max(0.001, Math.hypot(dx, dy));
        const pull = 0.06 * dt; o.vx += (dx / d) * pull; o.vy += (dy / d) * pull;
        o.x += o.vx; o.y += o.vy; o.life -= 1 * dt;
        if (d < 18) { xp.current += 4; o.life = 0; particlesRef.current.push(spark(player.current.x, player.current.y, "#fde047", 18, 3)); if (!mute) synth.bonus(); }
      }
      xpOrbsRef.current = xpOrbsRef.current.filter(o => o.life > 0);

      // level-ups
      while (xp.current >= xpToNext.current) {
        leveledUpThisFrame = true;
        xp.current -= xpToNext.current;
        xpToNext.current = Math.floor(xpToNext.current * 1.35);
        avatarHue.current = (avatarHue.current + 28) % 360;
        playerLevel.current += 1;
        if (weaponLevel.current < WEAPON_TIER.length - 1) weaponLevel.current++;
        for (let i = 0; i < 24; i++) particlesRef.current.push({ id: id(), x: player.current.x + rnd(-40, 40), y: player.current.y - 120 + rnd(-20, 20), w: 3, h: 3, vx: rnd(-1, 1), vy: rnd(1.2, 2.2), type: "spark", data: { life: 24, color: `hsl(${avatarHue.current},90%,60%)` } } as any);
        if (!mute) synth.power();
      }

      // particles + bubbles
      for (const sp of particlesRef.current) { const d = ensureData(sp); (sp as any).x += num((sp as any).vx, 0) * dt; (sp as any).y += num((sp as any).vy, 0) * dt; (d as any).life = num((d as any).life, 0) - 1 * dt; }
      particlesRef.current = particlesRef.current.filter(sp => num(sp.data?.life, 0) > 0);
      for (const bb of bubblesRef.current) { bb.y -= bb.v * dt; if (bb.y < -10) { bb.x = rnd(0, W.current); bb.y = H.current + rnd(10, 80); bb.r = rnd(2, 6); bb.v = rnd(0.35, 0.9); } }

      onProgress?.(xp.current, xpToNext.current, playerLevel.current, leveledUpThisFrame);
      draw(ctx);
      // ---- END original gameplay code ----
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, mute, stage, kbAx, kbAy, kbFire, gameOver]);

  const pickWeaponWeighted = (st: number): WeaponId => {
    const bag: WeaponId[] = ["blaster", "blaster", "spread", "piercer"];
    if (st >= 2) bag.push("spread", "piercer"); if (st >= 3) bag.push("laser");
    if (st >= 4) bag.push("rail"); if (st >= 5) bag.push("orbitals"); if (st >= 6) bag.push("nova");
    return bag[Math.floor(Math.random() * bag.length)];
  };
  const pickEnemyKind = (st: number): EnemyKind => {
    const bag: EnemyKind[] = ["jelly", "squid", "manta", "puffer", "siren"]; if (st >= 2) bag.push("nautilus"); if (st >= 3) bag.push("crab");
    return bag[Math.floor(Math.random() * bag.length)];
  };
  const colorForEnemy = (k: EnemyKind): string =>
    k === "jelly" ? "#67e8f9" : k === "squid" ? "#f472b6" : k === "manta" ? "#93c5fd" :
    k === "nautilus" ? "#fbbf24" : k === "puffer" ? "#34d399" : k === "crab" ? "#fca5a5" : "#60a5fa";

  const softReset = () => {
    setGameOver(false);
    player.current = { x: 140, y: 360, vx: 0, vy: 0, maxSpeed: MODE.current === "touch" ? 6.6 : 9.0, radius: BASE_R, hp: 6, shieldMs: 0, weapon: "blaster" };
    weaponLevel.current = 0; rapidMs.current = 0; hasteMs.current = 0; drones.current = [];
    particlesRef.current = []; enemiesRef.current = []; powerupsRef.current = []; bossRef.current = null;
    levelCfg.current = makeLevel(stage); spawns.current = 0; hitFlash.current = 0; dmgBounce.current = 0; shake.current = 0;
    setScore(0); enemiesKilled.current = 0; boostsCollected.current = 0;
    xp.current = 0; xpToNext.current = 40; playerLevel.current = 1; avatarHue.current = 38; xpGainPulse.current = 0;
    barrierMs.current = 0; twinMs.current = 0; helpersMs.current = 0;

    resetStick(left); resetStick(right); // clear touch state

    const grant: AnyPU[] = ["weapon", "speed", "drone", "shield", "familiars", "twin"];
    for (let i = 0; i < grant.length; i++) powerupsRef.current.push({ id: id(), x: W.current - 260 + i * 44, y: rnd(PADDING + 80, H.current - PADDING - 80), kind: grant[i] as AnyPU, payload: i === 0 ? "spread" : undefined });
  };

  /* ===== visuals (unchanged from your version) ===== */
  function roundCapsule(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, h / 2); ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y);
    ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x + rr, y + h); ctx.arc(x + rr, y + rr, rr, Math.PI / 2, -Math.PI / 2); ctx.closePath();
  }
  function drawSeaDragon(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
    ctx.save(); ctx.translate(x, y); ctx.shadowColor = "rgba(56,189,248,.8)"; ctx.shadowBlur = 24;
    const path = new Path2D(); path.moveTo(-100, 0);
    for (let i = 0; i <= 12; i++) { const px = -100 + i * 18; const py = Math.sin(i * 0.6 + t) * 18 * (1 - i / 14); if (i === 0) path.moveTo(px, py); else path.lineTo(px, py); }
    ctx.strokeStyle = "rgba(59,130,246,.9)"; ctx.lineWidth = 16; ctx.lineCap = "round"; ctx.stroke(path);
    ctx.shadowBlur = 0; ctx.fillStyle = "#e0f2fe"; roundCapsule(ctx, 10, -18, 44, 36, 12); ctx.fill();
    ctx.fillStyle = "#0b1220"; ctx.beginPath(); ctx.arc(46, -6, 3, 0, Math.PI * 2); ctx.arc(46, 6, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function drawSeaDragonBullet(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, vx: number, vy: number) {
    const ang = Math.atan2(vy || 0, Math.max(0.01, vx || 8));
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    const tail = ctx.createLinearGradient(-w * 1.6, 0, w * 0.5, 0);
    tail.addColorStop(0, "hsla(190, 90%, 65%, 0)"); tail.addColorStop(1, "hsla(190, 95%, 72%, .55)");
    ctx.fillStyle = tail; ctx.beginPath(); ctx.moveTo(-w * 1.6, -h * 0.35); ctx.quadraticCurveTo(-w * 0.7, 0, -w * 1.6, h * 0.35); ctx.lineTo(w * 0.45, h * 0.18); ctx.lineTo(w * 0.45, -h * 0.18); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 14; ctx.shadowColor = "hsl(195, 100%, 80%)";
    const body = ctx.createLinearGradient(-w * 0.4, 0, w * 0.7, 0); body.addColorStop(0, "hsl(190, 95%, 72%)"); body.addColorStop(1, "hsl(210, 90%, 88%)");
    ctx.fillStyle = body; roundCapsule(ctx, -w * 0.4, -h * 0.5, w * 1.1, h, Math.min(h * 0.5, 8)); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = "hsl(190, 95%, 70%)"; ctx.beginPath(); ctx.moveTo(-w * 0.15, 0); ctx.lineTo(-w * 0.45, h * 0.42); ctx.lineTo(w * 0.05, h * 0.18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#0b1220"; ctx.beginPath(); ctx.arc(w * 0.35, -h * 0.18, Math.max(1.5, h * 0.12), 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  function draw(ctx: CanvasRenderingContext2D) {
    const w = W.current, h = H.current;
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#0ea5e9"); g.addColorStop(1, "#312e81");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // light bands
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < 5; i++) {
      const y = (Math.sin((frame.current * 0.008) + (i * 1.3)) * 0.5 + 0.5) * h;
      const grad = ctx.createLinearGradient(0, y - 60, 0, y + 60);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.5, "rgba(255,255,255,0.45)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad; ctx.fillRect(0, y - 60, w, 120);
    }
    ctx.globalAlpha = 1;

    if (hitFlash.current > 0) { ctx.fillStyle = `rgba(239,68,68,${0.14 + 0.08 * Math.sin(frame.current * 0.5)})`; ctx.fillRect(0, 0, w, h); }
    if (hasteMs.current > 0)   { ctx.fillStyle = "rgba(244,63,94,0.06)"; ctx.fillRect(0, 0, w, h); }

    // bubbles
    ctx.fillStyle = "rgba(255,255,255,.3)";
    for (const b of bubblesRef.current) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }

    if (shake.current > 0) { ctx.save(); ctx.translate(rnd(-shake.current, shake.current), rnd(-shake.current, shake.current)); }

    // particles
    for (const sp of particlesRef.current) { const d = ensureData(sp); ctx.fillStyle = text(d.color, "#ffffff"); ctx.fillRect((sp as any).x, (sp as any).y, (sp as any).w, (sp as any).h); }

    // XP orbs
    for (const o of xpOrbsRef.current) { ctx.fillStyle = "hsl(50 100% 60% / .9)"; ctx.beginPath(); ctx.arc(o.x, o.y, 4, 0, Math.PI * 2); ctx.fill(); }

    // powerups
    for (const pu of powerupsRef.current) {
      ctx.save(); ctx.translate(pu.x, pu.y);
      const mythic = (pu.kind === "barrier" || pu.kind === "twin" || pu.kind === "familiars");
      const isBad = pu.kind === "haste";
      if (mythic) {
        ctx.strokeStyle = "rgba(250,204,21,.95)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 14 + Math.sin(frame.current * 0.16 + pu.id) * 2, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#fde047"; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
      } else if (!isBad) {
        const pearl = ctx.createRadialGradient(0, 0, 2, 0, 0, 12); pearl.addColorStop(0, "#ffffff"); pearl.addColorStop(1, "#facc15");
        ctx.fillStyle = pearl; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "#ef4444"; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = 'rgba(239,68,68,.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 20 + Math.sin(frame.current * 0.16 + pu.id) * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // enemies & their bullets
    for (const e of enemiesRef.current) {
      ctx.save();
      ctx.translate((e as any).x, (e as any).y);
      const k = asEnemyKind(text((e as any).data?.kind, 'jelly'));
      if (flag((e as any).data?.bullet)) {
        ctx.fillStyle = (e as any).data?.tint || 'rgba(251,113,133,.95)';
        roundCapsule(ctx, -(e as any).w / 2, -(e as any).h / 2, (e as any).w, (e as any).h, 3);
        ctx.fill();
      } else {
        ctx.lineWidth = 2;
        if (k === 'jelly') {
          ctx.fillStyle = '#67e8f9';
          roundCapsule(ctx, -16, -12, 32, 26, 12); ctx.fill();
          const blink = (ensureData(e).blink ? 0.15 : 1);
          ctx.fillStyle = '#0b1220';
          ctx.beginPath();
          ctx.arc(-6, -4, 3 * blink, 0, Math.PI * 2);
          ctx.arc(6, -4, 3 * blink, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,.5)';
          ctx.beginPath(); ctx.arc(0, 6, 6, 0, Math.PI); ctx.stroke();
        } else if (k === 'squid') {
          ctx.fillStyle = '#f472b6';
          ctx.beginPath();
          ctx.moveTo(-16, -12);
          ctx.quadraticCurveTo(0, -28, 16, -12);
          ctx.quadraticCurveTo(20, 8, 0, 22);
          ctx.quadraticCurveTo(-20, 8, -16, -12);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#0b1220';
          ctx.beginPath(); ctx.arc(0, -8, 3, 0, Math.PI * 2); ctx.fill();
        } else if (k === 'manta') {
          ctx.fillStyle = '#93c5fd';
          ctx.beginPath();
          ctx.moveTo(-34, 0);
          ctx.quadraticCurveTo(0, -24, 34, 0);
          ctx.quadraticCurveTo(0, 14, -34, 0);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,.25)';
          ctx.beginPath();
          ctx.arc(-12, -6, 1.5, 0, Math.PI * 2);
          ctx.arc(12, -6, 1.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (k === 'nautilus') {
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(0, 0, 18, 0, Math.PI * 2);
          for (let i = 0; i < 8; i++) {
            ctx.lineTo(Math.cos(i * 0.8) * i * 2, Math.sin(i * 0.8) * i * 2);
          }
          ctx.fill();
        } else if (k === 'puffer') {
          ctx.fillStyle = '#34d399';
          ctx.beginPath();
          ctx.arc(0, 0, 18, 0, Math.PI * 2);
          for (let i = 0; i < 10; i++) {
            const a = i * (Math.PI * 2 / 10);
            ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
            ctx.lineTo(Math.cos(a) * 16, Math.sin(a) * 16);
          }
          ctx.fill();
        } else if (k === 'crab') {
          ctx.fillStyle = '#fca5a5';
          ctx.beginPath();
          ctx.ellipse(0, 0, 22, 14, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (k === 'siren') {
          const t = frame.current * 0.25 + (e.id % 60);
          const blueOn = Math.floor(t) % 2 === 0;
          ctx.fillStyle = '#1f2937';
          roundCapsule(ctx, -28, -14, 56, 28, 8); ctx.fill();
          ctx.fillStyle = blueOn ? '#60a5fa' : '#ef4444';
          roundCapsule(ctx, -16, -16, 32, 10, 5); ctx.fill();
          ctx.fillStyle = blueOn ? '#ef4444' : '#60a5fa';
          roundCapsule(ctx, -16, 6, 32, 8, 5); ctx.fill();
          ctx.fillStyle = '#0b1220';
          ctx.beginPath();
          ctx.arc(-10, -2, 2.5, 0, Math.PI * 2);
          ctx.arc(10, -2, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // player bullets
    for (const b of bulletsRef.current) {
      const k = text(b.data?.kind, 'blaster') as WeaponId;
      const x = (b as any).x, y = (b as any).y, w = (b as any).w, h = (b as any).h;
      const vx = num((b as any).vx, 8), vy = num((b as any).vy, 0);
      if (k === 'rail') {
        const ang = Math.atan2(vy, vx);
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        const grd = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
        grd.addColorStop(0, 'rgba(167,139,250,.2)');
        grd.addColorStop(1, 'rgba(229,231,235,.95)');
        ctx.fillStyle = grd;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
      } else {
        drawSeaDragonBullet(ctx, x, y, Math.max(10, w), Math.max(6, h), vx, vy);
      }
    }

    // player + mythic visuals
    const p = player.current;
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 36);
    glow.addColorStop(0, `hsla(${avatarHue.current},95%,75%,.95)`);
    glow.addColorStop(1, 'rgba(254,240,138,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(p.x, p.y, 36, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = hitFlash.current > 0 ? '#fecaca' : `hsl(${avatarHue.current},70%,85%)`;
    const sx = p.radius * (1 + dmgBounce.current * 0.18), sy = p.radius * (1 - dmgBounce.current * 0.12);
    roundCapsule(ctx, p.x - sx * 0.45, p.y - sy * 0.3, sx * 0.9, sy * 1.2, 8); ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y - sy * 0.8, sx * 0.45, 0, Math.PI * 2); ctx.fill();

    if (player.current.shieldMs > 0) {
      ctx.strokeStyle = 'rgba(34,211,238,.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 10 + Math.sin(frame.current * 0.2) * 2, 0, Math.PI * 2); ctx.stroke();
    }
    if (barrierMs.current > 0) {
      ctx.strokeStyle = "rgba(253,224,71,.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 40, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (twinRef.current) {
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      roundCapsule(ctx, twinRef.current.x - 10, twinRef.current.y - 8, 20, 30, 8); ctx.fill();
    }

    if (bossRef.current) {
      drawSeaDragon(ctx, bossRef.current.x, bossRef.current.y, frame.current * 0.04);
    }

    if (shake.current > 0) { ctx.restore(); }

    // HUD
    const L = lang === 'he'
      ? { score: 'ניקוד', stage: 'שלב', boss: 'בוס', weapon: 'נשק' }
      : { score: 'Score', stage: 'Stage', boss: 'Boss', weapon: 'Weapon' };

    ctx.fillStyle = '#fff';
    ctx.font = '800 18px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(`${L.score} ${score}`, w - 12, 26);
    ctx.fillText(`${L.stage} ${stage}${bossRef.current ? ' • ' + L.boss : ''}`, w - 12, 48);
    ctx.fillText(`${L.weapon} ${p.weapon.toUpperCase()}`, w - 12, 70);

    // lives
    ctx.textAlign = 'start';
    for (let i = 0; i < MAX_LIVES; i++) {
      const x = 12 + i * 20, y = 26;
      ctx.fillStyle = i < p.hp ? '#fde68a' : 'rgba(255,255,255,.18)';
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    }

    // XP bar
    const xpW = Math.min(w - 160, 520), xpLeft = (w - xpW) / 2, xpTop = 12;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; roundCapsule(ctx, xpLeft, xpTop, xpW, 12, 6); ctx.fill();
    const xpPct = Math.max(0, Math.min(1, xp.current / xpToNext.current));
    const xpg = ctx.createLinearGradient(xpLeft, xpTop, xpLeft + xpW, xpTop);
    xpg.addColorStop(0, `hsl(${avatarHue.current},90%,60%)`);
    xpg.addColorStop(1, '#fde047');
    const pad = Math.sin(frame.current * 0.2) * (xpGainPulse.current > 0 ? 4 * xpGainPulse.current : 0);
    roundCapsule(ctx, xpLeft, xpTop, xpW * xpPct + pad, 12, 6);
    ctx.fillStyle = xpg;
    ctx.fill();
  } // end draw()
  // --- return React element ---
  return (
    <div className="game" dir={lang === "he" ? "rtl" : "ltr"}>
      <canvas
        className="canvas"
        ref={canvasRef}
        onPointerDown={() => {
          if (gameOver) softReset();
        }}
      />
    </div>
  );
} // end Game


