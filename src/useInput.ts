import { useEffect, useRef, useState } from 'react'

/** Hybrid input:
 *  - Keyboard: arrows / WASD give continuous analog axes (ax, ay)
 *  - Pointer: drag on left-half sets analog axes (relative from start)
 *  - Fire: Space (hold) or tap/hold on right-half
 */
export function useInput() {
  const [fire, setFire] = useState(false)
  const axRef = useRef(0) // -1..1
  const ayRef = useRef(0) // -1..1
  const [axes, setAxes] = useState({ ax: 0, ay: 0 })

  // Smoothly publish axes to React state (avoids too-frequent renders)
  useEffect(() => {
    let r = 0
    const tick = () => {
      r = requestAnimationFrame(tick)
      setAxes({ ax: axRef.current, ay: ayRef.current })
    }
    r = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(r)
  }, [])

  // Keyboard axes
  useEffect(() => {
    const pressed = new Set<string>()
    const update = () => {
      const left = pressed.has('arrowleft') || pressed.has('a')
      const right = pressed.has('arrowright') || pressed.has('d')
      const up = pressed.has('arrowup') || pressed.has('w')
      const down = pressed.has('arrowdown') || pressed.has('s')
      axRef.current = (right ? 1 : 0) + (left ? -1 : 0)
      ayRef.current = (down ? 1 : 0) + (up ? -1 : 0)
    }
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === ' ') { setFire(true); e.preventDefault() }
      pressed.add(k); update()
    }
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === ' ') setFire(false)
      pressed.delete(k); update()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // Pointer (left half = movement, right half = fire)
  useEffect(() => {
    const view = document.body
    let dragging = false
    let sx = 0, sy = 0, sw = 0
    const norm = (dx: number, dy: number) => {
      // normalize by viewport size; deadzone
      const nx = Math.max(-1, Math.min(1, dx / (sw * 0.2)))
      const ny = Math.max(-1, Math.min(1, dy / (sw * 0.2)))
      const dz = 0.08
      return {
        x: Math.abs(nx) < dz ? 0 : nx,
        y: Math.abs(ny) < dz ? 0 : ny,
      }
    }
    const down = (e: PointerEvent) => {
      const r = (e.target as Element).getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      sw = r.width
      if (x < r.width * 0.5) {
        dragging = true; sx = x; sy = y
        const v = norm(0, 0); axRef.current = v.x; ayRef.current = v.y
      } else { setFire(true) }
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      const r = (e.target as Element).getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      const v = norm(x - sx, y - sy)
      axRef.current = v.x; ayRef.current = v.y
    }
    const up = () => { dragging = false; axRef.current = 0; ayRef.current = 0; setFire(false) }
    view.addEventListener('pointerdown', down as any, { passive: true })
    window.addEventListener('pointermove', move as any, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    return () => { view.removeEventListener('pointerdown', down as any); window.removeEventListener('pointermove', move as any); window.removeEventListener('pointerup', up) }
  }, [])

  return { fire, setFire, ax: axes.ax, ay: axes.ay }
}
