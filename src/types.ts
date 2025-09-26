/** Types for Eliko */

export type WeaponId =
  | 'blaster' | 'spread' | 'piercer' | 'laser' | 'rail' | 'orbitals' | 'nova'

export interface Entity {
  id: number
  x: number
  y: number
  w: number
  h: number
  vx?: number
  vy?: number
  type: 'bullet' | 'enemy' | 'boss' | 'spark'
  hp?: number
  /** Use a permissive bag so TS doesn't fight when we do math on ad-hoc fields. */
  data?: Record<string, any>     // <-- was unknown
}

export interface PlayerState {
  x: number; y: number; vx: number; vy: number
  maxSpeed: number
  radius: number
  hp: number
  shieldMs: number
  weapon: WeaponId
}

export type PowerUpKind = 'shield'|'speed'|'heal'|'weapon'|'drone'|'haste'

export interface PowerUp {
  id: number; x: number; y: number; kind: PowerUpKind; payload?: WeaponId
}

export type EnemyKind = 'jelly'|'squid'|'manta'|'nautilus'|'puffer'|'crab'

export interface RectLike { x:number; y:number; w:number; h:number }
