const ctx = typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window)
  ? new (window.AudioContext || (window as any).webkitAudioContext)()
  : null

function beep(freq=440, time=0.08){
  if(!ctx) return
  const o=ctx.createOscillator(), g=ctx.createGain()
  o.type='square'; o.frequency.value=freq
  o.connect(g); g.connect(ctx.destination)
  g.gain.value=0.05; o.start()
  setTimeout(()=>{ g.gain.exponentialRampToValueAtTime(0.0001, ctx!.currentTime + 0.05); o.stop(ctx!.currentTime + 0.06) }, time*1000)
}
let muted=false
export const synth = {
  shoot:()=>!muted&&beep(880,0.05),
  spread:()=>!muted&&beep(660,0.06),
  pierce:()=>!muted&&beep(520,0.08),
  laser:()=>!muted&&beep(420,0.1),
  rail:()=>!muted&&beep(360,0.12),
  nova:()=>!muted&&beep(300,0.14),
  bonus:()=>!muted&&beep(1000,0.06),
  power:()=>!muted&&beep(1200,0.08),
  hit:()=>!muted&&beep(200,0.08),
  mute:(m:boolean)=>{ muted=m }
}
