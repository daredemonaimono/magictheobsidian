// 対戦の画面の、列の重なりの計算 (DOM を持たない。テストで確かめる)。列の幅に収まるように、カードを重ねる量を決める

export const GAP = 10; // カードどうしの間
export const TAP_EXTRA = 24; // タップして横向きになったカードが、列の中で余分に取る幅 (左右 12px ずつ)

// 列に必要な幅。cardW = カード1枚の幅、n = 枚数、tapped = そのうちタップしている枚数
export const rowNeed = (cardW: number, n: number, tapped: number): number => n * cardW + Math.max(0, n - 1) * GAP + tapped * TAP_EXTRA;

// 重ねる量 (px。隣との間の、負の余白)。need が avail に収まるなら 0。枚数が 1 以下・幅が測れない (0) ときも 0
export const overlapFor = (need: number, n: number, avail: number): number => (n > 1 && avail > 0 ? Math.max(0, Math.ceil((need - avail) / (n - 1))) : 0);
