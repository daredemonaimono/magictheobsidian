import { RuleBook, Game, PlayerId, drawCards } from "../state";
import { enterBattlefield } from "./battlefield";
import { RuleError, live } from "./shared";
import { flushEvents } from "./triggers";

// ゲームの開始前の特別な動作

const staticHas = (rules: RuleBook, name: string, node: string): boolean => (rules.get(name)?.abilities ?? []).some((a) => a.kind === "static" && a.body.some((c) => c.node === node));

// 開始時の手札から、startOnBattlefield のカード (Leyline of the Void) を、戦場に出す。マリガンが終わったあとに呼ぶ
// shortcut: 「してもよい」だが、いつも出す (出さない理由が、ほとんど無い)
export function applyOpening(g: Game, p: PlayerId, rules: RuleBook): void {
  for (const c of [...g.hands[p]]) {
    if (!staticHas(rules, c.name, "startOnBattlefield")) continue;
    g.hands[p] = g.hands[p].filter((x) => x !== c);
    enterBattlefield(g, c, p, rules);
    g.log.push(`${p === "you" ? "あなた" : p === "opp" ? "相手" : p}は、${c.name} をゲームの開始時に戦場に出した`);
  }
  flushEvents(g, rules);
}

// Serum Powder: マリガンのとき (マリガンの回数には数えない)、手札を全部追放して、同じ枚数を引く。カードは、手札にあるもの (mulliganExile を持つ)
export function serumPowder(g: Game, p: PlayerId, cardId: string, rules: RuleBook): void {
  live(g);
  if (!g.mulligan) throw new RuleError("マリガンのときだけ、使える");
  const card = g.hands[p].find((c) => c.id === cardId);
  if (!card || !staticHas(rules, card.name, "mulliganExile")) throw new RuleError(`手札に無い、または、マリガンのかわりに使えない: ${cardId}`);
  const n = g.hands[p].length;
  g.exile[p].push(...g.hands[p].splice(0));
  drawCards(g, p, n);
  g.log.push(`${p === "you" ? "あなた" : p === "opp" ? "相手" : p}は ${card.name} で、手札 ${n} 枚を追放して、${n} 枚引いた`);
}
