/* Game.tsx — smoother arrows, upgraded mobile joysticks, 360° aim, mythic buffs, sea-dragon boss, XP/Level reporting */
import { useEffect, useRef, useState } from 'react'
import type { Entity, PlayerState, WeaponId, PowerUpKind } from './types'
import { clamp, lerp, rnd, id, aabb } from './utils'
import { useInput } from './useInput'
import { synth } from './audio'
import { makeLevel, STAGE_LENGTH } from './levels'

/* ========= small helpers ========= */
const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const flag = (v: any) => v === true
const text = (v: any, d = '') => (typeof v === 'string' ? v : d)
const ensureData = <T extends { data?: Record<string, any> }>(o: T) =>
  (o.data ??= {} as Record<string, any>)

/* ========= types ========= */
type EnemyKind = 'jelly'|'squid'|'manta'|'nautilus'|'puffer'|'crab'
type PU = Extract<PowerUpKind,'shield'|'speed'|'heal'|'weapon'|'drone'|'haste'>
type MythicPU = 'barrier'|'twin'|'familiars'
type AnyPU = PU | MythicPU

/* ========= constants ========= */
const WEAPON_TIER: Readonly<WeaponId[]> =
  ['blaster','spread','piercer','laser','rail','orbitals','nova'] as const

const GOOD_POOL: PU[] = ['shield','speed','heal','weapon','drone']
const BAD_ONLY:   PU[] = ['haste']
const MYTHIC_POOL: MythicPU[] = ['barrier','twin','familiars']

const PADDING = 14
const BASE_R  = 26
const MAX_LIVES = 6

/* ========= casting helpers ========= */
const asWeaponId = (x: unknown): WeaponId =>
  (WEAPON_TIER as readonly string[]).includes(String(x)) ? (x as WeaponId) : 'blaster'
const asEnemyKind = (x: unknown): EnemyKind => {
  const bag = ['jelly','squid','manta','nautilus','puffer','crab']
  return (bag as readonly string[]).includes(String(x)) ? (x as EnemyKind) : 'jelly'
}

/* ========= entities ========= */
function bullet(
  x:number,y:number,w:number,h:number,
  vx:number, vy:number,
  kind:WeaponId|string, data:Record<string,unknown>={}
):Entity{
  return { id:id(), x,y,w,h, vx, vy, type:'bullet', data:{kind,...data} } as any
}
function spark(x:number,y:number,c:string,life=26,sz=3):Entity{
  return { id:id(), x,y,w:sz,h:sz, vx:rnd(-2,2), vy:rnd(-2,2), type:'spark', data:{life,color:c} } as any
}
function explode(x:number,y:number,c:string,n=16){ const out:Entity[]=[]; for(let i=0;i<n;i++) out.push(spark(x,y,c,18+Math.random()*16,2+Math.random()*2)); return out }
function orbital(p:PlayerState,phase:number){ return bullet(p.x+18,p.y,8,8,7,0,'orbitals',{orb:true,phase}) }
function novaFan(p:PlayerState,ang:number){ // nova uses angle fan around aim
  const out:Entity[]=[]; for(let i=-3;i<=3;i++){ const a=ang+i*0.35; out.push(bullet(p.x+12,p.y,8,8,Math.cos(a)*7,Math.sin(a)*7,'nova',{pierce:2})) }
  return out
}

function enemy(kind:EnemyKind,x:number,y:number,speed:number,hp=1,heavy=false):Entity{
  const sizes:Record<EnemyKind,{w:number;h:number}> = {
    jelly:{w:40,h:40}, squid:{w:46,h:52}, manta:{w:68,h:36}, nautilus:{w:48,h:48}, puffer:{w:38,h:38}, crab:{w:52,h:32}
  }
  const s=sizes[kind]; return { id:id(), x,y,w:s.w,h:s.h, vx:-speed, vy:0, type:'enemy', hp, data:{kind,t:0,heavy} } as any
}
function boss(x:number,y:number,hp:number):Entity{
  // friendly sea-dragon look (glow); logic stays hostile
  return { id:id(), x,y,w:220,h:140, vx:-0.9, vy:0, type:'boss', hp, data:{phase:1,t:0,aura:1} } as any
}

/* ========= weapon map (now angle-aware) ========= */
type FireFn = (p:PlayerState, ang:number)=>Entity[]
const WEAPONS: Record<WeaponId, { gap:number; sfx:()=>void; onFire:FireFn }> = {
  blaster:{ gap:8,  sfx:()=>synth.shoot(), onFire:(p,ang)=>[
    bullet(p.x+18,p.y,8,4, Math.cos(ang)*9, Math.sin(ang)*9,'blaster')
  ]},
  spread: { gap:14, sfx:()=>synth.spread(), onFire:(p,ang)=>[
    bullet(p.x+18,p.y,8,4, Math.cos(ang-0.18)*7, Math.sin(ang-0.18)*7,'spread'),
    bullet(p.x+18,p.y,8,4, Math.cos(ang)*7,      Math.sin(ang)*7,     'spread'),
    bullet(p.x+18,p.y,8,4, Math.cos(ang+0.18)*7, Math.sin(ang+0.18)*7,'spread'),
  ]},
  piercer:{ gap:16, sfx:()=>synth.pierce(), onFire:(p,ang)=>[
    bullet(p.x+20,p.y,14,5, Math.cos(ang)*10, Math.sin(ang)*10,'piercer',{pierce:3})
  ]},
  laser:  { gap:22, sfx:()=>synth.laser(),  onFire:(p,ang)=>[
    bullet(p.x+26,p.y,18,6, Math.cos(ang)*12, Math.sin(ang)*12,'laser',{pierce:6,dmg:2})
  ]},
  rail:   { gap:34, sfx:()=>synth.rail(),   onFire:(p,ang)=>[
    bullet(p.x+24,p.y,4,72, Math.cos(ang)*16, Math.sin(ang)*16,'rail',{pierce:8,dmg:3})
  ]},
  orbitals:{gap:16, sfx:()=>synth.shoot(),  onFire:(p)=>[orbital(p,0),orbital(p,Math.PI)]},
  nova:   { gap:36, sfx:()=>synth.nova(),   onFire:(p,ang)=>novaFan(p,ang)},
}

/* ========= drawing helpers ========= */
function roundCapsule(ctx:CanvasRenderingContext2D, x:number, y:number, w:number, h:number, r:number){
  const rr = Math.min(r, h/2); ctx.beginPath(); ctx.moveTo(x+rr, y); ctx.lineTo(x+w-rr, y)
  ctx.arc(x+w-rr, y+rr, rr, -Math.PI/2, Math.PI/2); ctx.lineTo(x+rr, y+h); ctx.arc(x+rr, y+rr, rr, Math.PI/2, -Math.PI/2); ctx.closePath()
}
function drawSeaDragon(ctx: CanvasRenderingContext2D, x:number, y:number, t:number){
  // friendly glowing sea-dragon (boss body)
  ctx.save(); ctx.translate(x, y)
  ctx.shadowColor = 'rgba(56,189,248,.8)'; ctx.shadowBlur = 24
  const path = new Path2D()
  path.moveTo(-100, 0)
  for(let i=0;i<=12;i++){
    const px = -100 + i*18
    const py = Math.sin((i*0.6)+t)*18*(1 - i/14)
    if(i===0) path.moveTo(px,py); else path.lineTo(px,py)
  }
  ctx.strokeStyle = 'rgba(59,130,246,.9)'; ctx.lineWidth = 16; ctx.lineCap='round'
  ctx.stroke(path)
  ctx.shadowBlur = 0
  // head
  ctx.fillStyle = '#e0f2fe'
  roundCapsule(ctx, 10, -18, 44, 36, 12); ctx.fill()
  ctx.fillStyle = '#0b1220'; ctx.beginPath(); ctx.arc(46, -6, 3, 0, Math.PI*2); ctx.arc(46, 6, 3, 0, Math.PI*2); ctx.fill()
  ctx.restore()
}
function drawSeaDragonBullet(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, vx: number, vy: number){
  const ang = Math.atan2(vy || 0, Math.max(0.01, vx || 8))
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang)
  const tail = ctx.createLinearGradient(-w*1.6, 0, w*0.5, 0)
  tail.addColorStop(0, 'hsla(190, 90%, 65%, 0)'); tail.addColorStop(1, 'hsla(190, 95%, 72%, .55)')
  ctx.fillStyle = tail; ctx.beginPath(); ctx.moveTo(-w*1.6, -h*0.35)
  ctx.quadraticCurveTo(-w*0.7, 0, -w*1.6,  h*0.35); ctx.lineTo( w*0.45,  h*0.18); ctx.lineTo( w*0.45, -h*0.18); ctx.closePath(); ctx.fill()
  ctx.shadowBlur = 14; ctx.shadowColor = 'hsl(195, 100%, 80%)'
  const body = ctx.createLinearGradient(-w*0.4, 0, w*0.7, 0)
  body.addColorStop(0, 'hsl(190, 95%, 72%)'); body.addColorStop(1, 'hsl(210, 90%, 88%)')
  ctx.fillStyle = body; roundCapsule(ctx, -w*0.4, -h*0.5, w*1.1, h, Math.min(h*0.5, 8)); ctx.fill()
  ctx.shadowBlur = 0; ctx.fillStyle = 'hsl(190, 95%, 70%)'
  ctx.beginPath(); ctx.moveTo(-w*0.15, 0); ctx.lineTo(-w*0.45,  h*0.42); ctx.lineTo( w*0.05,   h*0.18); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#0b1220'; ctx.beginPath(); ctx.arc(w*0.35, -h*0.18, Math.max(1.5, h*0.12), 0, Math.PI*2); ctx.fill()
  ctx.restore()
}

/* ========= component ========= */
export default function Game(props: {
  lang: 'he' | 'en'
  onProgress?: (xp: number, xpNeeded: number, level: number, didLevelUp: boolean) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement|null>(null)
  const rafRef = useRef<number|null>(null)
  const frame = useRef(0)

  const [paused,setPaused] = useState(false)
  const [gameOver,setGameOver] = useState(false)
  const [score,setScore] = useState(0)
  const [mute,setMute] = useState(false)
  const [stage,setStage] = useState(1)
  const [bossActive,setBossActive] = useState(false)

  const { fire, ax, ay } = useInput()

  const W = useRef(760), H = useRef(980), dpr = useRef(1)
  const lvl = useRef(makeLevel(stage))
  const spawns = useRef(0)

  const player = useRef<PlayerState>({ x:140, y:360, vx:0, vy:0, maxSpeed:7.5, radius:BASE_R, hp:6, shieldMs:0, weapon:'blaster' })
  const targetRadius = useRef(BASE_R)
  const weaponLevel = useRef(0)

  // Progress up to App
  const xp = useRef(0)
  const xpToNext = useRef(40)
  const playerLevel = useRef(1)
  const avatarHue = useRef(38)
  const xpOrbsRef = useRef<Array<{id:number;x:number;y:number;vx:number;vy:number;life:number}>>([])

  const bulletsRef = useRef<Entity[]>([])
  const enemiesRef = useRef<Entity[]>([])
  const powerupsRef = useRef<Array<{id:number;x:number;y:number;kind:AnyPU;payload?:WeaponId}>>([])
  const bossRef = useRef<Entity|null>(null)
  const particlesRef = useRef<Entity[]>([])
  const drones = useRef<{phase:number}[]>([])

  const killsSincePower = useRef(0)
  const killsNeeded = useRef(10)

  const lastFire = useRef(0)
  const rapidMs = useRef(0)
  const hasteMs = useRef(0)
  const shake = useRef(0)
  const hitFlash = useRef(0)
  const dmgBounce = useRef(0)

  const enemiesKilled = useRef(0)
  const boostsCollected = useRef(0)
  const killStreak = useRef(0)
  const bubblesRef = useRef<{x:number;y:number;r:number;v:number}[]>([])

  // Mythic effects
  const barrierMs = useRef(0)
  const twinMs = useRef(0)
  const helpersMs = useRef(0)
  const helpersRef  = useRef<Array<{id:number;x:number;y:number;phase:number}>>([])
  const twinRef     = useRef<{x:number;y:number;phase:number}|null>(null)

  // Twin-stick (better)
  const moveTouchId = useRef<number|null>(null)
  const aimTouchId  = useRef<number|null>(null)
  const moveOrigin  = useRef<{x:number;y:number}|null>(null)
  const aimOrigin   = useRef<{x:number;y:number}|null>(null)
  const touchAx = useRef(0), touchAy = useRef(0)
  const aimAngle = useRef(0)
  const aimMag   = useRef(0)
  const touchFiring = useRef(false)

  /* ====== sizing ====== */
  useEffect(()=>{
    const c=canvasRef.current!, ctx=c.getContext('2d')!
    const onResize=()=>{
      const maxW=900
      const w=Math.min(window.innerWidth-24,maxW)
      const h=Math.min(window.innerHeight-(window.innerWidth<640?80:120),1040)
      W.current=Math.max(520,Math.floor(w))
      H.current=Math.max(640,Math.floor(h))
      dpr.current=window.devicePixelRatio||1
      c.width=Math.floor(W.current*dpr.current)
      c.height=Math.floor(H.current*dpr.current)
      ctx.setTransform(dpr.current,0,0,dpr.current,0,0)
    }
    onResize(); window.addEventListener('resize',onResize)
    return ()=>window.removeEventListener('resize',onResize)
  },[])

  /* ====== kb toggles ====== */
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const k=e.key.toLowerCase()
      if(k==='p') setPaused(p=>!p)
      if(k==='m'){ setMute(m=>!m); synth.mute(!mute) }
      if(gameOver && (k===' '||k==='enter')) softReset()
    }
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[mute,gameOver])

  /* ====== improved joysticks ====== */
  useEffect(()=>{
    const c = canvasRef.current!
    const getLocal = (ev: Touch | MouseEvent) => {
      const r = c.getBoundingClientRect()
      return { x: (ev.clientX - r.left), y: (ev.clientY - r.top) }
    }
    const R = 70;         // joystick radius
    const DZ = 10;        // deadzone
    const toVec = (ox:number, oy:number, x:number, y:number) => {
      const dx = x-ox, dy = y-oy
      let len = Math.hypot(dx,dy)
      const ang = Math.atan2(dy,dx)
      const mag = len <= DZ ? 0 : Math.min(1, (len-DZ)/(R-DZ))
      return { ang, mag, nx: Math.cos(ang)*mag, ny: Math.sin(ang)*mag }
    }

    const onTouchStart = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const local = getLocal(t as any)
        if (local.x < c.clientWidth * 0.5 && moveTouchId.current === null) {
          moveTouchId.current = t.identifier
          moveOrigin.current = local
          touchAx.current = 0; touchAy.current = 0
        } else if (aimTouchId.current === null) {
          aimTouchId.current = t.identifier
          aimOrigin.current = local
          touchFiring.current = true
        }
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === moveTouchId.current && moveOrigin.current) {
          const local = getLocal(t as any)
          const v = toVec(moveOrigin.current.x, moveOrigin.current.y, local.x, local.y)
          touchAx.current = v.nx
          touchAy.current = v.ny
        }
        if (t.identifier === aimTouchId.current && aimOrigin.current) {
          const local = getLocal(t as any)
          const v = toVec(aimOrigin.current.x, aimOrigin.current.y, local.x, local.y)
          aimAngle.current = v.ang
          aimMag.current = v.mag
          touchFiring.current = v.mag > 0.25
        }
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === moveTouchId.current) {
          moveTouchId.current = null
          moveOrigin.current = null
          touchAx.current = 0; touchAy.current = 0
        }
        if (t.identifier === aimTouchId.current) {
          aimTouchId.current = null
          aimOrigin.current = null
          aimMag.current = 0
          touchFiring.current = false
        }
      }
    }

    // Desktop: mouse to aim
    const onMouseMove = (e: MouseEvent) => {
      const local = getLocal(e)
      const dx = local.x - player.current.x
      const dy = local.y - player.current.y
      aimAngle.current = Math.atan2(dy, dx)
      aimMag.current = 1
    }
    const onMouseDown = () => { touchFiring.current = true }
    const onMouseUp   = () => { touchFiring.current = false }

    c.addEventListener('touchstart', onTouchStart, { passive: true })
    c.addEventListener('touchmove',  onTouchMove,  { passive: true })
    c.addEventListener('touchend',   onTouchEnd)
    c.addEventListener('touchcancel',onTouchEnd)
    c.addEventListener('mousemove',  onMouseMove)
    c.addEventListener('mousedown',  onMouseDown)
    c.addEventListener('mouseup',    onMouseUp)
    c.addEventListener('mouseleave', onMouseUp)

    return () => {
      c.removeEventListener('touchstart', onTouchStart)
      c.removeEventListener('touchmove',  onTouchMove)
      c.removeEventListener('touchend',   onTouchEnd)
      c.removeEventListener('touchcancel',onTouchEnd)
      c.removeEventListener('mousemove',  onMouseMove)
      c.removeEventListener('mousedown',  onMouseDown)
      c.removeEventListener('mouseup',    onMouseUp)
      c.removeEventListener('mouseleave', onMouseUp)
    }
  },[])

  /* ====== loop ====== */
  useEffect(()=>{
    const c=canvasRef.current!, ctx=c.getContext('2d')!
    if(!bubblesRef.current.length){
      for(let i=0;i<48;i++) bubblesRef.current.push({x:rnd(0,W.current),y:rnd(0,H.current),r:rnd(2,6),v:rnd(0.4,1.0)})
    }

    const recalcTargetRadius=()=>{ const t=Math.max(1,player.current.hp)/MAX_LIVES; targetRadius.current=BASE_R*(0.32+0.68*t) }

    const damagePlayer=(dmg=1)=>{
      if(player.current.shieldMs>0){ if(!mute) synth.hit(); hitFlash.current=8; return }
      player.current.hp-=dmg; recalcTargetRadius(); dmgBounce.current=1; hitFlash.current=16; shake.current=22
      if(!mute) synth.hit(); killStreak.current=0
      if(player.current.hp<=0){
        for(let i=0;i<120;i++) particlesRef.current.push(spark(player.current.x,player.current.y,i%2?'#22d3ee':'#a78bfa',24+rnd(0,20),2+rnd(0,3)))
        if(!mute) synth.nova(); setGameOver(true)
      }
    }

    const loop=()=>{
      rafRef.current=requestAnimationFrame(loop)
      if (paused || gameOver) { draw(ctx); return }

      frame.current++

      const ts=(hasteMs.current>0?1.25:1) // haste a bit milder now
      if(hasteMs.current>0) hasteMs.current-=16
      if(rapidMs.current>0) rapidMs.current-=16
      if(hitFlash.current>0) hitFlash.current-=1
      if(dmgBounce.current>0) dmgBounce.current=Math.max(0,dmgBounce.current-0.08)

      /* movement */
      const accel=0.22
      let axEff = ax, ayEff = ay
      if (moveTouchId.current !== null) { axEff = touchAx.current; ayEff = touchAy.current }
      player.current.vx=lerp(player.current.vx, axEff*player.current.maxSpeed,accel)
      player.current.vy=lerp(player.current.vy, ayEff*player.current.maxSpeed,accel)
      player.current.x=clamp(player.current.x+player.current.vx, PADDING+player.current.radius, W.current-PADDING-player.current.radius)
      player.current.y=clamp(player.current.y+player.current.vy, PADDING+player.current.radius, H.current-PADDING-player.current.radius)

      /* aim basis */
      if (aimTouchId.current===null && aimMag.current<0.01) {
        // fall back: aim where we're moving or to the right
        const mvLen = Math.hypot(player.current.vx, player.current.vy)
        aimAngle.current = mvLen>0.1 ? Math.atan2(player.current.vy, player.current.vx) : 0
      }

      player.current.radius=lerp(player.current.radius,targetRadius.current,0.25)*(1+dmgBounce.current*0.2)
      player.current.radius=Math.max(12,player.current.radius)
      if(player.current.shieldMs>0) player.current.shieldMs-=16
      if(shake.current>0) shake.current=Math.max(0,shake.current-0.8)

      /* weapon + firing */
      const weaponId=WEAPON_TIER[Math.min(weaponLevel.current,WEAPON_TIER.length-1)]
      player.current.weapon=weaponId
      const config=WEAPONS[weaponId]
      const gapBoost=rapidMs.current>0?0.65:1
      const effectiveGap=Math.max(4,Math.floor(config.gap*gapBoost))
      const wantsFire = fire || weaponId==='orbitals' || touchFiring.current
      if(wantsFire && frame.current-lastFire.current>effectiveGap*ts){
        for(const b of config.onFire(player.current, aimAngle.current)) bulletsRef.current.push(b)
        lastFire.current=frame.current; if(!mute) config.sfx()
      }
      // orbitals follow
      for(const b of bulletsRef.current) if(flag(b.data?.orb)){
        const bd=ensureData(b); const ph=num(bd.phase,0)+0.14; bd.phase=ph; b.y=player.current.y+Math.sin(ph)*26; b.x+=7
      }

      /* spawns: slower pace */
      const l=lvl.current
      const slowerSpawn = 1.35  // >1 => spawn less often
      const spawnEvery=Math.max(16,Math.floor(l.spawnEvery*slowerSpawn*(hasteMs.current>0?0.85:1)))
      if(!bossActive && frame.current%spawnEvery===0){
        const y=rnd(PADDING+60,H.current-PADDING-60)
        const kind=asEnemyKind(pickEnemyKind(stage))
        const heavy=kind==='nautilus'||kind==='crab'
        const hp=heavy? l.enemyHp+2 : (kind==='puffer'? l.enemyHp+1 : l.enemyHp)
        const slowerSpeed = 0.85
        enemiesRef.current.push(enemy(kind,W.current+60,y,l.speed*ts*slowerSpeed,hp,heavy))
        spawns.current++

        // Buffs more frequent + mythics occasionally
        const base = 0.32 + Math.min(0.30, killStreak.current*0.008) // 32%..62%
        if(Math.random() < base){
          const mythic = Math.random() < 0.12 // 12% of the time drop a mythic
          if (mythic) {
            powerupsRef.current.push({id:id(),x:W.current+50,y,kind:MYTHIC_POOL[Math.floor(Math.random()*MYTHIC_POOL.length)]})
          } else {
            const isBad = Math.random() < 0.22 // occasional haste
            const kindPU=(isBad?BAD_ONLY:GOOD_POOL)[Math.floor(Math.random()*(isBad?BAD_ONLY.length:GOOD_POOL.length))]
            powerupsRef.current.push({id:id(),x:W.current+50,y,kind:kindPU,payload:pickWeaponWeighted(stage)})
          }
        }
      }

      if(!bossActive && spawns.current>=STAGE_LENGTH){
        bossRef.current=boss(W.current+220,H.current/2,l.bossHp+120)
        setBossActive(true); spawns.current=0
      }

      /* bullets move */
      for(const sp of bulletsRef.current){ sp.x+=num(sp.vx,0)*ts; sp.y+=num(sp.vy,0)*ts }
      bulletsRef.current=bulletsRef.current.filter(sp=>sp.x<W.current+140 && sp.x>-140 && sp.y>-80 && sp.y<H.current+80)

      /* enemies AI */
      for (const e of enemiesRef.current) {
        const d = ensureData(e)
        const k = asEnemyKind(text(d.kind,'jelly'))
        d.t = num(d.t,0) + 0.03*ts
        if (k === 'jelly') {
          e.x += num(e.vx,0)*ts*0.70; e.y += Math.sin(num(d.t)*2.0)*2.2
        } else if (k === 'squid') {
          e.x += num(e.vx,0)*ts*1.05;  e.y += Math.sin(num(d.t)*3.0)*1.6
        } else if (k === 'manta') {
          e.x += num(e.vx,0)*ts*0.95; e.y += Math.sin(num(d.t)*1.2)*2.6
        } else if (k === 'nautilus') {
          e.x += num(e.vx,0)*ts*0.85
          if (frame.current % 52 === 0) {
            const ang = num(d.t) * 3.14
            enemiesRef.current.push({ id:id(), x:e.x-20, y:e.y, w:20, h:20, vx:-3.9, vy:Math.sin(ang)*2.0, type:'enemy', hp:1, data:{ bullet:true } } as any)
          }
        } else if (k === 'puffer') {
          e.x += num(e.vx,0)*ts; d.scale = 1 + Math.sin(num(d.t)*2.6)*0.22
        } else if (k === 'crab') {
          e.x += num(e.vx,0)*ts*0.98; e.y += Math.sin(num(d.t)*2.2)*1.0
        }

        // enemy shooting: a bit slower
        if (!flag(e.data?.bullet)) {
          const shootable = (k === 'squid' || k === 'crab' || k === 'manta')
          if (shootable && frame.current % 42 === 0 && Math.random() < 0.16) {
            const lead = 14
            const dx = (player.current.x + player.current.vx * lead) - e.x
            const dy = (player.current.y + player.current.vy * lead) - e.y
            const dlen = Math.max(0.001, Math.hypot(dx, dy))
            const speed = 3.6 + stage * 0.06
            enemiesRef.current.push({
              id: id(), x: e.x, y: e.y, w: 14, h: 8,
              vx: (dx / dlen) * speed, vy: (dy / dlen) * speed,
              type: 'enemy', hp: 1, data: { bullet: true, tint: '#fb7185' }
            } as any)
          }
        }
      }

      /* boss */
      if(bossRef.current){
        const b=bossRef.current, d=ensureData(b)
        b.x+=-0.9*ts; d.t=num(d.t,0)+0.02; d.aura=0.8+0.2*Math.sin(frame.current*0.08)
        b.y=H.current/2+Math.sin(num(d.t))*(72+10*stage)
        // friendly sea-dragon patterns
        if(frame.current%Math.max(16,40-stage*2)===0){
          for(let i=-1;i<=1;i++){
            const a = Math.sin(num(d.t)+i)*0.4
            enemiesRef.current.push({id:id(),x:b.x-60,y:b.y+i*20,w:18,h:6,vx:Math.cos(Math.PI+a)* (4.0+stage*0.12),vy:Math.sin(Math.PI+a)*1.1,type:'enemy',hp:1,data:{bullet:true,boss:'spear'}} as any)
          }
        }
        if(frame.current%64===0){
          const n=10; for(let i=0;i<n;i++){
            const ang=i*(Math.PI*2/n)
            enemiesRef.current.push({id:id(),x:b.x-40,y:b.y,w:10,h:10,vx:Math.cos(ang)*(-3.1-stage*0.07),vy:Math.sin(ang)*2.0,type:'enemy',hp:1,data:{bullet:true,boss:'ring'}} as any)
          }
        }
        if(frame.current%54===0){
          const vy=Math.sin(num(d.t)+Math.random())*2.3
          enemiesRef.current.push({id:id(),x:b.x-70,y:b.y,w:24,h:24,vx:-(2.9+stage*0.14),vy,type:'enemy',hp:1,data:{bullet:true,boss:'flame'}} as any)
        }
        if(b.x<W.current-230) b.x=W.current-230
      }
      for (const e of enemiesRef.current) if (flag(e.data?.bullet)) {
        e.x += num(e.vx, 0) * ts; e.y += num(e.vy, 0) * ts
      }

      /* collisions */
      for(const b of bulletsRef.current){
        for(const e of enemiesRef.current){
          if(flag(e.data?.bullet)) continue
          if(aabb(b,e)){
            const dmg=num(b.data?.dmg,1); (e as any).hp=num(e.hp,1)-dmg
            particlesRef.current.push(...explode(e.x,e.y,colorForEnemy(asEnemyKind(text(e.data?.kind,'jelly')))))
            const bd=ensureData(b); let pierce=num(bd.pierce,0)
            if(pierce>0) bd.pierce=pierce-1; else (b as any).x=W.current+9999
            if(num(e.hp,0)<=0){
              if(!mute) synth.bonus(); enemiesKilled.current++; killsSincePower.current++
              setScore(s=>s+10); killStreak.current++; (e as any).x=-9999
              for(let i=0;i<Math.floor(rnd(3,6));i++){
                xpOrbsRef.current.push({id:id(),x:e.x,y:e.y, vx:rnd(-1.2,1.2),vy:rnd(-1.2,1.2), life:240})
              }
            }
          }
        }
        if(bossRef.current && aabb(b,bossRef.current)){
          const dmg=num(b.data?.dmg,1); (bossRef.current as any).hp=num(bossRef.current.hp,1)-dmg
          particlesRef.current.push(...explode(bossRef.current.x,bossRef.current.y,'#a78bfa',18))
          const bd=ensureData(b); let pierce=num(bd.pierce,0)
          if(pierce>0) bd.pierce=pierce-1; else (b as any).x=W.current+9999
          if(num(bossRef.current.hp,0)<=0){
            if(!mute) synth.power(); setScore(s=>s+500)
            particlesRef.current.push(...explode(bossRef.current.x,bossRef.current.y,'#a78bfa',46))
            bossRef.current=null; setBossActive(false); setStage(s=>s+1)
            lvl.current=makeLevel(stage+1)
            drones.current.push({phase:Math.random()*Math.PI*2})
            for(let k=0;k<6;k++)
              powerupsRef.current.push({id:id(),x:W.current-260+k*44,y:rnd(PADDING+80,H.current-PADDING-80),kind:(Math.random()<0.85?'weapon':'drone'),payload:pickWeaponWeighted(stage+1)})
          }
        }
      }

      /* player touch barrier (mythic) */
      if (barrierMs.current > 0) {
        barrierMs.current -= 16
        const r = player.current.radius + 40
        for (const e of enemiesRef.current) {
          if (flag(e.data?.bullet)) continue
          const dx = e.x - player.current.x, dy = e.y - player.current.y
          if (dx*dx + dy*dy < (r*r)) {
            ;(e as any).hp = num((e as any).hp,1) - 1
            if (num((e as any).hp,0) <= 0) (e as any).x = -9999
          }
        }
      }

      /* familiars (mythic) */
      if (helpersMs.current > 0) {
        helpersMs.current -= 16
        if (!helpersRef.current.length) {
          helpersRef.current = [
            {id:id(),x:0,y:0,phase:0},
            {id:id(),x:0,y:0,phase:Math.PI*2/3},
            {id:id(),x:0,y:0,phase:Math.PI*4/3},
          ]
        }
        for (const h of helpersRef.current) {
          h.phase += 0.05*ts
          h.x = player.current.x + Math.cos(h.phase)*48
          h.y = player.current.y + Math.sin(h.phase)*48
          if (frame.current%26===0){
            bulletsRef.current.push(bullet(h.x, h.y, 7, 7, Math.cos(aimAngle.current)*8, Math.sin(aimAngle.current)*8, 'blaster'))
            if(!mute) synth.shoot()
          }
        }
      } else helpersRef.current = []

      /* twin (mythic) mirrors fire */
      if (twinMs.current > 0) {
        twinMs.current -= 16
        if (!twinRef.current) twinRef.current = {x:player.current.x+24,y:player.current.y-24,phase:0}
        twinRef.current.x = lerp(twinRef.current.x, player.current.x+24, 0.15)
        twinRef.current.y = lerp(twinRef.current.y, player.current.y-24, 0.15)
        if (frame.current-lastFire.current>8 && (fire || touchFiring.current)) {
          bulletsRef.current.push(bullet(twinRef.current.x, twinRef.current.y, 8, 4, Math.cos(aimAngle.current)*8, Math.sin(aimAngle.current)*8, 'blaster'))
        }
      } else twinRef.current = null

      /* pick-ups */
      for(const pu of powerupsRef.current){
        const box={x:pu.x,y:pu.y,w:28,h:28}
        const pb = {x:player.current.x,y:player.current.y,w:player.current.radius*2,h:player.current.radius*2} as any
        if(aabb(pb, box as any)){
          (pu as any).x=-9999; boostsCollected.current++
          if(pu.kind==='shield') player.current.shieldMs=3600
          if(pu.kind==='speed'){ player.current.maxSpeed=Math.min(12.5,player.current.maxSpeed+0.8); rapidMs.current=5200 }
          if(pu.kind==='heal'){ player.current.hp=Math.min(MAX_LIVES,player.current.hp+1); recalcTargetRadius() }
          if(pu.kind==='weapon'&&pu.payload){ const target=WEAPON_TIER.indexOf(asWeaponId(pu.payload)); if(target>weaponLevel.current) weaponLevel.current=target; rapidMs.current=5200 }
          if(pu.kind==='drone') drones.current.push({phase:Math.random()*Math.PI*2})
          if(pu.kind==='haste') hasteMs.current=4200
          if(pu.kind==='barrier') barrierMs.current = 6500
          if(pu.kind==='twin')    twinMs.current = 8000
          if(pu.kind==='familiars') helpersMs.current = 9000
          particlesRef.current.push(...explode(player.current.x,player.current.y, pu.kind==='haste'?'#f87171':'#fde047',18))
          if(!mute) (pu.kind==='haste')? synth.hit(): synth.power()
        }
      }

      /* XP orbs */
      for(const o of xpOrbsRef.current){
        const dx=player.current.x-o.x, dy=player.current.y-o.y
        const d=Math.max(0.001, Math.hypot(dx,dy))
        const pull=0.06; o.vx+=dx/d*pull; o.vy+=dy/d*pull
        o.x+=o.vx; o.y+=o.vy; o.life-=1
        if(d<18){ xp.current+=4; o.life=0; particlesRef.current.push(spark(player.current.x,player.current.y,'#fde047',18,3)); if(!mute) synth.bonus() }
      }
      xpOrbsRef.current = xpOrbsRef.current.filter(o=>o.life>0)

      /* level ups */
      let didLevelUp = false
      while(xp.current >= xpToNext.current){
        xp.current -= xpToNext.current
        xpToNext.current = Math.floor(xpToNext.current * 1.35)
        avatarHue.current = (avatarHue.current + 28) % 360
        playerLevel.current += 1
        didLevelUp = true
        if(weaponLevel.current < WEAPON_TIER.length-1) weaponLevel.current++
        for(let i=0;i<24;i++){
          particlesRef.current.push({ id:id(), x:player.current.x+rnd(-40,40), y:player.current.y-120+rnd(-20,20),
            w:3,h:3,vx:rnd(-1,1),vy:rnd(1.2,2.2), type:'spark', data:{life:24,color:`hsl(${avatarHue.current},90%,60%)`} } as any)
        }
        if(!mute) synth.power()
      }

      /* particles + bg */
      for (const sp of particlesRef.current) {
        const d = ensureData(sp)
        ;(sp as any).x += num((sp as any).vx, 0)
        ;(sp as any).y += num((sp as any).vy, 0)
        d.life = num(d.life, 0) - 1
      }
      particlesRef.current = particlesRef.current.filter(sp => num(sp.data?.life, 0) > 0)
      for(const bb of bubblesRef.current){ bb.y-=bb.v; if(bb.y<-10){ bb.x=rnd(0,W.current); bb.y=H.current+rnd(10,80); bb.r=rnd(2,6); bb.v=rnd(0.4,1.0) } }

      // report progress
      props.onProgress?.(xp.current, xpToNext.current, playerLevel.current, didLevelUp)

      draw(ctx)
    }

    rafRef.current=requestAnimationFrame(loop)
    return ()=>{ if(rafRef.current) cancelAnimationFrame(rafRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[paused,mute,stage,ax,ay,fire,gameOver])

  const pickWeaponWeighted=(st:number):WeaponId=>{
    const bag:WeaponId[]=['blaster','blaster','spread','piercer']
    if(st>=2) bag.push('spread','piercer'); if(st>=3) bag.push('laser')
    if(st>=4) bag.push('rail'); if(st>=5) bag.push('orbitals'); if(st>=6) bag.push('nova')
    return bag[Math.floor(Math.random()*bag.length)]
  }
  const pickEnemyKind=(st:number):EnemyKind=>{
    const bag:EnemyKind[]=['jelly','squid','manta','puffer']; if(st>=2) bag.push('nautilus'); if(st>=3) bag.push('crab')
    return bag[Math.floor(Math.random()*bag.length)]
  }
  const colorForEnemy=(k:EnemyKind):string =>
    k==='jelly'?'#67e8f9': k==='squid'?'#f472b6': k==='manta'?'#93c5fd':
    k==='nautilus'?'#fbbf24': k==='puffer'?'#34d399':'#fca5a5'

  const softReset=()=>{
    setGameOver(false)
    player.current={x:140,y:360,vx:0,vy:0,maxSpeed:7.5,radius:BASE_R,hp:6,shieldMs:0,weapon:'blaster'}
    weaponLevel.current=0; rapidMs.current=0; hasteMs.current=0; drones.current=[]
    particlesRef.current=[]; enemiesRef.current=[]; powerupsRef.current=[]; bossRef.current=null
    lvl.current=makeLevel(stage); spawns.current=0; hitFlash.current=0; dmgBounce.current=0; shake.current=0; killStreak.current=0
    setScore(0); enemiesKilled.current=0; boostsCollected.current=0
    xp.current=0; xpToNext.current=40; playerLevel.current=1; avatarHue.current=38
    killsSincePower.current=0; killsNeeded.current=10; xpOrbsRef.current=[]
    barrierMs.current=0; twinMs.current=0; helpersMs.current=0
  }

  function draw(ctx:CanvasRenderingContext2D){
    const w=W.current,h=H.current
    const g=ctx.createLinearGradient(0,0,0,h)
    g.addColorStop(0,'#0ea5e9'); g.addColorStop(1,'#312e81')
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h)

    // soft light bands
    ctx.globalAlpha=0.16
    for(let i=0;i<5;i++){
      const y=(Math.sin((frame.current*0.008)+(i*1.3))*0.5+0.5)*h
      const grad=ctx.createLinearGradient(0,y-60,0,y+60)
      grad.addColorStop(0,'rgba(255,255,255,0)')
      grad.addColorStop(0.5,'rgba(255,255,255,0.45)')
      grad.addColorStop(1,'rgba(255,255,255,0)')
      ctx.fillStyle=grad; ctx.fillRect(0,y-60,w,120)
    }
    ctx.globalAlpha=1
    if(hitFlash.current>0){ ctx.fillStyle=`rgba(239,68,68,${0.14+0.08*Math.sin(frame.current*0.5)})`; ctx.fillRect(0,0,w,h) }
    if(hasteMs.current>0){ ctx.fillStyle='rgba(244,63,94,0.06)'; ctx.fillRect(0,0,w,h) }

    // bubbles bg
    ctx.fillStyle='rgba(255,255,255,.3)'
    for(const b of bubblesRef.current){ ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill() }

    if(shake.current>0){ ctx.save(); ctx.translate(rnd(-shake.current,shake.current), rnd(-shake.current,shake.current)) }

    // particles
    for (const sp of particlesRef.current) {
      const d = ensureData(sp)
      ctx.fillStyle = text(d.color, '#ffffff')
      ctx.fillRect((sp as any).x, (sp as any).y, (sp as any).w, (sp as any).h)
    }

    // XP orbs
    for(const o of xpOrbsRef.current){
      ctx.fillStyle='hsl(50 100% 60% / .9)'
      ctx.beginPath(); ctx.arc(o.x,o.y,4,0,Math.PI*2); ctx.fill()
    }

    // powerups draw (mythics distinct)
    for (const pu of powerupsRef.current) {
      ctx.save(); ctx.translate(pu.x, pu.y)
      const mythic = (pu.kind==='barrier'||pu.kind==='twin'||pu.kind==='familiars')
      const isBad = pu.kind === 'haste'
      if (mythic) {
        ctx.strokeStyle='rgba(250,204,21,.95)'; ctx.lineWidth=3
        ctx.beginPath(); ctx.arc(0,0,14+Math.sin(frame.current*0.16+pu.id)*2,0,Math.PI*2); ctx.stroke()
        ctx.fillStyle='#fde047'; ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.fill()
      } else if (!isBad) {
        const pearl = ctx.createRadialGradient(0, 0, 2, 0, 0, 12)
        pearl.addColorStop(0, '#ffffff'); pearl.addColorStop(1, '#facc15')
        ctx.fillStyle = pearl; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill()
      } else {
        ctx.fillStyle = '#ef4444'
        ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(239,68,68,.9)'; ctx.lineWidth = 3
        ctx.beginPath(); ctx.arc(0, 0, 20 + Math.sin(frame.current * 0.16 + pu.id) * 3, 0, Math.PI * 2); ctx.stroke()
      }
      ctx.restore()
    }

    // enemies/bullets
    for(const e of enemiesRef.current){
      ctx.save(); ctx.translate((e as any).x,(e as any).y)
      const k=asEnemyKind(text((e as any).data?.kind,'jelly'))
      if (flag((e as any).data?.bullet)) {
        const kind = text((e as any).data?.boss,'')
        if (kind === 'spear') {
          ctx.fillStyle='#a78bfa'
          roundCapsule(ctx,-(e as any).w/2,-(e as any).h/2,(e as any).w,(e as any).h,3); ctx.fill()
          ctx.fillStyle='#fff'; ctx.fillRect(-(e as any).w/2, -1.5, (e as any).w*0.6, 3)
        } else if (kind === 'ring') {
          ctx.strokeStyle='rgba(250,204,21,.9)'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(0,0,8,0,Math.PI*2); ctx.stroke()
        } else if (kind === 'flame') {
          const grd=ctx.createRadialGradient(0,0,0,0,0,12)
          grd.addColorStop(0,'#f59e0b'); grd.addColorStop(1,'rgba(245,158,11,0)')
          ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(0,0,12,0,Math.PI*2); ctx.fill()
        } else {
          ctx.fillStyle = (e as any).data?.tint || 'rgba(251,113,133,.95)'
          roundCapsule(ctx, -(e as any).w/2, -(e as any).h/2, (e as any).w, (e as any).h, 3); ctx.fill()
        }
      } else {
        ctx.fillStyle = colorForEnemy(k); ctx.lineWidth=2
        if (k==='jelly') {
          roundCapsule(ctx,-(e as any).w*0.35,-(e as any).h*0.2,(e as any).w*0.7,(e as any).h*0.7,18); ctx.fill()
        } else if (k==='squid') {
          ctx.beginPath(); ctx.moveTo(-16,-12); ctx.quadraticCurveTo(0,-28,16,-12); ctx.quadraticCurveTo(20,8,0,22); ctx.quadraticCurveTo(-20,8,-16,-12); ctx.closePath(); ctx.fill()
        } else if (k==='manta') {
          ctx.beginPath(); ctx.moveTo(-34,0); ctx.quadraticCurveTo(0,-24,34,0); ctx.quadraticCurveTo(0,14,-34,0); ctx.closePath(); ctx.fill()
        } else if (k==='nautilus') {
          ctx.beginPath(); ctx.arc(0,0,18,0,Math.PI*2); for(let i=0;i<8;i++){ ctx.lineTo(Math.cos(i*.8)*i*2,Math.sin(i*.8)*i*2) } ctx.fill()
        } else if (k==='puffer') {
          ctx.beginPath(); ctx.arc(0,0,18,0,Math.PI*2); for(let i=0;i<10;i++){ const a=i*(Math.PI*2/10); ctx.moveTo(Math.cos(a)*12,Math.sin(a)*12); ctx.lineTo(Math.cos(a)*16,Math.sin(a)*16) } ctx.fill()
        } else if (k==='crab') {
          ctx.beginPath(); ctx.ellipse(0,0,22,14,0,0,Math.PI*2); ctx.fill()
        }
      }
      ctx.restore()
    }

    // player bullets
    for (const b of bulletsRef.current) {
      const k = text(b.data?.kind, 'blaster') as WeaponId
      const x = (b as any).x, y = (b as any).y, w = (b as any).w, h = (b as any).h
      const vx = num((b as any).vx, 8), vy = num((b as any).vy, 0)
      if (k === 'rail') {
        const ang = Math.atan2(vy, vx)
        ctx.save(); ctx.translate(x,y); ctx.rotate(ang)
        const grd = ctx.createLinearGradient(-w/2, 0, w/2, 0)
        grd.addColorStop(0, 'rgba(167,139,250,.2)'); grd.addColorStop(1, 'rgba(229,231,235,.95)')
        ctx.fillStyle = grd; ctx.fillRect(-w/2, -h/2, w, h); ctx.restore()
      } else {
        drawSeaDragonBullet(ctx, x, y, Math.max(10, w), Math.max(6, h), vx, vy)
      }
    }

    // player + mythic visuals
    const p=player.current
    const glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,36)
    glow.addColorStop(0,`hsla(${avatarHue.current},95%,75%,.95)`); glow.addColorStop(1,'rgba(254,240,138,0)')
    ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(p.x,p.y,36,0,Math.PI*2); ctx.fill()
    ctx.fillStyle= hitFlash.current>0 ? '#fecaca' : `hsl(${avatarHue.current},70%,85%)`
    const sx=p.radius*(1+dmgBounce.current*0.18), sy=p.radius*(1-dmgBounce.current*0.12)
    roundCapsule(ctx,p.x-sx*0.45,p.y-sy*0.3,sx*0.9,sy*1.2,8); ctx.fill()
    ctx.beginPath(); ctx.arc(p.x,p.y-sy*0.8,sx*0.45,0,Math.PI*2); ctx.fill()
    if(player.current.shieldMs>0){ ctx.strokeStyle='rgba(34,211,238,.9)'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(p.x,p.y,p.radius+10+Math.sin(frame.current*0.2)*2,0,Math.PI*2); ctx.stroke() }
    if(barrierMs.current>0){ ctx.strokeStyle='rgba(253,224,71,.85)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(p.x,p.y,p.radius+40,0,Math.PI*2); ctx.stroke() }
    if(twinRef.current){ ctx.fillStyle='rgba(255,255,255,.45)'; roundCapsule(ctx,twinRef.current.x-10,twinRef.current.y-8,20,30,8); ctx.fill() }

    if(bossRef.current){ drawSeaDragon(ctx, bossRef.current.x, bossRef.current.y, frame.current*0.04) }

    if(shake.current>0){ ctx.restore() }

    // HUD (bilingual)
    const L = props.lang === 'he'
      ? { score:'ניקוד', stage:'שלב', boss:'בוס', weapon:'נשק', fell:'נפלת במעמקים…', again:'לחצו רווח / אנטר כדי לשחק שוב', defeated:'אויבים שהובסו', boosts:'בוסטרים שנאספו' }
      : { score:'Score', stage:'Stage', boss:'Boss', weapon:'Weapon', fell:'You fell into the depths…', again:'Press Space / Enter to play again', defeated:'Enemies defeated', boosts:'Boosters collected' }

    ctx.fillStyle='#fff'; ctx.font='800 18px system-ui'; ctx.textAlign='right'
    ctx.fillText(`${L.score} ${score}`, w-12, 26)
    ctx.fillText(`${L.stage} ${stage}${bossRef.current?' • '+L.boss:''}`, w-12, 48)
    ctx.fillText(`${L.weapon} ${p.weapon.toUpperCase()}`, w-12, 70)

    // lives
    ctx.textAlign='start'
    for(let i=0;i<MAX_LIVES;i++){
      const x=12+i*20,y=26
      ctx.fillStyle=i<p.hp? '#fde68a' : 'rgba(255,255,255,.18)'
      ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill()
    }

    if(gameOver){
      drawOverlay(ctx, w, h, L.fell,
        [`${L.score}: ${score}`, `${L.defeated}: ${enemiesKilled.current}`, `${L.boosts}: ${boostsCollected.current}`],
        L.again)
    }

    // draw joystick feedback on canvas (subtle)
    if (moveOrigin.current) {
      ctx.strokeStyle='rgba(255,255,255,.25)'; ctx.lineWidth=2
      ctx.beginPath(); ctx.arc(moveOrigin.current.x, moveOrigin.current.y, 70, 0, Math.PI*2); ctx.stroke()
    }
    if (aimOrigin.current) {
      ctx.strokeStyle='rgba(250,204,21,.25)'; ctx.lineWidth=2
      ctx.beginPath(); ctx.arc(aimOrigin.current.x, aimOrigin.current.y, 70, 0, Math.PI*2); ctx.stroke()
    }
  }

  function drawOverlay(ctx:CanvasRenderingContext2D,w:number,h:number,title:string,lines:string[],cta:string){
    ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,0,w,h)
    ctx.textAlign='center'; ctx.fillStyle='#ffffff'
    ctx.font='900 40px system-ui'; ctx.fillText(title, w/2, h/2-120)
    ctx.font='700 18px system-ui'
    let y=h/2-70; for(const ln of lines){ ctx.fillText(ln, w/2, y); y+=28 }
    ctx.font='800 18px system-ui'; ctx.fillText(cta, w/2, y+26)
    ctx.textAlign='start'
  }

  return (
    <div className="game" dir={props.lang==='he'?'rtl':'ltr'}>
      {/* visual joystick halos (visible on web and phone) */}
      <div className="joy left" />
      <div className="joy right" />
      <canvas className="canvas" ref={canvasRef} onPointerDown={()=>{ if (gameOver) softReset() }} />
    </div>
  )
}
