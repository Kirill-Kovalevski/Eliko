/* FULL corrected Game.tsx */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Entity, PlayerState, WeaponId, PowerUpKind } from './types'
import { clamp, lerp, rnd, id, aabb } from './utils'
import { useInput } from './useInput'
import { synth } from './audio'
import { makeLevel, STAGE_LENGTH } from './levels'

/* ========= Types & small helpers ========= */
type EnemyKind = 'jelly'|'squid'|'manta'|'nautilus'|'puffer'|'crab'
type PU = Extract<PowerUpKind,'shield'|'speed'|'heal'|'weapon'|'drone'|'haste'>

const WEAPON_TIER: Readonly<WeaponId[]> =
  ['blaster','spread','piercer','laser','rail','orbitals','nova'] as const

const GOOD_POOL: PU[] = ['shield','speed','heal','weapon','drone']
const BAD_ONLY:   PU[] = ['haste']
const PADDING = 14
const BASE_R  = 26
const MAX_LIVES = 6

const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const flag = (v: any) => v === true
const text = (v: any, d = '') => (typeof v === 'string' ? v : d)

const asWeaponId = (x: unknown): WeaponId =>
  (WEAPON_TIER as readonly string[]).includes(String(x)) ? (x as WeaponId) : 'blaster'
const asEnemyKind = (x: unknown): EnemyKind => {
  const bag = ['jelly','squid','manta','nautilus','puffer','crab']
  return (bag as readonly string[]).includes(String(x)) ? (x as EnemyKind) : 'jelly'
}
const ensureData = <T extends { data?: Record<string, any> }>(o: T) =>
  (o.data ??= {} as Record<string, any>)

/* ========= Weapons & entity factories ========= */
const WEAPONS: Record<WeaponId,
  { gap:number; color:string; sfx:()=>void; onFire:(p:PlayerState)=>Entity[] }
> = {
  blaster:{ gap:8,  color:'#f8fafc', sfx:()=>synth.shoot(), onFire:(p)=>[bullet(p.x+18,p.y,8,4,9,'blaster')]},
  spread: { gap:14, color:'#22d3ee', sfx:()=>synth.spread(), onFire:(p)=>[
    bullet(p.x+18,p.y,8,4,7,'spread',{dy:-0.55}),
    bullet(p.x+18,p.y,8,4,7,'spread',{dy:0}),
    bullet(p.x+18,p.y,8,4,7,'spread',{dy:+0.55}),
  ]},
  piercer:{ gap:16, color:'#a78bfa', sfx:()=>synth.pierce(), onFire:(p)=>[bullet(p.x+20,p.y,14,5,10,'piercer',{pierce:3})]},
  laser:  { gap:22, color:'#a78bfa', sfx:()=>synth.laser(),  onFire:(p)=>[bullet(p.x+26,p.y,18,6,12,'laser',{pierce:6,dmg:2})]},
  rail:   { gap:34, color:'#e5e7eb', sfx:()=>synth.rail(),   onFire:(p)=>[bullet(p.x+24,p.y,4,72,16,'rail',{pierce:8,dmg:3})]},
  orbitals:{gap:16, color:'#34d399', sfx:()=>synth.shoot(),  onFire:(p)=>[orbital(p,0),orbital(p,Math.PI)]},
  nova:   { gap:36, color:'#fde047', sfx:()=>synth.nova(),   onFire:(p)=>nova(p)},
}

function bullet(x:number,y:number,w:number,h:number,vx:number,kind:WeaponId|string,data:Record<string,unknown>={}):Entity{
  return { id:id(), x,y,w,h, vx, type:'bullet', data:{kind,...data} } as any
}
function spark(x:number,y:number,c:string,life=26,sz=3):Entity{
  return { id:id(), x,y,w:sz,h:sz, vx:rnd(-2,2), vy:rnd(-2,2), type:'spark', data:{life,color:c} } as any
}
function explode(x:number,y:number,c:string,n=16){ const out:Entity[]=[]; for(let i=0;i<n;i++) out.push(spark(x,y,c,18+Math.random()*16,2+Math.random()*2)); return out }
function orbital(p:PlayerState,phase:number){ return bullet(p.x+18,p.y,8,8,7,'orbitals',{orb:true,phase}) }
function nova(p:PlayerState){ const out:Entity[]=[]; for(let i=-3;i<=3;i++) out.push(bullet(p.x+12,p.y,8,8,7,'nova',{dy:i*0.6,pierce:2})); return out }

function enemy(kind:EnemyKind,x:number,y:number,speed:number,hp=1,heavy=false):Entity{
  const sizes:Record<EnemyKind,{w:number;h:number}> = {
    jelly:{w:40,h:40}, squid:{w:46,h:52}, manta:{w:68,h:36}, nautilus:{w:48,h:48}, puffer:{w:38,h:38}, crab:{w:52,h:32}
  }
  const s=sizes[kind]; return { id:id(), x,y,w:s.w,h:s.h, vx:-speed, type:'enemy', hp, data:{kind,t:0,heavy} } as any
}
function boss(x:number,y:number,hp:number):Entity{
  return { id:id(), x,y,w:200,h:140, vx:-1.05, type:'boss', hp, data:{phase:1,t:0,aura:1} } as any
}

/* ========= Drawing helpers ========= */
function wavyTentacle(ctx:CanvasRenderingContext2D,x:number,y:number,length:number,segments:number,amplitude=10,color='#6b21a8'){
  ctx.save(); ctx.beginPath(); ctx.moveTo(x,y)
  for(let i=0;i<=segments;i++){ const t=i/segments; ctx.lineTo(x+t*length, y+Math.sin(t*Math.PI*2)*amplitude*(1-t)) }
  ctx.strokeStyle=color; ctx.lineWidth=4; ctx.shadowBlur=12; ctx.shadowColor=color; ctx.stroke(); ctx.restore()
}
function fireTentacle(ctx:CanvasRenderingContext2D,x:number,y:number,length:number,segments:number,amplitude=12){
  wavyTentacle(ctx,x,y,length,segments,amplitude,'#ef4444'); ctx.strokeStyle='#f97316'; ctx.shadowBlur=20; ctx.shadowColor='#f59e0b'; ctx.stroke()
}
function goldTentacle(ctx:CanvasRenderingContext2D,x:number,y:number,length:number,segments:number,amplitude=8){
  wavyTentacle(ctx,x,y,length,segments,amplitude,'#facc15'); ctx.strokeStyle='#fde047'; ctx.shadowBlur=18; ctx.shadowColor='#fef08a'; ctx.stroke()
}
function oceanTentacle(ctx:CanvasRenderingContext2D,x:number,y:number,length:number,segments:number,amplitude=14){
  wavyTentacle(ctx,x,y,length,segments,amplitude,'#3b82f6'); ctx.strokeStyle='#06b6d4'; ctx.shadowBlur=22; ctx.shadowColor='#67e8f9'; ctx.stroke()
}
function roundCapsule(ctx:CanvasRenderingContext2D, x:number, y:number, w:number, h:number, r:number){
  const rr = Math.min(r, h/2); ctx.beginPath(); ctx.moveTo(x+rr, y); ctx.lineTo(x+w-rr, y)
  ctx.arc(x+w-rr, y+rr, rr, -Math.PI/2, Math.PI/2); ctx.lineTo(x+rr, y+h); ctx.arc(x+rr, y+rr, rr, Math.PI/2, -Math.PI/2); ctx.closePath()
}
function drawSeaDragonBullet(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, vx: number, dy: number){
  const ang = Math.atan2(dy || 0, Math.max(0.01, vx || 8))
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
function roundedRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
  const rr=Math.min(r,w/2,h/2); ctx.beginPath()
  ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr)
  ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr); ctx.closePath()
}
function roundedBlob(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){ roundedRect(ctx,x,y,w,h,r) }
function squidShape(ctx:CanvasRenderingContext2D,w:number,h:number){
  ctx.beginPath(); ctx.moveTo(-w*0.2,-h*0.3); ctx.quadraticCurveTo(0,-h*0.6,w*0.2,-h*0.3)
  ctx.quadraticCurveTo(w*0.3,0,0,h*0.4); ctx.quadraticCurveTo(-w*0.3,0,-w*0.2,-h*0.3); ctx.closePath()
}
function mantaShape(ctx:CanvasRenderingContext2D,w:number,h:number){
  ctx.beginPath(); ctx.moveTo(-w*0.5,0); ctx.quadraticCurveTo(0,-h*0.8,w*0.5,0); ctx.quadraticCurveTo(0,h*0.4,-w*0.5,0); ctx.closePath()
}
function nautilusShape(ctx:CanvasRenderingContext2D,w:number){
  ctx.beginPath(); ctx.arc(0,0,w*0.35,0,Math.PI*2); ctx.moveTo(0,0); for(let i=0;i<8;i++){ ctx.lineTo(Math.cos(i*.8)*i*2,Math.sin(i*.8)*i*2) }
}
function pufferShape(ctx:CanvasRenderingContext2D,w:number,h:number){
  ctx.beginPath(); ctx.arc(0,0,Math.max(w,h)/2,0,Math.PI*2)
  for(let i=0;i<10;i++){ const a=i*(Math.PI*2/10); ctx.moveTo(Math.cos(a)*w*0.6,Math.sin(a)*h*0.6); ctx.lineTo(Math.cos(a)*w*0.8,Math.sin(a)*h*0.8) }
}
function crabShape(ctx:CanvasRenderingContext2D,w:number,h:number){
  ctx.beginPath(); ctx.ellipse(0,0,w*0.5,h*0.35,0,0,Math.PI*2)
  for(let i=-2;i<=2;i++){ ctx.moveTo(-w*0.3+i*8,h*0.2); ctx.lineTo(-w*0.3+i*8,h*0.35) }
}

/* ========= Component ========= */
export default function Game(){
  const canvasRef = useRef<HTMLCanvasElement|null>(null)
  const rafRef = useRef<number|null>(null)
  const frame = useRef(0)

  const [paused,setPaused] = useState(false)
  const [gameOver,setGameOver] = useState(false)
  const [showHelp,setShowHelp] = useState(true)
  const [score,setScore] = useState(0)
  const [mute,setMute] = useState(false)
  const [stage,setStage] = useState(1)
  const [bossActive,setBossActive] = useState(false)

  // Input: keyboard + our touch overrides
  const { fire, ax, ay } = useInput()

  // Canvas sizing
  const W = useRef(760), H = useRef(980), dpr = useRef(1)

  // Game state refs
  const level = useRef(makeLevel(stage))
  const spawns = useRef(0)
  const player = useRef<PlayerState>({ x:140, y:360, vx:0, vy:0, maxSpeed:7.5, radius:BASE_R, hp:6, shieldMs:0, weapon:'blaster' })
  const targetRadius = useRef(BASE_R)
  const weaponLevel = useRef(0)

  const xp = useRef(0)
  const xpToNext = useRef(40)
  const avatarHue = useRef(38)
  const xpOrbsRef = useRef<Array<{id:number;x:number;y:number;vx:number;vy:number;life:number}>>([])

  const bulletsRef = useRef<Entity[]>([])
  const enemiesRef = useRef<Entity[]>([])
  const powerupsRef = useRef<Array<{id:number;x:number;y:number;kind:PU;payload?:WeaponId}>>([])
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

  // === Mobile twin-stick refs (now INSIDE the component, as required) ===
  const moveTouchId = useRef<number|null>(null)
  const aimTouchId  = useRef<number|null>(null)
  const moveOrigin  = useRef<{x:number;y:number}|null>(null)
  const aimOrigin   = useRef<{x:number;y:number}|null>(null)
  const touchAx = useRef(0), touchAy = useRef(0)
  const aimAngle = useRef(0)
  const touchFiring = useRef(false)

  // Tutorial (light overlay)
  const tutorialTimer = useRef(0)

  /* ======== Layout / resize ======== */
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

  /* ======== Keyboard toggles ======== */
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const k=e.key.toLowerCase()
      if(k==='p') setPaused(p=>!p)
      if(k==='m'){ setMute(m=>!m); synth.mute(!mute) }
      if(showHelp && (k===' '||k==='enter')) setShowHelp(false)
      if(gameOver && (k===' '||k==='enter')) softReset()
    }
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[mute,showHelp,gameOver])

  /* ======== Touch & mouse aim handlers ======== */
  useEffect(()=>{
    const c = canvasRef.current!
    const getLocal = (ev: Touch | MouseEvent) => {
      const r = c.getBoundingClientRect()
      return { x: (ev.clientX - r.left), y: (ev.clientY - r.top) }
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
          const dx = local.x - moveOrigin.current.x
          const dy = local.y - moveOrigin.current.y
          const len = Math.max(1, Math.hypot(dx, dy))
          const mag = Math.min(1, len / 60) // joystick radius
          touchAx.current = (dx / len) * mag
          touchAy.current = (dy / len) * mag
        }
        if (t.identifier === aimTouchId.current) {
          const local = getLocal(t as any)
          const dx = local.x - player.current.x
          const dy = local.y - player.current.y
          aimAngle.current = Math.atan2(dy, dx)
          touchFiring.current = true
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
          touchFiring.current = false
        }
      }
    }
    const onMouseMove = (e: MouseEvent) => {
      const local = getLocal(e)
      const dx = local.x - player.current.x
      const dy = local.y - player.current.y
      aimAngle.current = Math.atan2(dy, dx)
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

  /* ======== Main game loop ======== */
  useEffect(()=>{
    const c=canvasRef.current!, ctx=c.getContext('2d')!
    if(!bubblesRef.current.length){
      for(let i=0;i<48;i++) bubblesRef.current.push({x:rnd(0,W.current),y:rnd(0,H.current),r:rnd(2,6),v:rnd(0.4,1.2)})
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

      // tutorial auto-advance (~2.2s per step)
      if (showHelp && frame.current < 600) {
        tutorialTimer.current += 16
      }

      const ts=(hasteMs.current>0?1.35:1)
      if(hasteMs.current>0) hasteMs.current-=16
      if(rapidMs.current>0) rapidMs.current-=16
      if(hitFlash.current>0) hitFlash.current-=1
      if(dmgBounce.current>0) dmgBounce.current=Math.max(0,dmgBounce.current-0.08)

      const accel=0.2

      // Axes: keyboard base
      let axEff = ax
      let ayEff = ay
      // If phone joystick active, override keyboard axes
      if (moveTouchId.current !== null) {
        axEff = touchAx.current
        ayEff = touchAy.current
      }

      player.current.vx=lerp(player.current.vx, axEff*player.current.maxSpeed,accel)
      player.current.vy=lerp(player.current.vy, ayEff*player.current.maxSpeed,accel)
      player.current.x=clamp(player.current.x+player.current.vx, PADDING+player.current.radius, W.current-PADDING-player.current.radius)
      player.current.y=clamp(player.current.y+player.current.vy, PADDING+player.current.radius, H.current-PADDING-player.current.radius)

      const weaponId=WEAPON_TIER[Math.min(weaponLevel.current,WEAPON_TIER.length-1)]
      player.current.weapon=weaponId

      const isFiring = fire || weaponId === 'orbitals' || touchFiring.current

      player.current.radius=lerp(player.current.radius,targetRadius.current,0.25)*(1+dmgBounce.current*0.2)
      player.current.radius=Math.max(12,player.current.radius)
      if(player.current.shieldMs>0) player.current.shieldMs-=16
      if(shake.current>0) shake.current=Math.max(0,shake.current-0.8)

      // drones orbit & fire
      for(const d of drones.current){
        d.phase+=0.055*ts
        if(frame.current%22===0){
          bulletsRef.current.push(bullet(player.current.x+Math.cos(d.phase)*28,player.current.y+Math.sin(d.phase)*28,7,7,8,'blaster'))
          if(!mute) synth.shoot()
        }
      }

      // player fire cadence
      const config=WEAPONS[weaponId]
      const gapBoost=rapidMs.current>0?0.65:1
      const effectiveGap=Math.max(4,Math.floor(config.gap*gapBoost))
      if(isFiring && frame.current-lastFire.current>effectiveGap*ts){
        for(const b of config.onFire(player.current)) bulletsRef.current.push(b)
        lastFire.current=frame.current; if(!mute) config.sfx()
      }

      // orbitals follow
      for(const b of bulletsRef.current) if(flag(b.data?.orb)){
        const bd=ensureData(b); const ph=num(bd.phase,0)+0.14; bd.phase=ph; b.y=player.current.y+Math.sin(ph)*26; b.x+=7
      }

      // spawns
      const lv=level.current
      const spawnEvery=Math.max(12,Math.floor(lv.spawnEvery*(hasteMs.current>0?0.85:1)))
      if(!bossActive && frame.current%Math.floor(spawnEvery)===0){
        const y=rnd(PADDING+60,H.current-PADDING-60)
        const kind=asEnemyKind(pickEnemyKind(stage))
        const heavy=kind==='nautilus'||kind==='crab'
        const hp=heavy? lv.enemyHp+2 : (kind==='puffer'? lv.enemyHp+1 : lv.enemyHp)
        enemiesRef.current.push(enemy(kind,W.current+60,y,lv.speed*ts*1.05,hp,heavy))
        spawns.current++

        const roll=Math.random()
        if(roll<0.16+Math.min(0.18,killStreak.current*0.006)){
          const isBad=Math.random()<0.3
          const kindPU=(isBad?BAD_ONLY:GOOD_POOL)[Math.floor(Math.random()*(isBad?BAD_ONLY.length:GOOD_POOL.length))]
          powerupsRef.current.push({id:id(),x:W.current+50,y,kind:kindPU,payload:pickWeaponWeighted(stage)})
        }
      }

      if(!bossActive && spawns.current>=STAGE_LENGTH){
        bossRef.current=boss(W.current+200,H.current/2,lv.bossHp+80)
        setBossActive(true); spawns.current=0
      }

      // bullets move
      for(const sp of bulletsRef.current){ sp.x+=num(sp.vx,0)*ts; const ddy=num(sp.data?.dy,0); if(ddy) sp.y+=ddy*ts }
      bulletsRef.current=bulletsRef.current.filter(sp=>sp.x<W.current+140 && sp.y>-80 && sp.y<H.current+80)

      // enemies AI & shots
      for (const e of enemiesRef.current) {
        const d = ensureData(e)
        const k = asEnemyKind(text(d.kind,'jelly'))
        d.t = num(d.t,0) + 0.03*ts
        if (k === 'jelly') {
          e.x += num(e.vx,0)*ts*0.75; e.y += Math.sin(num(d.t)*2.0)*2.6
        } else if (k === 'squid') {
          e.x += num(e.vx,0)*ts*1.2;  e.y += Math.sin(num(d.t)*3.0)*1.8
        } else if (k === 'manta') {
          e.x += num(e.vx,0)*ts*1.05; e.y += Math.sin(num(d.t)*1.2)*3.2
        } else if (k === 'nautilus') {
          e.x += num(e.vx,0)*ts*0.9
          if (frame.current % 46 === 0) {
            const ang = num(d.t) * 3.14
            enemiesRef.current.push({ id:id(), x:e.x-20, y:e.y, w:20, h:20, vx:-4.4, vy:Math.sin(ang)*2.4, type:'enemy', hp:1, data:{ bullet:true } } as any)
          }
        } else if (k === 'puffer') {
          e.x += num(e.vx,0)*ts; d.scale = 1 + Math.sin(num(d.t)*3)*0.25
        } else if (k === 'crab') {
          e.x += num(e.vx,0)*ts*1.15; e.y += Math.sin(num(d.t)*2.6)*1.2
        }

        if (!flag(e.data?.bullet)) {
          const shootable = (k === 'squid' || k === 'crab' || k === 'manta')
          if (shootable && frame.current % 34 === 0 && Math.random() < 0.20) {
            const lead = 14
            const dx = (player.current.x + player.current.vx * lead) - e.x
            const dy = (player.current.y + player.current.vy * lead) - e.y
            const dlen = Math.max(0.001, Math.hypot(dx, dy))
            const speed = 4.0 + stage * 0.08
            enemiesRef.current.push({
              id: id(), x: e.x, y: e.y, w: 14, h: 8,
              vx: (dx / dlen) * speed, vy: (dy / dlen) * speed,
              type: 'enemy', hp: 1, data: { bullet: true, tint: '#fb7185' }
            } as any)
          }
        }
      }

      // boss patterns & bullets move
      if(bossRef.current){
        const b=bossRef.current, d=ensureData(b)
        b.x+=-1.05*ts; d.t=num(d.t,0)+0.02; d.aura=0.8+0.2*Math.sin(frame.current*0.08)
        b.y=H.current/2+Math.sin(num(d.t))*(82+12*stage)
        if(frame.current%Math.max(12,34-stage*2)===0){
          for(let i=-1;i<=1;i++){
            enemiesRef.current.push({id:id(),x:b.x-60,y:b.y+i*20,w:18,h:6,vx:-(4.6+stage*0.15),vy:i*0.6,type:'enemy',hp:1,data:{bullet:true,boss:'spear'}} as any)
          }
        }
        if(frame.current%64===0){
          const n=10; for(let i=0;i<n;i++){
            const ang=i*(Math.PI*2/n)
            enemiesRef.current.push({id:id(),x:b.x-40,y:b.y,w:10,h:10,vx:Math.cos(ang)*(-3.5-stage*0.08),vy:Math.sin(ang)*2.2,type:'enemy',hp:1,data:{bullet:true,boss:'ring'}} as any)
          }
        }
        if(frame.current%42===0){
          const vy=Math.sin(num(d.t)+Math.random())*2.8
          enemiesRef.current.push({id:id(),x:b.x-70,y:b.y,w:24,h:24,vx:-(3.2+stage*0.18),vy,type:'enemy',hp:1,data:{bullet:true,boss:'flame'}} as any)
        }
        if(b.x<W.current-230) b.x=W.current-230
      }
      for (const e of enemiesRef.current) if (flag(e.data?.bullet)) {
        e.x += num(e.vx, 0) * ts; e.y += num(e.vy, 0) * ts
      }

      // collisions: bullets vs enemies/boss
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
              if(killsSincePower.current>=killsNeeded.current){
                killsSincePower.current=0; killsNeeded.current += 5
                if(Math.random()<0.7 && weaponLevel.current<WEAPON_TIER.length-1){
                  weaponLevel.current++; if(!mute) synth.power()
                }
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
            level.current=makeLevel(stage+1)
            drones.current.push({phase:Math.random()*Math.PI*2})
            for(let k=0;k<6;k++)
              powerupsRef.current.push({id:id(),x:W.current-260+k*44,y:rnd(PADDING+80,H.current-PADDING-80),kind:(Math.random()<0.85?'weapon':'drone'),payload:pickWeaponWeighted(stage+1)})
          }
        }
      }

      // player collisions
      const pb = {x:player.current.x,y:player.current.y,w:player.current.radius*2,h:player.current.radius*2} as any
      for(const e of enemiesRef.current) if(aabb(pb,e)){ damagePlayer(flag(e.data?.heavy)?2:1); (e as any).x=-9999 }
      if(bossRef.current && aabb(pb,bossRef.current)) damagePlayer(2)

      // powerups collect
      for(const pu of powerupsRef.current){
        const box={x:pu.x,y:pu.y,w:28,h:28}
        if(aabb(pb, box as any)){
          (pu as any).x=-9999; boostsCollected.current++
          if(pu.kind==='shield') player.current.shieldMs=3600
          if(pu.kind==='speed'){ player.current.maxSpeed=Math.min(11.5,player.current.maxSpeed+0.6); rapidMs.current=5000 }
          if(pu.kind==='heal'){ player.current.hp=Math.min(MAX_LIVES,player.current.hp+1); recalcTargetRadius() }
          if(pu.kind==='weapon'&&pu.payload){ const target=WEAPON_TIER.indexOf(asWeaponId(pu.payload)); if(target>weaponLevel.current) weaponLevel.current=target; rapidMs.current=5000 }
          if(pu.kind==='drone') drones.current.push({phase:Math.random()*Math.PI*2})
          if(pu.kind==='haste') hasteMs.current=4000
          particlesRef.current.push(...explode(player.current.x,player.current.y, pu.kind==='haste'?'#f87171':'#fde047',16))
          if(!mute) (pu.kind==='haste')? synth.hit(): synth.power()
        }
      }

      // XP orbs
      for(const o of xpOrbsRef.current){
        const dx=player.current.x-o.x, dy=player.current.y-o.y
        const d=Math.max(0.001, Math.hypot(dx,dy))
        const pull=0.06; o.vx+=dx/d*pull; o.vy+=dy/d*pull
        o.x+=o.vx; o.y+=o.vy; o.life-=1
        if(d<18){ xp.current+=4; o.life=0; particlesRef.current.push(spark(player.current.x,player.current.y,'#fde047',18,3)); if(!mute) synth.bonus() }
      }
      xpOrbsRef.current = xpOrbsRef.current.filter(o=>o.life>0)

      // level ups
      while(xp.current >= xpToNext.current){
        xp.current -= xpToNext.current
        xpToNext.current = Math.floor(xpToNext.current * 1.35)
        avatarHue.current = (avatarHue.current + 28) % 360
        if(weaponLevel.current < WEAPON_TIER.length-1) weaponLevel.current++
        for(let i=0;i<24;i++){
          particlesRef.current.push({ id:id(), x:player.current.x+rnd(-40,40), y:player.current.y-120+rnd(-20,20),
            w:3,h:3,vx:rnd(-1,1),vy:rnd(1.2,2.2), type:'spark', data:{life:24,color:`hsl(${avatarHue.current},90%,60%)`} } as any)
        }
        if(!mute) synth.power()
      }

      // particle life
      for (const sp of particlesRef.current) {
        const d = ensureData(sp)
        ;(sp as any).x += num((sp as any).vx, 0)
        ;(sp as any).y += num((sp as any).vy, 0)
        d.life = num(d.life, 0) - 1
      }
      particlesRef.current = particlesRef.current.filter(sp => num(sp.data?.life, 0) > 0)

      // bubbles bg
      for(const bb of bubblesRef.current){ bb.y-=bb.v; if(bb.y<-10){ bb.x=rnd(0,W.current); bb.y=H.current+rnd(10,80); bb.r=rnd(2,6); bb.v=rnd(0.4,1.2) } }

      draw(ctx)
    }

    rafRef.current=requestAnimationFrame(loop)
    return ()=>{ if(rafRef.current) cancelAnimationFrame(rafRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[paused,mute,stage,ax,ay,fire,gameOver,showHelp])

  /* ======== Picks & colors ======== */
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

  /* ======== Reset ======== */
  const softReset=()=>{
    setGameOver(false); setShowHelp(true)
    player.current={x:140,y:360,vx:0,vy:0,maxSpeed:7.5,radius:BASE_R,hp:6,shieldMs:0,weapon:'blaster'}
    weaponLevel.current=0; rapidMs.current=0; hasteMs.current=0; drones.current=[]
    particlesRef.current=[]; enemiesRef.current=[]; powerupsRef.current=[]; bossRef.current=null
    level.current=makeLevel(stage); spawns.current=0; hitFlash.current=0; dmgBounce.current=0; shake.current=0; killStreak.current=0
    setScore(0); enemiesKilled.current=0; boostsCollected.current=0
    xp.current=0; xpToNext.current=40; avatarHue.current=38
    killsSincePower.current=0; killsNeeded.current=10; xpOrbsRef.current=[]
  }

  /* ======== Draw ======== */
  function draw(ctx:CanvasRenderingContext2D){
    const w=W.current,h=H.current
    const g=ctx.createLinearGradient(0,0,0,h)
    g.addColorStop(0,'#0ea5e9'); g.addColorStop(1,'#312e81')
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h)
    ctx.globalAlpha=0.16
    for(let i=0;i<5;i++){
      const y=(Math.sin((frame.current*0.008)+(i*1.3))*0.5+0.5)*h
      const grad=ctx.createLinearGradient(0,y-60,0,y+60)
      grad.addColorStop(0,'rgba(255,255,255,0)')
      grad.addColorStop(0.5,'rgba(255,255,255,0.45)')
      grad.addColorStop(1,'rgba(255,255,255,0)')
      ctx.fillStyle=grad; ctx.fillRect(0,y-60,w,120)

      // Tutorial overlay (first 10s)
      if (showHelp && frame.current < 600) {
        ctx.save()
        ctx.globalAlpha = 0.9
        ctx.fillStyle = "rgba(0,0,0,0.55)"
        ctx.fillRect(0, 0, W.current, H.current)
        ctx.globalAlpha = 1
        ctx.strokeStyle = "yellow"
        ctx.lineWidth = 6
        if (frame.current < 300) {
          ctx.beginPath()
          ctx.arc(player.current.x, player.current.y, player.current.radius*3, 0, Math.PI*2)
          ctx.stroke()
          ctx.fillStyle = "white"
          ctx.font = "24px Rubik, sans-serif"
          ctx.textAlign = "center"
          ctx.fillText("גרור כדי לזוז", player.current.x, player.current.y - 60)
        } else {
          ctx.beginPath()
          ctx.arc(player.current.x+50, player.current.y, 70, 0, Math.PI*2)
          ctx.stroke()
          ctx.fillStyle = "white"
          ctx.font = "24px Rubik, sans-serif"
          ctx.textAlign = "center"
          ctx.fillText("גע/י בצד ימין כדי לירות", W.current/2, player.current.y - 80)
        }
        ctx.restore()
      }
    }
    ctx.globalAlpha=1
    if(hitFlash.current>0){ ctx.fillStyle=`rgba(239,68,68,${0.14+0.08*Math.sin(frame.current*0.5)})`; ctx.fillRect(0,0,w,h) }
    if(hasteMs.current>0){ ctx.fillStyle='rgba(244,63,94,0.06)'; ctx.fillRect(0,0,w,h) }

    // bg bubbles
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

    // powerups
    for (const pu of powerupsRef.current) {
      ctx.save(); ctx.translate(pu.x, pu.y)
      const isBad = pu.kind === 'haste'
      if (!isBad) {
        const pearl = ctx.createRadialGradient(0, 0, 2, 0, 0, 12)
        pearl.addColorStop(0, '#ffffff'); pearl.addColorStop(1, '#facc15')
        ctx.fillStyle = pearl; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(250,204,21,.85)'
        ctx.lineWidth = 2 + Math.sin(frame.current * 0.2 + pu.id) * 1.2
        const r = 18 + Math.sin(frame.current * 0.16 + pu.id) * 3
        ctx.beginPath()
        for (let i = 0; i < 24; i++) {
          const a = i * (Math.PI * 2 / 24) + frame.current * 0.04
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
        }
        ctx.closePath(); ctx.stroke()
        goldTentacle(ctx, 0, 14, 22, 10, 5)
      } else {
        ctx.fillStyle = '#ef4444'
        ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(239,68,68,.9)'; ctx.lineWidth = 3
        ctx.beginPath(); ctx.arc(0, 0, 20 + Math.sin(frame.current * 0.16 + pu.id) * 3, 0, Math.PI * 2); ctx.stroke()
        fireTentacle(ctx, 0, 14, 22, 10, 6)
      }
      ctx.restore()
    }

    // enemies render
    for(const e of enemiesRef.current){
      ctx.save(); ctx.translate((e as any).x,(e as any).y)
      const k=asEnemyKind(text((e as any).data?.kind,'jelly'))
      if (flag((e as any).data?.bullet)) {
        const kind = text((e as any).data?.boss,'')
        if (kind === 'spear') {
          ctx.fillStyle='#a78bfa'
          roundedRect(ctx,-(e as any).w/2,-(e as any).h/2,(e as any).w,(e as any).h,3); ctx.fill()
          ctx.fillStyle='#fff'; ctx.fillRect(-(e as any).w/2, -1.5, (e as any).w*0.6, 3)
        } else if (kind === 'ring') {
          ctx.strokeStyle='rgba(250,204,21,.9)'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(0,0,8,0,Math.PI*2); ctx.stroke()
        } else if (kind === 'flame') {
          const grd=ctx.createRadialGradient(0,0,0,0,0,12)
          grd.addColorStop(0,'#f59e0b'); grd.addColorStop(1,'rgba(245,158,11,0)')
          ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(0,0,12,0,Math.PI*2); ctx.fill()
        } else {
          ctx.fillStyle = (e as any).data?.tint || 'rgba(251,113,133,.95)'
          roundedRect(ctx, -(e as any).w/2, -(e as any).h/2, (e as any).w, (e as any).h, 3); ctx.fill()
        }
      } else {
        ctx.fillStyle = colorForEnemy(k); ctx.strokeStyle='rgba(255,255,255,.25)'; ctx.lineWidth=2
        if (k==='jelly') {
          roundedBlob(ctx,-(e as any).w*0.35,-(e as any).h*0.2,(e as any).w*0.7,(e as any).h*0.7,18); ctx.fill()
          ctx.fillStyle='#0b1220'; ctx.beginPath(); ctx.arc(-6,-4,3,0,Math.PI*2); ctx.arc(6,-4,3,0,Math.PI*2); ctx.fill()
          for (let i=-2;i<=2;i++){
            oceanTentacle(ctx, i*5, (e as any).h*0.28, 18, 10, 6 + Math.sin((frame.current + i*8)*0.1)*2)
          }
        } else if (k==='squid') {
          squidShape(ctx,(e as any).w,(e as any).h); ctx.fill(); ctx.stroke()
          ctx.fillStyle='#0b1220'; ctx.beginPath(); ctx.arc(0,-10,3,0,Math.PI*2); ctx.fill()
        } else if (k==='manta') {
          mantaShape(ctx,(e as any).w,(e as any).h); ctx.fill()
          ctx.fillStyle='#0b1220'; ctx.beginPath(); ctx.arc(-10,-6,3,0,Math.PI*2); ctx.arc(10,-6,3,0,Math.PI*2); ctx.fill()
        } else if (k==='nautilus') {
          nautilusShape(ctx,(e as any).w); ctx.fill(); ctx.stroke()
          ctx.fillStyle='#0b1220'; ctx.beginPath(); ctx.arc(6,-4,3,0,Math.PI*2); ctx.fill()
        } else if (k==='puffer') {
          const sc=num((e as any).data?.scale,1); pufferShape(ctx,(e as any).w*sc,(e as any).h*sc); ctx.fill(); ctx.stroke()
          ctx.fillStyle='#0b1220'; ctx.beginPath(); ctx.arc(-5,-2,2.5,0,Math.PI*2); ctx.arc(5,-2,2.5,0,Math.PI*2); ctx.fill()
        } else if (k==='crab') {
          crabShape(ctx,(e as any).w,(e as any).h); ctx.fill()
          ctx.fillStyle='#0b1220'; ctx.beginPath(); ctx.arc(-8,-4,2.5,0,Math.PI*2); ctx.arc(8,-4,2.5,0,Math.PI*2); ctx.fill()
        }
      }
      ctx.restore()
    }

    // player bullets
    for (const b of bulletsRef.current) {
      const k = asWeaponId(text(b.data?.kind, 'blaster'))
      const x = (b as any).x, y = (b as any).y, w = (b as any).w, h = (b as any).h
      const vx = num((b as any).vx, 8), dy = num(b.data?.dy, 0)
      if (k === 'rail') {
        const grd = ctx.createLinearGradient(x - w/2, y, x + w/2, y)
        grd.addColorStop(0, 'rgba(167,139,250,.2)'); grd.addColorStop(1, 'rgba(229,231,235,.95)')
        ctx.fillStyle = grd; ctx.fillRect(Math.floor(x - w/2), Math.floor(y - h/2), w, h)
      } else {
        drawSeaDragonBullet(ctx, x, y, Math.max(10, w), Math.max(6, h), vx, dy)
      }
    }

    // player avatar
    const p=player.current
    const glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,36)
    glow.addColorStop(0,`hsla(${avatarHue.current},95%,75%,.95)`); glow.addColorStop(1,'rgba(254,240,138,0)')
    ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(p.x,p.y,36,0,Math.PI*2); ctx.fill()
    ctx.fillStyle= hitFlash.current>0 ? '#fecaca' : `hsl(${avatarHue.current},70%,85%)`
    const sx=p.radius*(1+dmgBounce.current*0.18), sy=p.radius*(1-dmgBounce.current*0.12)
    roundedRect(ctx,p.x-sx*0.45,p.y-sy*0.3,sx*0.9,sy*1.2,8); ctx.fill()
    ctx.beginPath(); ctx.arc(p.x,p.y-sy*0.8,sx*0.45,0,Math.PI*2); ctx.fill()
    if(player.current.shieldMs>0){ ctx.strokeStyle='rgba(34,211,238,.9)'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(p.x,p.y,p.radius+10+Math.sin(frame.current*0.2)*2,0,Math.PI*2); ctx.stroke() }

    if(shake.current>0){ ctx.restore() }

    // HUD
    ctx.fillStyle='#fff'; ctx.font='800 18px system-ui'; ctx.textAlign='right'
    ctx.fillText(`ניקוד ${score}`, w-12, 26)
    ctx.fillText(`שלב ${stage}${bossRef.current?' • בוס':''}`, w-12, 48)
    ctx.fillText(`נשק ${p.weapon.toUpperCase()}`, w-12, 70)

    const xpW=Math.min(w-160, 520), xpLeft=(w-xpW)/2, xpTop=12
    ctx.fillStyle='rgba(0,0,0,.35)'; roundedRect(ctx,xpLeft, xpTop, xpW, 10, 6); ctx.fill()
    const xpPct=Math.max(0,Math.min(1, xp.current/xpToNext.current))
    const xpg=ctx.createLinearGradient(xpLeft,xpTop,xpLeft+xpW,xpTop)
    xpg.addColorStop(0,`hsl(${avatarHue.current},90%,60%)`); xpg.addColorStop(1,'#fde047')
    roundedRect(ctx,xpLeft, xpTop, xpW*xpPct, 10, 6); ctx.fillStyle=xpg; ctx.fill()

    ctx.textAlign='start'
    for(let i=0;i<MAX_LIVES;i++){
      const x=12+i*20,y=26
      ctx.fillStyle=i<p.hp? '#fde68a' : 'rgba(255,255,255,.18)'
      ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill()
    }

    if(gameOver){
      drawOverlay(ctx, w, h, 'נפלת במעמקים…',
        [`ניקוד: ${score}`, `אויבים שהובסו: ${enemiesKilled.current}`, `בוסטרים שנאספו: ${boostsCollected.current}`],
        'לחצו רווח / כניסה כדי לשחק שוב')
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

  /* ======== Small UI bar (unchanged) ======== */
  function InstructionBar({
    paused, setPaused, mute, setMute, showHelp, setShowHelp, gameOver, softReset
  }:{
    paused:boolean; setPaused:Dispatch<SetStateAction<boolean>>;
    mute:boolean; setMute:Dispatch<SetStateAction<boolean>>;
    showHelp:boolean; setShowHelp:Dispatch<SetStateAction<boolean>>;
    gameOver:boolean; softReset:()=>void;
  }) {
    return (
      <div className="instr-wrap" dir="rtl">
        <div className="instr-aura" aria-hidden={true} />
        <div className="instr-bar glass">
          <span className="chip chip-info"><span className="dot" /> תנועה: WASD / גרירה</span>
          <span className="chip chip-info"><span className="dot" /> ירי: רווח / החזק</span>
          <button className="chip chip-ghost" onClick={()=>setPaused(p=>!p)} title="P">{paused ? 'המשך' : 'השהה (P)'}</button>
          <button className="chip chip-ghost" onClick={()=>{ setMute(m=>!m); synth.mute(!mute) }} title="M">{mute ? 'בטל השתקה (M)' : 'השתק (M)'}</button>
          {gameOver ? (
            <button className="chip chip-primary" onClick={softReset}>נסה/י שוב</button>
          ) : (
            showHelp && (<button className="chip chip-primary" onClick={()=>setShowHelp(false)}>התחל/י</button>)
          )}
        </div>
        <div className="instr-underline" />
      </div>
    )
  }

  return (
    <div className="game" dir="rtl">
      <InstructionBar
        paused={paused} setPaused={setPaused}
        mute={mute} setMute={setMute}
        showHelp={showHelp} setShowHelp={setShowHelp}
        gameOver={gameOver} softReset={softReset}
      />
      <canvas
        className="canvas"
        ref={canvasRef}
        onPointerDown={()=>{ if (gameOver) softReset() }}
      />
    </div>
  )
}
