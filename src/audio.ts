// audio.ts — tiny, crash-proof synth with user-gesture unlock

type OscType = OscillatorType

// Safari compatibility
const AC: typeof AudioContext | undefined =
  (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext

let ctx: AudioContext | null = null
let out: GainNode | null = null
let muted = false

function ensureCtx(): AudioContext | null {
  if (!AC) return null
  if (!ctx) {
    try {
      ctx = new AC()
      out = ctx.createGain()
      out.gain.value = 0.9
      out.connect(ctx.destination)
    } catch {
      ctx = null
      out = null
    }
  }
  return ctx
}

async function resume() {
  const c = ensureCtx()
  try {
    if (c && c.state !== 'running') await c.resume()
  } catch {
    /* ignore */
  }
}

function beep(freq = 440, dur = 0.08, type: OscType = 'square', gain = 0.12) {
  // Bail out silently if audio isn’t ready or muted
  const c = ctx ?? ensureCtx()
  if (!c || c.state !== 'running' || !out || muted) return

  try {
    const t0 = c.currentTime
    const osc = c.createOscillator()
    const g = c.createGain()

    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)

    // Simple AD envelope (fast attack, quick decay)
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.0008), t0 + Math.max(0.01, dur))

    osc.connect(g)
    g.connect(out)

    osc.start(t0)
    osc.stop(t0 + Math.max(0.02, dur + 0.02))

    // GC safety
    osc.onended = () => {
      try { g.disconnect() } catch {}
      try { osc.disconnect() } catch {}
    }
  } catch {
    /* ignore all synth errors */
  }
}

export const synth = {
  // gate / policy helpers
  resume,
  get ready() { return !!ctx && ctx.state === 'running' },
  mute(v: boolean) { muted = v },
  get muted() { return muted },

  // sfx (tuned quickly; change freely)
  shoot()  { beep(880, 0.06, 'square',   0.12) },
  spread() { beep(760, 0.06, 'square',   0.12) },
  pierce() { beep(640, 0.08, 'sawtooth', 0.12) },
  laser()  { beep(520, 0.10, 'triangle', 0.14) },
  rail()   { beep(440, 0.12, 'sawtooth', 0.18) },
  nova()   { beep(300, 0.20, 'sine',     0.25) },
  bonus()  { beep(1200,0.07, 'triangle', 0.12) },
  hit()    { beep(220, 0.09, 'square',   0.16) },
  power()  { beep(1000,0.10, 'triangle', 0.18) },
}
