import { useEffect, useRef, useState, type RefObject } from 'react'

type Pt = { x:number; y:number }
const clamp = (v:number, a:number, b:number) => Math.max(a, Math.min(b, v))

export function useThumbstick(
  canvasRef: RefObject<HTMLCanvasElement | null>, // <-- accept nullable ref
  enabled: boolean
) {
  const [ax, setAx] = useState(0)
  const [ay, setAy] = useState(0)

  const idRef  = useRef<number | null>(null)
  const origin = useRef<Pt>({x:0,y:0})
  const cur    = useRef<Pt>({x:0,y:0})
  const active = useRef(false)
  const vx     = useRef(0)
  const vy     = useRef(0)

  const radius = 64, dead = 6, smooth = 0.22

  // smoothing / easing loop
  useEffect(() => {
    let raf = 0, last = performance.now()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const now = performance.now()
      const dt  = Math.min(48, now - last) / 16.6667
      last = now

      let tx = 0, ty = 0
      if (active.current) {
        const dx = cur.current.x - origin.current.x
        const dy = cur.current.y - origin.current.y
        const len = Math.hypot(dx,dy)
        const n = len < dead ? 0 : clamp((len - dead) / (radius - dead), 0, 1)
        if (len > 0.0001) { tx = (dx/len)*n; ty = (dy/len)*n }
      }

      const k = 1 - Math.pow(1 - smooth, dt)
      vx.current += (tx - vx.current) * k
      vy.current += (ty - vy.current) * k

      setAx(vx.current)
      setAy(vy.current)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])

  // touch listeners
  useEffect(() => {
    const c = canvasRef.current
    if (!c || !enabled) return

    const local = (ev: Touch | MouseEvent) => {
      const r = c.getBoundingClientRect()
      return { x: ev.clientX - r.left, y: ev.clientY - r.top }
    }

    const start = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const p = local(t)
        if (p.x <= c.clientWidth * 0.5 && idRef.current === null) {
          idRef.current = t.identifier
          origin.current = p
          cur.current    = p
          active.current = true
          break
        }
      }
    }
    const move = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === idRef.current) { cur.current = local(t); return }
      }
    }
    const end = () => { idRef.current = null; active.current = false }

    c.addEventListener('touchstart', start, { passive:true })
    c.addEventListener('touchmove',  move,  { passive:true })
    c.addEventListener('touchend',   end)
    c.addEventListener('touchcancel',end)
    return () => {
      c.removeEventListener('touchstart', start)
      c.removeEventListener('touchmove',  move)
      c.removeEventListener('touchend',   end)
      c.removeEventListener('touchcancel',end)
    }
  }, [canvasRef, enabled])

  return { ax, ay }
}
