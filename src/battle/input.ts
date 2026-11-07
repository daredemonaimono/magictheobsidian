import { dredgeNote, dredgeVerdict, evalDredge } from "./dredgeEval";
import { Game, GameCard, Decider, PlayerId, RuleBook } from "./state";
import { NodeCall } from "./node";
import { heuristicDecider } from "./aiDefaults";

// 人の判断の入力待ち。エンジンは同期のまま。自分 (me) への質問で、まだ答えが無ければ NeedInput を投げ、画面が答えを集めて、最初からやり直す (エンジンは乱数を使わないので、同じ結果になる)。相手への質問は、これまでどおり既定の動き
export type CardRef = { id: string; name: string };
export type InputRequest =
  | { kind: "discard"; n: number; cards: CardRef[]; cleanup?: boolean } // 手札から n 枚捨てる。cleanup = クリンナップの手札の上限 (画面は、「残すカードを選ぶ」形にする)
  | { kind: "choose"; min: number; max: number; cards: CardRef[]; label?: string; for?: PlayerId; key?: string } // 見たカードから選ぶ。label = 画面に出す説明 (Dredge など)
  | { kind: "order"; cards: CardRef[]; to: "top" | "bottom" | "stack" } // ライブラリーの上・底に置く順番 / stack = 同時の誘発を解決する順番 (答えは、上から下へ並べた id)
  | { kind: "may"; what: string } // 「してもよい」
  | { kind: "pay"; n: number; why?: string } // 「支払わないかぎり」の支払い
  | { kind: "target"; card: string; min: number; max: number; choices: CardRef[] }; // 誘発型能力の対象 (名前つき。画面は、まだ起きていない局面のものを、盤面ではなく、一覧で選ばせる)
export type Answer = string[] | boolean; // カード・対象の id の並び / はい・いいえ

export class NeedInput extends Error {
  constructor(readonly request: InputRequest) {
    super("入力待ち");
  }
}

const refs = (cs: GameCard[]): CardRef[] => cs.map((c) => ({ id: c.id, name: c.name }));

// answers = これまでに集めた答え (質問の順)。足りなければ、次の質問で NeedInput
// ai = AI の相手のプレイヤー。AI の Dredge の質問は、人には出さず (for = ai)、画面が AI (API) に聞いて、答えを足す (人への質問と、同じ仕組み)。AI が無ければ (雑魚 CPU など)、Dredge しない
export function makeDecider(me: PlayerId, answers: Answer[], ai?: PlayerId | PlayerId[], rules?: RuleBook): Decider {
  const isAi = (p: PlayerId) => (Array.isArray(ai) ? ai.includes(p) : p === ai);
  let i = 0;
  const next = (request: InputRequest): Answer => {
    if (i >= answers.length) throw new NeedInput(request);
    return answers[i++];
  };
  const ids = (a: Answer): string[] => (Array.isArray(a) ? a : []);
  const h = rules ? heuristicDecider(me, rules) : undefined; // 人以外 (AI・CPU) の、機械的な既定 (ノードの役割から)
  return {
    discard(g: Game, p, n, cleanup) {
      const hand = g.hands[p];
      if (p !== me) return h?.discard?.(g, p, n, cleanup);
      if (hand.length <= n) return undefined; // 全部捨てるなら、聞かない
      const got = ids(next({ kind: "discard", n, cards: refs(hand), ...(cleanup ? { cleanup: true } : {}) }));
      return hand.filter((c) => got.includes(c.id));
    },
    choose(g, p, from, n, atMost, kind) {
      if (p !== me) return h?.choose?.(g, p, from, n, atMost, kind);
      if (from.length === 0 || (!atMost && from.length <= n)) return undefined;
      const got = ids(next({ kind: "choose", min: atMost ? 0 : n, max: n, cards: refs(from) }));
      return from.filter((c) => got.includes(c.id));
    },
    dredge(g, p, options0) {
      if (p !== me && !isAi(p)) return undefined;
      if (p === me) {
        const label = `引くかわりに Dredge する? ${options0.map((o) => `${o.card.name} (Dredge ${o.n})`).join("・")}: 手札に戻すカードを選ぶ (選ばなければ、ふつうに引く)`;
        const got = ids(next({ kind: "choose", min: 0, max: 1, cards: refs(options0.map((o) => o.card)), label }));
        return options0.find((o) => got.includes(o.card.id))?.card;
      }
      // AI: 機械的に危険な Dredge (ライブラリーが N 枚ちょうど: 次のドローで負ける) は、しない。できない Dredge は、そもそも候補に出ない。
      // ノードの役割とデッキの内訳から確率を計算して (dredgeEval)、決まるものは機械的に決める (AI を呼ばない)。迷うときだけ、数字つきで、AI に聞く
      const options = options0.filter((o) => g.libraries[p].length > o.n);
      const evals = options.map((o) => ({ o, e: rules ? evalDredge(g, rules, p, o.n) : undefined }));
      const yes = evals.filter((x) => x.e && dredgeVerdict(x.e) === "yes").sort((a, b) => a.o.n - b.o.n)[0];
      if (yes) {
        g.log.push(`相手 (AI) は、機械的に判断して、Dredge ${yes.o.n} (${yes.o.card.name}) をした: 落とすと得のカードが期待 ${yes.e!.expPayoff.toFixed(1)} 枚で、困るカードは無い`);
        return yes.o.card;
      }
      const ask = evals.filter((x) => !x.e || dredgeVerdict(x.e) === "ask");
      if (!ask.length) return undefined;
      const label = `引くかわりに Dredge する? ${ask.map((x) => `${x.o.card.name} (Dredge ${x.o.n})`).join("・")}: 手札に戻すカードを選ぶ (選ばなければ、ふつうに引く)。${ask.map((x) => (x.e ? dredgeNote(x.e) : "")).join(" ")}`;
      const key = `${ask.map((x) => `${x.o.card.name}:${x.o.n}:${x.e?.payoff ?? "?"}:${x.e?.lossy ?? "?"}`).join(",")}|gy:${g.graveyards[p].map((c) => c.name).sort().join(",")}`;
      const got = ids(next({ kind: "choose", min: 0, max: 1, cards: refs(ask.map((x) => x.o.card)), label, key, for: p }));
      return ask.find((x) => got.includes(x.o.card.id))?.o.card;
    },
    pickColor(_g, p, card) {
      if (p !== me) return h?.pickColor?.(_g, p, card);
      const colors: [string, string][] = [["W", "白 (W)"], ["U", "青 (U)"], ["B", "黒 (B)"], ["R", "赤 (R)"], ["G", "緑 (G)"]];
      return ids(next({ kind: "choose", min: 1, max: 1, cards: colors.map(([id, name]) => ({ id, name })), label: `${card.name}: 色を 1 つ選ぶ` }))[0];
    },
    legend(g, p, same) {
      if (p !== me) return h?.legend?.(g, p, same);
      const got = ids(next({ kind: "choose", min: 1, max: 1, cards: refs(same.map((x) => x.card)), label: `伝説のルール: ${same[0].card.name} が ${same.length} 体いる。残す 1 体を選ぶ (ほかは墓地に置かれる)` }));
      return same.find((x) => got.includes(x.id));
    },
    order(g, p, cards, to) {
      if (p !== me) return cards.length < 2 ? undefined : h?.order?.(g, p, cards, to);
      if (cards.length < 2) return undefined;
      const got = ids(next({ kind: "order", cards: refs(cards), to }));
      return got.flatMap((id) => cards.find((c) => c.id === id) ?? []);
    },
    orderTriggers(_g, p, items) {
      if (p !== me || items.length < 2) return undefined;
      const same = (a: typeof items[0], b: typeof items[0]) => a.card.name === b.card.name && JSON.stringify(a.body) === JSON.stringify(b.body) && JSON.stringify(a.targets) === JSON.stringify(b.targets);
      if (items.every((x) => same(x, items[0]))) return undefined; // 同じものばかりなら、順番に意味は無い
      const got = ids(next({ kind: "order", cards: refs(items.map((x) => ({ ...x.card, id: x.id }))), to: "stack" }));
      return got.flatMap((id) => items.find((x) => x.id === id) ?? []);
    },
    may(g, p, what) {
      return p === me ? next({ kind: "may", what }) === true : h?.may?.(g, p, what);
    },
    pay(_g, p, n, why) {
      return p === me ? next({ kind: "pay", n, ...(why ? { why } : {}) }) === true : undefined;
    },
    target(g, item, call: NodeCall, legal) {
      const a = call.args as Record<string, unknown>;
      const min = typeof a.min === "number" ? a.min : 1;
      const max = typeof a.max === "number" ? a.max : Math.max(1, min);
      if (item.controller !== me) return legal.length <= min ? undefined : h?.target?.(g, item, call, legal);
      if (legal.length <= min) return undefined;
      const name = (id: string): string => (g.players.includes(id) ? (id === me ? "あなた" : "相手") : g.battlefield.find((p) => p.id === id)?.card.name ?? g.stack.find((s) => s.id === id)?.card.name ?? id);
      return ids(next({ kind: "target", card: item.card.name, min, max, choices: legal.map((id) => ({ id, name: name(id) })) }));
    },
  };
}
