import { Game, PlayerId } from "./state";

// ロンドン・マリガン。手札を全部ライブラリーに戻して切り、7 枚引き直す。キープしたら、引き直した回数だけ、手札から選んでライブラリーの底に置く
export const HAND_SIZE = 7;

export function shuffle<T>(xs: T[], rng: () => number): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
}

// 手札を戻して、切って、7 枚引く (足りなければ、ある分だけ)
export function redraw(g: Game, p: PlayerId, rng: () => number): void {
  g.libraries[p].push(...g.hands[p].splice(0));
  shuffle(g.libraries[p], rng);
  g.hands[p] = g.libraries[p].splice(0, HAND_SIZE);
}

// 手札から ids を、ライブラリーの底に置く。手札に無い id があれば、何もせず false
export function putBottom(g: Game, p: PlayerId, ids: string[]): boolean {
  const cards = ids.map((id) => g.hands[p].find((c) => c.id === id));
  if (cards.some((c) => !c) || new Set(ids).size !== ids.length) return false;
  g.hands[p] = g.hands[p].filter((c) => !ids.includes(c.id));
  g.libraries[p].push(...(cards as NonNullable<(typeof cards)[number]>[]));
  return true;
}
