// 種から決まる乱数 (mulberry32)。対戦の山札の切り直し・マリガンを、同じ種で再現するため
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ゲームの中の乱数 (ライブラリーを切るなど)。状態は Game.rngState (数) に持つので、コピーしても、保存しても、同じ順に出る (リプレイで、同じ結果になる)。同じ状態からは、いつも同じ値
export function nextRandom(g: { rngState?: number }): number {
  let a = ((g.rngState ?? 0x9e3779b9) + 0x6d2b79f5) >>> 0;
  g.rngState = a;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
