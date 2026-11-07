import { NodeCall } from "./node";
import { cardRoles } from "./roles";
import { Decider, Game, GameCard, Perm, PlayerId, RuleBook, StackItem, statsOf } from "./state";

// AI・CPU の、エンジン途中の判断 (捨てる・選ぶ・対象・順番・伝説のルール) の既定。ノードの役割から、機械的にそれらしく選ぶ (API は呼ばない)。
// カード名・デッキ固有の指定は使わない。迷う判断 (分からないとき) は undefined を返し、エンジンの既定の動きに任せる
const isLand = (c: GameCard) => /\bLand\b/.test(c.typeLine);
const isCreature = (c: GameCard) => /\bCreature\b/.test(c.typeLine);
const ownedLands = (g: Game, p: PlayerId) => g.battlefield.filter((x) => x.controller === p && isLand(x.card)).length;

// カードの価値 (大きいほど手元に残したい・先に欲しい)
export function cardValue(g: Game, p: PlayerId, c: GameCard, rules: RuleBook): number {
  if (isLand(c)) return ownedLands(g, p) < 4 ? 10 : 1; // 土地が足りなければ高く、十分なら低い
  const r = cardRoles(rules, c.name).all;
  let v = 3 + c.mv * 0.3 + (c.power ?? 0) * 0.3;
  if (r.includes("graveyardValue") || r.includes("millPayoff")) v -= 4; // 墓地で働く: 捨てても損しない
  if (r.includes("removal") || r.includes("counterSpell")) v += 4;
  if (r.includes("cardAdvantage")) v += 3;
  return v;
}

const strength = (x: Perm) => {
  const s = statsOf(x);
  return (s ? s.power + s.toughness : 0) + Object.values(x.counters ?? {}).reduce((a, b) => a + b, 0) * 0.1 + x.card.mv * 0.01;
};
const best = <T,>(xs: T[], f: (x: T) => number): T | undefined => xs.reduce<T | undefined>((a, x) => (a === undefined || f(x) > f(a) ? x : a), undefined);

const HOSTILE = ["playerRemoves", "destroy", "exile", "bounce", "damage", "counter", "tap", "discard", "loseLife", "mill", "lookHand", "sacrifice"];
const FRIENDLY = ["addCounter", "grant", "attach", "regenerate", "untap", "gainLife", "draw"];
const refName = (v: unknown) => (v && typeof v === "object" && "ref" in v ? String((v as { ref: string }).ref) : undefined);
const usesRef = (c: NodeCall, as: string) => Object.values(c.args).some((v) => refName(v) === as);
const negative = (c: NodeCall) => c.node === "modify" && (Number(c.args.power) < 0 || Number(c.args.toughness) < 0);
const positive = (c: NodeCall) => c.node === "modify" && !negative(c);

export function heuristicDecider(me: PlayerId, rules: RuleBook): Decider {
  const val = (g: Game, p: PlayerId, c: GameCard) => cardValue(g, p, c, rules);
  return {
    discard(g, p, n) {
      if (p === me) return undefined;
      return [...g.hands[p]].sort((a, b) => val(g, p, a) - val(g, p, b)).slice(0, n);
    },
    choose(g, p, from, n, _atMost, kind) {
      if (p === me) return undefined;
      if (kind === "sacrifice") {
        // 自分のパーマネントを 1 つ選んで取り除く: いちばん価値の低いもの (弱いものから)
        const worth = (c: GameCard) => { const perm = g.battlefield.find((x) => x.card === c); return perm ? strength(perm) : 0; };
        return [...from].sort((a, b) => worth(a) - worth(b)).slice(0, n);
      }
      const foe = from.length > 0 && from.every((c) => c.owner !== p);
      if (kind !== "search" && !foe) return undefined;
      return [...from].sort((a, b) => val(g, p, b) - val(g, p, a)).slice(0, n);
    },
    // 「捨ててもよい」: 手札が 2 枚以下 (捨てると手札が尽きそう) なら、しない。ほかは、既定のまま
    may(g, p, what) {
      if (p === me || !/捨て/.test(what)) return undefined;
      return g.hands[p].length > 2 ? undefined : false;
    },
    order(g, p, cards, to) {
      if (p === me || to !== "top") return undefined;
      return [...cards].sort((a, b) => val(g, p, b) - val(g, p, a));
    },
    legend(_g, p, same) {
      if (p === me) return undefined;
      return same.reduce((a, x) => (strength(x) > strength(a) ? x : a));
    },
    target(g, item: StackItem, call, legal) {
      if (item.controller === me) return undefined;
      const as = call.as;
      if (!as) return undefined;
      const body = item.body ?? [];
      const users = body.filter((c) => usesRef(c, as));
      const hostile = users.some((c) => HOSTILE.includes(c.node) || negative(c));
      const friendly = users.some((c) => FRIENDLY.includes(c.node) || positive(c)) || (!hostile && users.length > 0 && call.args.zone === "graveyard"); // 墓地から動かす: 自分の良いカードを
      if (!hostile && !friendly) return undefined;
      const mine = item.controller;
      const want = (id: string) => (hostile ? id !== mine && !isOwn(g, id, mine) : isOwn(g, id, mine));
      const pool = legal.filter(want);
      if (!pool.length) return undefined;
      const score = (id: string): number => {
        const perm = g.battlefield.find((x) => x.id === id);
        if (perm) return strength(perm);
        const inGy = Object.values(g.graveyards).flat().find((c) => c.id === id);
        if (inGy) return val(g, mine, inGy) + (isCreature(inGy) ? 5 : 0) + (inGy.power ?? 0);
        const idx = g.stack.findIndex((s) => s.id === id);
        return idx >= 0 ? idx : 0; // スタックは、上 (後ろ) のものほど
      };
      const pick = best(pool, score);
      return pick === undefined ? undefined : [pick];
    },
  };
}

function isOwn(g: Game, id: string, me: PlayerId): boolean {
  if (g.players.includes(id)) return id === me;
  const perm = g.battlefield.find((x) => x.id === id);
  if (perm) return perm.controller === me;
  const st = g.stack.find((s) => s.id === id);
  if (st) return st.controller === me;
  const gy = Object.values(g.graveyards).flat().find((c) => c.id === id);
  return gy ? gy.owner === me : false;
}
