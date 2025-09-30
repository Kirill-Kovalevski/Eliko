export const STAGE_LENGTH = 60
export function makeLevel(stage:number){
  const base = 2 + stage*0.25
  return {
    speed: base,
    spawnEvery: Math.max(16, 42 - stage*3),
    enemyHp: 1 + Math.floor(stage*0.5),
    bossHp: 30 + stage*10
  }
}
