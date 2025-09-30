import { useEffect, useRef, useState } from 'react'

export function useInput(){
  const [fire, setFire] = useState(false)
  const ax = useRef(0); const ay = useRef(0)

  useEffect(()=>{
    const keys = new Set<string>()
    const onKey = (e:KeyboardEvent)=>{
      const k = e.key.toLowerCase()
      if(['w','arrowup'].includes(k)) { keys.add('up') }
      if(['s','arrowdown'].includes(k)) { keys.add('down') }
      if(['a','arrowleft'].includes(k)) { keys.add('left') }
      if(['d','arrowright'].includes(k)) { keys.add('right') }
      if(k===' ') setFire(true)
    }
    const onKeyUp = (e:KeyboardEvent)=>{
      const k = e.key.toLowerCase()
      if(['w','arrowup'].includes(k)) { keys.delete('up') }
      if(['s','arrowdown'].includes(k)) { keys.delete('down') }
      if(['a','arrowleft'].includes(k)) { keys.delete('left') }
      if(['d','arrowright'].includes(k)) { keys.delete('right') }
      if(k===' ') setFire(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    const i = setInterval(()=>{
      ax.current = (keys.has('right')?1:0) - (keys.has('left')?1:0)
      ay.current = (keys.has('down')?1:0) - (keys.has('up')?1:0)
    }, 16)
    return ()=>{ window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); clearInterval(i) }
  },[])

  // simple touch: left half to move, right half to fire
  useEffect(()=>{
    const onPointer = (e:PointerEvent)=>{
      const w = window.innerWidth
      if(e.type==='pointerdown'||e.type==='pointermove'){
        setFire(e.clientX > w/2)
        const nx = (Math.max(0, Math.min(w/2, e.clientX)) / (w/2)) * 2 - 1
        const ny = (Math.max(0, Math.min(window.innerHeight, e.clientY)) / window.innerHeight) * 2 - 1
        ax.current = nx; ay.current = ny
      }else if(e.type==='pointerup'||e.type==='pointercancel'){ setFire(false); ax.current=0; ay.current=0 }
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('pointermove', onPointer)
    window.addEventListener('pointerup', onPointer)
    window.addEventListener('pointercancel', onPointer)
    return ()=>{
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerup', onPointer)
      window.removeEventListener('pointercancel', onPointer)
    }
  },[])

  return { fire, get ax(){ return ax.current }, get ay(){ return ay.current } } as const
}
