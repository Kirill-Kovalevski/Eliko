// src/useAimstick.ts
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

type Pt = { x: number; y: number }

/**
 * Right-side thumbstick: aim + fire.
 * Returns refs so the game loop reads live values without re-renders.
 * - axRef / ayRef in [-1..1] (0 if idle)
 * - firingRef is true while the right finger is down
 */
export function useAimstick(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean
) {
  const axRef = useRef(0)
  const ayRef = useRef(0)
  const firingRef = useRef(false)

  const idRef = useRef<number | null>(null)
  const originRef = useRef<Pt>({ x: 0, y: 0 })

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !enabled) {
      axRef.current = 0
      ayRef.current = 0
      firingRef.current = false
      return
    }

    const R = 120      // radius
    const DZ = 8       // deadzone

    const local = (e: PointerEvent) => {
      const r = c.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const onDown = (e: PointerEvent) => {
      // touch/pen only, right half only
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
      if (idRef.current !== null) return
      const p = local(e)
      if (p.x <= c.clientWidth * 0.58) return
      idRef.current = e.pointerId
      try { c.setPointerCapture(e.pointerId) } catch {}
      originRef.current = p
      axRef.current = 0
      ayRef.current = 0
      firingRef.current = true
    }

    const onMove = (e: PointerEvent) => {
      if (idRef.current === null || e.pointerId !== idRef.current) return
      if (e.pointerType === 'touch') e.preventDefault()
      const p = local(e)
      let dx = p.x - originRef.current.x
      let dy = p.y - originRef.current.y
      const len = Math.hypot(dx, dy)

      // deadzone + simple linear magnitude
      let mag = 0
      if (len > DZ) mag = Math.min(1, (len - DZ) / (R - DZ))
      const nx = len > 0 ? (dx / len) * mag : 0
      const ny = len > 0 ? (dy / len) * mag : 0
      axRef.current = nx
      ayRef.current = ny
    }

    const onEnd = (e: PointerEvent) => {
      if (idRef.current === null || e.pointerId !== idRef.current) return
      try { c.releasePointerCapture(e.pointerId) } catch {}
      idRef.current = null
      axRef.current = 0
      ayRef.current = 0
      firingRef.current = false
    }

    c.addEventListener('pointerdown', onDown, { passive: true })
    c.addEventListener('pointermove', onMove, { passive: false })
    c.addEventListener('pointerup', onEnd)
    c.addEventListener('pointercancel', onEnd)

    return () => {
      c.removeEventListener('pointerdown', onDown)
      c.removeEventListener('pointermove', onMove)
      c.removeEventListener('pointerup', onEnd)
      c.removeEventListener('pointercancel', onEnd)
      axRef.current = 0
      ayRef.current = 0
      firingRef.current = false
      idRef.current = null
    }
  }, [canvasRef, enabled])

  return { axRef, ayRef, firingRef }
}
