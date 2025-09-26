export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const rnd = (a: number, b: number) => a + Math.random() * (b - a)
export const id = () => Math.random()
export const aabb = (a: {x:number;y:number;w:number;h:number}, b:{x:number;y:number;w:number;h:number}) =>
  Math.abs(a.x - b.x) < (a.w + b.w)/2 && Math.abs(a.y - b.y) < (a.h + b.h)/2
