import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

type Pt = { x: number; y: number }

/**
 * Right-half dynamic joystick (aim + fire).
 * - Touch/pen only
 * - Fires ONLY while the right finger is down and moved beyond threshold
 * - Returns ax/ay (direction) and firingRef (boolean)
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

    const R = 120
    const DZ = 10
    const FIRE_TH = 0.10   // magnitude threshold to consider "actively aiming/firing"
    const SNAP = 0.05

    c.style.touchAction = 'none'

    const local = (e: PointerEvent) => {
      const r = c.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
      if (idRef.current !== null) return
      const p = local(e)
      // Right half only
      if (p.x < c.clientWidth * 0.5) return
      idRef.current = e.pointerId
      try { c.setPointerCapture(e.pointerId) } catch {}
      originRef.current = p
      axRef.current = 0; ayRef.current = 0
      firingRef.current = false
    }

    const onMove = (e: PointerEvent) => {
      if (idRef.current === null || e.pointerId !== idRef.current) return
      if (e.pointerType === 'touch') e.preventDefault()
      const p = local(e)
      const dx = p.x - originRef.current.x
      const dy = p.y - originRef.current.y
      const len = Math.hypot(dx, dy)

      let mag = 0
      if (len > DZ) mag = Math.min(1, (len - DZ) / (R - DZ))
      const curved = 1 - Math.pow(1 - mag, 3)
      const nx = len > 0 ? (dx / len) * curved : 0
      const ny = len > 0 ? (dy / len) * curved : 0

      const m = Math.hypot(nx, ny)
      axRef.current = m < SNAP ? 0 : nx
      ayRef.current = m < SNAP ? 0 : ny
      firingRef.current = m > FIRE_TH
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
