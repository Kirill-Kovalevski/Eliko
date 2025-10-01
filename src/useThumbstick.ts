// useThumbstick.ts
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

type Pt = { x: number; y: number }

/**
 * Ultra-stable thumbstick for the left half of the canvas.
 * Exposes refs so the game loop can read live values without re-renders.
 *
 * Usage in Game.tsx:
 *   const { axRef: touchAxRef, ayRef: touchAyRef } =
 *     useThumbstick(canvasRef, MODE.current === 'touch')
 *   const ax = MODE.current === 'touch' ? (touchAxRef.current ?? 0) : kbAx
 *   const ay = MODE.current === 'touch' ? (touchAyRef.current ?? 0) : kbAy
 */
export function useThumbstick(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean
) {
  // live axes
  const axRef = useRef(0)
  const ayRef = useRef(0)

  // gesture state
  const idRef = useRef<number | null>(null)
  const originRef = useRef<Pt>({ x: 0, y: 0 })

  useEffect(() => {
    const c = canvasRef.current
    // reset if no canvas or disabled
    if (!c || !enabled) {
      axRef.current = 0
      ayRef.current = 0
      idRef.current = null
      return
    }

    const R = 110          // radius
    const DZ = 12          // deadzone
    const RECENTER = 0.28  // gentle origin recenter so thumb can drift

    const local = (e: PointerEvent) => {
      const r = c.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const onDown = (e: PointerEvent) => {
      // touch/pen only, left ~58% of canvas
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
      if (idRef.current !== null) return
      const p = local(e)
      if (p.x > c.clientWidth * 0.58) return
      idRef.current = e.pointerId
      try { c.setPointerCapture(e.pointerId) } catch {}
      originRef.current = p
      axRef.current = 0
      ayRef.current = 0
    }

    const onMove = (e: PointerEvent) => {
      if (idRef.current === null || e.pointerId !== idRef.current) return
      // we registered pointermove with passive:false so this is allowed
      if (e.pointerType === 'touch') e.preventDefault()

      const p = local(e)
      const dx = p.x - originRef.current.x
      const dy = p.y - originRef.current.y
      const len = Math.hypot(dx, dy)

      // deadzone + easeOutCubic curve
      let mag = 0
      if (len > DZ) mag = Math.min(1, (len - DZ) / (R - DZ))
      const curved = 1 - Math.pow(1 - mag, 3)
      const nx = len > 0 ? (dx / len) * curved : 0
      const ny = len > 0 ? (dy / len) * curved : 0

      axRef.current = nx
      ayRef.current = ny

      // gentle origin recenter to accommodate thumb drift
      if (len > R * 0.6) {
        originRef.current.x += dx * RECENTER * 0.06
        originRef.current.y += dy * RECENTER * 0.06
      }
    }

    const endGesture = (pointerId: number) => {
      if (idRef.current === null || pointerId !== idRef.current) return
      try { c.releasePointerCapture(pointerId) } catch {}
      idRef.current = null
      axRef.current = 0
      ayRef.current = 0
    }

    const onUp = (e: PointerEvent) => endGesture(e.pointerId)
    const onCancel = (e: PointerEvent) => endGesture(e.pointerId)
    const onLeaveWindow = () => {
      // safety: if pointer is lost (tab switch, etc.)
      if (idRef.current !== null) {
        idRef.current = null
        axRef.current = 0
        ayRef.current = 0
      }
    }

    c.addEventListener('pointerdown', onDown, { passive: true })
    c.addEventListener('pointermove', onMove, { passive: false })
    c.addEventListener('pointerup', onUp)
    c.addEventListener('pointercancel', onCancel)
    // extra safety if pointer capture is lost
    c.addEventListener('lostpointercapture', onLeaveWindow)
    window.addEventListener('blur', onLeaveWindow)

    return () => {
      c.removeEventListener('pointerdown', onDown)
      c.removeEventListener('pointermove', onMove)
      c.removeEventListener('pointerup', onUp)
      c.removeEventListener('pointercancel', onCancel)
      c.removeEventListener('lostpointercapture', onLeaveWindow)
      window.removeEventListener('blur', onLeaveWindow)
      axRef.current = 0
      ayRef.current = 0
      idRef.current = null
    }
  }, [canvasRef, enabled])

  return { axRef, ayRef }
}
