export type WeaponId = 'blaster'|'spread'|'piercer'|'laser'|'rail'|'orbitals'|'nova'
export type PowerUpKind = 'shield'|'speed'|'heal'|'weapon'|'drone'|'haste'
export type Entity = {
  id:number; x:number; y:number; w:number; h:number;
  vx?:number; vy?:number; type:'bullet'|'enemy'|'spark'|'boss';
  hp?:number; data?:Record<string,unknown>
}
export type PlayerState = {
  x:number; y:number; vx:number; vy:number; maxSpeed:number; radius:number;
  hp:number; shieldMs:number; weapon:WeaponId
}
