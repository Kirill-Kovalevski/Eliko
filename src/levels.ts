// Procedural level stream + bosses.
// Each "stage" lasts N spawns, then a boss appears.

export interface LevelState {
  stage: number
  spawnEvery: number
  enemyHp: number
  speed: number
  bossHp: number
}

export function makeLevel(stage: number): LevelState {
  // scale values gently per stage
  return {
    stage,
    spawnEvery: Math.max(26, 70 - stage * 4),
    enemyHp: 1 + Math.floor(stage / 3),
    speed: 2.2 + Math.min(3, stage * 0.25),
    bossHp: 12 + stage * 6,
  }
}

export const STAGE_LENGTH = 22 // spawns per stage before boss
