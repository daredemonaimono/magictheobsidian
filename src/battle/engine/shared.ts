import { characteristics } from "../continuous";
import { NodeCall, Value } from "../node";
import { Game, GameCard, Perm, PlayerId, RuleBook, Step } from "../state";

// 共有の小さな部品 (エラー・ステップの並び・キーワード・型の判定など)

export const STEPS: Step[] = ["untap", "upkeep", "draw", "main1", "combat", "main2", "end"];

export const nextPlayer = (g: Game, p: PlayerId): PlayerId => g.players[(g.players.indexOf(p) + 1) % g.players.length];

export class RuleError extends Error {}

export const UNRULED = "ルールが設定されていません。スキップします。";

// ルールが設定されていないカード (skipUnruled が真のとき): ルールが無い、またはノードが1つも無い
export const unruled = (g: Game, rules: RuleBook, card: GameCard): boolean => !!g.skipUnruled && (rules.get(card.name)?.abilities ?? []).every((a) => a.body.length === 0);

export const isPermanentCard = (c: GameCard): boolean => !/\b(Instant|Sorcery)\b/.test(c.typeLine);

// ルールの常在型能力に書かれたキーワード (keyword name=…)
export const staticKeywords = (rules: RuleBook, card: GameCard): string[] => (rules.get(card.name)?.abilities ?? []).filter((a) => a.kind === "static").flatMap((a) => a.body.filter((c) => c.node === "keyword").map((c) => String(c.args.name)));

// 状態起因処理: 忠誠度 0 以下のプレインズウォーカー、タフネス 0 以下のクリーチャー、付いている先を失ったオーラは、墓地へ。落ち着くまで繰り返す
export const live = (g: Game): void => {
  if (g.over) throw new RuleError("ゲームはもう終わっている");
};

export const spellBody = (rules: RuleBook, card: GameCard): NodeCall[] | undefined => rules.get(card.name)?.abilities.find((a) => a.kind === "spell")?.body;

// {ref} を、前のノードの出力 (vars) に置き換える。まだ無い・消えた参照は undefined
export function resolveArgs(call: NodeCall, vars: Record<string, Value>): Record<string, Value> | undefined {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(call.args)) {
    const x = typeof v === "object" ? vars[v.ref] : v;
    if (x === undefined) return undefined;
    out[k] = x;
  }
  return out;
}

// 召喚酔い: クリーチャーは、このターンに戦場に出たなら、攻撃も {T} のコストの能力もできない (速攻があれば別)
export const isSick = (g: Game, p: Perm, rules: RuleBook): boolean => {
  if (p.enteredTurn === undefined || p.enteredTurn !== g.turn) return false;
  const now = characteristics(g, p, rules);
  return /\bCreature\b/.test(now.typeLine) && !now.keywords.includes("haste");
};

export const HAND_LIMIT = 7;

export const who = (p: PlayerId): string => (p === "you" ? "あなた" : p === "opp" ? "相手" : p); // ログの呼び名

export const kwOf = (g: Game, p: Perm, rules: RuleBook): string[] => characteristics(g, p, rules).keywords;

export const isCreature = (g: Game, p: Perm, rules: RuleBook): boolean => /\bCreature\b/.test(characteristics(g, p, rules).typeLine);

// 攻撃先のコントローラー (プレイヤーならその人、プレインズウォーカーならそのコントローラー)
export const defenderOf = (g: Game, a: Perm): PlayerId | undefined => (a.attackTarget && g.players.includes(a.attackTarget) ? a.attackTarget : g.battlefield.find((x) => x.id === a.attackTarget)?.controller);

// 飛行は、飛行か到達でしかブロックできない (威嚇は、2体以上の組み合わせの決まりなので、ここでは見ない)
export const evasionAllows = (attackerKw: string[], blockerKw: string[]): boolean => !attackerKw.includes("flying") || blockerKw.includes("flying") || blockerKw.includes("reach");
