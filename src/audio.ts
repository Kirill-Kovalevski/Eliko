// src/audio.ts — WebAudio mini-synth (null-safe)

class Synth {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  enabled = true
  master = 0.24

  private ensure() {
    if (this.ctx && this.out) return

    const AC: typeof AudioContext =
      ((window as any).AudioContext || (window as any).webkitAudioContext)

    // Create fresh context + master gain, then assign to fields
    const ctx: AudioContext = new AC()
    const out: GainNode = ctx.createGain()
    out.gain.value = this.master
    out.connect(ctx.destination)

    this.ctx = ctx
    this.out = out
  }

  mute(m: boolean) {
    this.enabled = !m
    if (this.out) this.out.gain.value = m ? 0 : this.master
  }

  private now() {
    this.ensure()
    return this.ctx!.currentTime
  }

  // Generic tone with ADSR-ish envelope
  tone(opts: {
    f?: number               // frequency
    type?: OscillatorType    // 'sine' | 'square' | 'sawtooth' | 'triangle'
    a?: number               // attack (s)
    s?: number               // sustain (s)
    r?: number               // release (s)
    det?: number             // detune cents
    v?: number               // volume 0..1
  } = {}) {
    if (!this.enabled) return
    this.ensure()

    const {
      f = 600, type = 'sine',
      a = 0.003, s = 0.06, r = 0.12,
      det = 0, v = 1,
    } = opts

    const t0 = this.now()
    const o = this.ctx!.createOscillator()
    const g = this.ctx!.createGain()

    o.type = type
    o.frequency.setValueAtTime(f, t0)
    if (det) o.detune.setValueAtTime(det, t0)

    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(v, t0 + a)
    g.gain.linearRampToValueAtTime(v * 0.6, t0 + a + s)
    g.gain.linearRampToValueAtTime(0, t0 + a + s + r)

    o.connect(g).connect(this.out!)
    o.start(t0)
    o.stop(t0 + a + s + r + 0.02)
  }

  // Preset sounds
  shoot()  { this.tone({ f: 780, type: 'triangle', a: 0.001, s: 0.02, r: 0.05, v: 0.8 }) }
  spread() { this.tone({ f: 740, type: 'square',   a: 0.001, s: 0.02, r: 0.05, det: +6, v: 0.6 }) }
  pierce() { this.tone({ f: 520, type: 'sawtooth', a: 0.002, s: 0.03, r: 0.08, v: 0.6 }) }
  laser()  { this.tone({ f: 920, type: 'sawtooth', a: 0.004, s: 0.08, r: 0.12, v: 0.7 }) }
  rail()   { this.tone({ f: 260, type: 'sine',     a: 0.006, s: 0.16, r: 0.10, v: 0.9 }) }
  nova()   { this.tone({ f: 420, type: 'square',   a: 0.004, s: 0.12, r: 0.22, v: 0.9 }) }
  hit()    { this.tone({ f: 120, type: 'square',   a: 0.002, s: 0.06, r: 0.18, v: 0.9 }) }
  power()  { this.tone({ f: 900, type: 'sawtooth', a: 0.004, s: 0.10, r: 0.20, det: +8, v: 0.7 }) }
  bonus()  { this.tone({ f: 620, type: 'triangle', a: 0.003, s: 0.10, r: 0.20, v: 0.8 }) }
}

export const synth = new Synth()
