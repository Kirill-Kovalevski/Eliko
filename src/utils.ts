export const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v))
export const lerp=(a:number,b:number,t:number)=>a+(b-a)*t
export const rnd=(a:number,b:number)=>a+Math.random()*(b-a)
let __id=1; export const id=()=>(__id++)
export const aabb=(a:{x:number;y:number;w:number;h:number},b:{x:number;y:number;w:number;h:number})=>{
  return Math.abs(a.x-b.x)*2<(a.w+b.w)&&Math.abs(a.y-b.y)*2<(a.h+b.h)
}
