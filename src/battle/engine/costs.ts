import { characteristics } from "../continuous";
import { NodeCall } from "../node";
import { addCosts, describeCost, emptyCost, ManaCost, parseManaCost, SpendOpts, trySpend } from "../mana";
import { Game, GameCard, Perm, PlayerId, RuleBook } from "../state";
import { removeFromBattlefield } from "./battlefield";
import { RuleError, isSick } from "./shared";

// コスト (集める・払えるか・払う)

// コスト (cost / additionalCost のノードから集める)。mana = 汎用の数、manaCost = 色つきのマナコスト ("{1}{U}")
export interface CostSpec {
  sym: ManaCost; // 払うマナ (mana の汎用も、ここに入る)
  tap: boolean;
  sacrifice: boolean;
  tapCreatures: number;
  loyalty: number; // 忠誠度を足す量 (+1 は 1、−2 は −2)
  loyaltyX: boolean; // −X
  isLoyalty: boolean; // 忠誠度能力 (ソーサリーのタイミングで、1ターンに1回)
  life: number; // 払うライフ (フェッチランドの「1点のライフを払う」)
  preferLife?: boolean; // ファイレクシア・マナを、ライフで払う
  spent?: { colors: number; life: number; mana: number }; // 払ったあと、色の数が入る (payCost が書く)
}

// manaCost の形が違うときは RuleError (保存時の検査を通らなかった rule でも、エンジンが落ちないように)
export const parseOrRule = (s: string): ManaCost => {
  try {
    return parseManaCost(s);
  } catch (e) {
    throw new RuleError((e as Error).message);
  }
};

export const costOf = (calls: NodeCall[]): CostSpec => ({
  sym: calls.reduce((a, c) => addCosts(addCosts(a, { ...emptyCost(), generic: Number(c.args.mana ?? 0) }), typeof c.args.manaCost === "string" ? parseOrRule(c.args.manaCost) : emptyCost()), emptyCost()),
  tap: calls.some((c) => c.args.tap === true),
  sacrifice: calls.some((c) => c.args.sacrifice === true),
  tapCreatures: calls.reduce((a, c) => a + Number(c.args.tapCreatures ?? 0), 0),
  loyalty: calls.reduce((a, c) => a + Number(c.args.loyalty ?? 0), 0),
  loyaltyX: calls.some((c) => c.args.loyaltyX === true),
  isLoyalty: calls.some((c) => c.args.loyalty !== undefined || c.args.loyaltyX === true),
  life: calls.reduce((a, c) => a + Number(c.args.life ?? 0), 0),
});

// 払えるか。払えなければ理由 (状態は変えない)。tapIds = パワーの合計のためにタップするクリーチャー
export function costProblem(g: Game, p: PlayerId, cost: CostSpec, source: Perm | undefined, tapIds: string[], rules: RuleBook, spell?: GameCard, x = 0): string | null {
  if (!trySpend(g, p, cost.sym, spell, false, { preferLife: cost.preferLife })) return `マナが足りない (${describeCost(cost.sym)} 要る)`;
  if (cost.isLoyalty) {
    const now = source?.counters?.loyalty ?? 0;
    if (!source || source.loyaltyUsed) return "このターンは、もう忠誠度能力を起動した (1ターンに1回)";
    if (cost.loyalty < 0 && now + cost.loyalty < 0) return `忠誠度が足りない (${now} / ${-cost.loyalty})`;
    if (cost.loyaltyX && (!Number.isInteger(x) || x < 0 || x > now + cost.loyalty)) return `X は 0〜忠誠度 (${now + cost.loyalty}) の整数`;
  }
  if (cost.life > 0 && g.life[p] < cost.life) return `ライフが足りない (${g.life[p]} / ${cost.life})`;
  if (cost.tap && (!source || source.tapped)) return "すでにタップされていて、タップできない";
  if (cost.tap && source && isSick(g, source, rules)) return "召喚酔いで、{T} のコストを払えない";
  if (cost.tapCreatures > 0) {
    if (new Set(tapIds).size !== tapIds.length) return "同じクリーチャーを2回選んでいる";
    let power = 0;
    for (const id of tapIds) {
      const c = g.battlefield.find((x) => x.id === id);
      const now = c ? characteristics(g, c, rules) : undefined; // 継続効果をふまえた、いまの型・パワー
      if (!c || !now || c.controller !== p || c.tapped || !/\bCreature\b/.test(now.typeLine) || (source && c.id === source.id && cost.tap)) return `タップできるクリーチャーではない: ${id}`;
      power += now.power ?? 0;
    }
    if (power < cost.tapCreatures) return `タップしたクリーチャーのパワーの合計が足りない (${power} / ${cost.tapCreatures})`;
  }
  return null;
}

export function payCost(g: Game, p: PlayerId, cost: CostSpec, source: Perm | undefined, tapIds: string[], spell?: GameCard, x = 0): void {
  const opts: SpendOpts = { preferLife: cost.preferLife, spent: { colors: 0, life: 0, mana: 0 } };
  if (!trySpend(g, p, cost.sym, spell, true, opts)) throw new Error("マナが払えない (costProblem を通っていない)");
  cost.spent = opts.spent;
  if (cost.isLoyalty && source) {
    source.counters = { ...source.counters, loyalty: (source.counters?.loyalty ?? 0) + cost.loyalty - (cost.loyaltyX ? x : 0) };
    source.loyaltyUsed = true;
  }
  if (cost.life > 0) {
    g.life[p] -= cost.life;
    g.log.push(`${cost.life} 点のライフを払った`);
  }
  if (cost.tap && source) source.tapped = true;
  if (cost.tapCreatures > 0) for (const id of tapIds) g.battlefield.find((x) => x.id === id)!.tapped = true;
  if (cost.sacrifice && source) {
    removeFromBattlefield(g, source);
  }
}
