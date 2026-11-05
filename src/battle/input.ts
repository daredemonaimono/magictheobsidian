import { Game, GameCard, Decider, PlayerId } from "./state";
import { NodeCall } from "./node";

// 人の判断の入力待ち。エンジンは同期のまま。自分 (me) への質問で、まだ答えが無ければ NeedInput を投げ、画面が答えを集めて、最初からやり直す (エンジンは乱数を使わないので、同じ結果になる)。相手への質問は、これまでどおり既定の動き
export type CardRef = { id: string; name: string };
export type InputRequest =
  | { kind: "discard"; n: number; cards: CardRef[]; cleanup?: boolean } // 手札から n 枚捨てる。cleanup = クリンナップの手札の上限 (画面は、「残すカードを選ぶ」形にする)
  | { kind: "choose"; min: number; max: number; cards: CardRef[] } // 見たカードから選ぶ
  | { kind: "may"; what: string } // 「してもよい」
  | { kind: "pay"; n: number } // 「支払わないかぎり」の支払い
  | { kind: "target"; card: string; min: number; max: number; choices: CardRef[] }; // 誘発型能力の対象 (名前つき。画面は、まだ起きていない局面のものを、盤面ではなく、一覧で選ばせる)
export type Answer = string[] | boolean; // カード・対象の id の並び / はい・いいえ

export class NeedInput extends Error {
  constructor(readonly request: InputRequest) {
    super("入力待ち");
  }
}

const refs = (cs: GameCard[]): CardRef[] => cs.map((c) => ({ id: c.id, name: c.name }));

// answers = これまでに集めた答え (質問の順)。足りなければ、次の質問で NeedInput
export function makeDecider(me: PlayerId, answers: Answer[]): Decider {
  let i = 0;
  const next = (request: InputRequest): Answer => {
    if (i >= answers.length) throw new NeedInput(request);
    return answers[i++];
  };
  const ids = (a: Answer): string[] => (Array.isArray(a) ? a : []);
  return {
    discard(g: Game, p, n, cleanup) {
      const hand = g.hands[p];
      if (p !== me || hand.length <= n) return undefined; // 全部捨てるなら、聞かない
      const got = ids(next({ kind: "discard", n, cards: refs(hand), ...(cleanup ? { cleanup: true } : {}) }));
      const picked = hand.filter((c) => got.includes(c.id));
      g.log.push(`あなたが ${picked.map((c) => c.name).join("、")} を捨てた`);
      return picked;
    },
    choose(g, p, from, n, atMost) {
      if (p !== me || from.length === 0 || (!atMost && from.length <= n)) return undefined;
      const got = ids(next({ kind: "choose", min: atMost ? 0 : n, max: n, cards: refs(from) }));
      return from.filter((c) => got.includes(c.id));
    },
    may(_g, p, what) {
      return p === me ? next({ kind: "may", what }) === true : undefined;
    },
    pay(_g, p, n) {
      return p === me ? next({ kind: "pay", n }) === true : undefined;
    },
    target(g, item, call: NodeCall, legal) {
      const a = call.args as Record<string, unknown>;
      const min = typeof a.min === "number" ? a.min : 1;
      const max = typeof a.max === "number" ? a.max : Math.max(1, min);
      if (item.controller !== me || legal.length <= min) return undefined;
      const name = (id: string): string => (g.players.includes(id) ? (id === me ? "あなた" : "相手") : g.battlefield.find((p) => p.id === id)?.card.name ?? g.stack.find((s) => s.id === id)?.card.name ?? id);
      return ids(next({ kind: "target", card: item.card.name, min, max, choices: legal.map((id) => ({ id, name: name(id) })) }));
    },
  };
}
