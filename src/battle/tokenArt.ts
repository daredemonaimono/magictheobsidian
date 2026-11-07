// トークンの絵: デッキに登録してあるトークン (## Token) の中から、作ったトークンに合うものを選ぶ。Obsidian に依存しない純粋な関数
export interface TokenArt {
  name: string;
  typeLine: string; // "Token Creature — Zombie" など
  power?: string;
  toughness?: string;
  art?: string; // 絵の URL
}

const subtypes = (typeLine: string): string[] => (typeLine.split(/—|-/)[1] ?? "").split(/\s+/).filter(Boolean).map((x) => x.toLowerCase());

// 名前が同じなら最優先。なければ、サブタイプ (Zombie など) が重なるもの。パワー・タフネスが同じなら、さらに優先。何も重ならなければ undefined
export function pickTokenArt(list: TokenArt[] | undefined, name: string, types: string, power?: number, toughness?: number): string | undefined {
  const want = subtypes(types);
  let best: { art: string; score: number } | undefined;
  for (const t of list ?? []) {
    if (!t.art) continue;
    let score = t.name.toLowerCase() === name.toLowerCase() ? 100 : subtypes(t.typeLine).some((s) => want.includes(s)) ? 10 : 0;
    if (!score) continue;
    if (power !== undefined && t.power === String(power)) score += 3;
    if (toughness !== undefined && t.toughness === String(toughness)) score += 3;
    if (!best || score > best.score) best = { art: t.art, score };
  }
  return best?.art;
}
