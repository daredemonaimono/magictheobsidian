import { characteristics } from "../continuous";
import { RunCtx, Value } from "../node";
import { defineCondition, defineNode, getNode } from "../registry";
import { dealDamage } from "../damage";
import { parseManaCost, spendGeneric } from "../mana";
import { nextRandom } from "../rng";
import { discardCards, drawCards, prepareAbilityOf, Game, GameCard, Perm, playersOf, splitIds, typeIn, untapPerm } from "../state";

// 実装済みの基本ノード。打ち消しは「対象」+「打ち消す」の組み合わせで、カードごとの違いは対象の条件 (引数) だけ

// 「キーワードを得る」で選べるキーワード能力 (増やすときはここへ)
export const KEYWORDS = ["flying", "hexproof", "flash", "haste", "vigilance", "trample", "lifelink", "deathtouch", "firstStrike", "doubleStrike", "reach", "menace", "defender", "prowess", "indestructible"];

// 対象・選択の出力は、id をカンマでつないだ文字列 (複数の対象・集合のため)。空なら空文字
export const idList = (v: Value | undefined): string[] => (v === undefined || v === "" ? [] : splitIds(String(v)));

// 場所を問わずカードを探す (ライブラリー・手札・墓地)。見つかれば取り除いて返す
export function takeCard(g: Game, id: string): GameCard | undefined {
  for (const zone of [g.libraries, g.hands, g.graveyards]) {
    for (const p of Object.keys(zone)) {
      const i = zone[p].findIndex((c) => c.id === id);
      if (i >= 0) return zone[p].splice(i, 1)[0];
    }
  }
  return undefined;
}
export const findCard = (g: Game, id: string): GameCard | undefined => [g.libraries, g.hands, g.graveyards].flatMap((z) => Object.values(z).flat()).find((c) => c.id === id);

// target と select が共有する絞り込み (型・マナ総量・コントローラー・攻撃中・タップ状態)
export const filterParams = {
  type: { type: "string" as const },
  notType: { type: "string" as const },
  mv: { type: "number" as const },
  maxPower: { type: "number" as const },
  controller: { type: "string" as const, choices: ["you", "opponents"] },
  attacking: { type: "boolean" as const },
  tapped: { type: "boolean" as const },
};
export function matches(ctx: RunCtx, a: Record<string, Value>, hit: { card: GameCard; controller: string }, typeLine = hit.card.typeLine): boolean {
  if (typeof a.type === "string" && !typeIn(typeLine, a.type)) return false; // type=artifact|creature は「または」
  if (typeof a.notType === "string" && typeIn(typeLine, a.notType)) return false; // notType=creature|land は「どちらでもない」
  if (typeof a.mv === "number" && hit.card.mv !== a.mv) return false;
  if (typeof a.controller === "string" && (a.controller === "you") !== (hit.controller === ctx.item.controller)) return false;
  const perm = hit as Perm;
  if (typeof a.maxPower === "number" && ctx.game.battlefield.includes(perm) && (characteristics(ctx.game, perm, ctx.rules).power ?? Infinity) > a.maxPower) return false;
  if (typeof a.attacking === "boolean" && !!perm.attacking !== a.attacking) return false;
  if (typeof a.tapped === "boolean" && !!perm.tapped !== a.tapped) return false;
  return true;
}

// ノードの部品が共有するもの (「あなた / 相手 / 対象」のプレイヤー指定など)
export const who = { type: "string" as const, required: true, choices: ["you", "opponents", "target"] };
export const targetPlayer = { type: "ref" as const }; // player=target のとき、target ノード (zone=player) の出力を渡す

// player 引数を、実際のプレイヤーに直す。target で対象が無ければ、記録を残して空
export const playersFor = (ctx: RunCtx, a: Record<string, Value>): string[] => {
  if (a.player !== "target") return playersOf(ctx.game, ctx.item.controller, String(a.player));
  if (typeof a.target === "string" && ctx.game.players.includes(a.target)) return [a.target];
  ctx.game.log.push("対象のプレイヤーが無い");
  return [];
};

// 常在型・継続効果のノードの共通の枠 (宣言のノードなので、if= は付けられない。reduceCost は affect が要らない)
export const cont = { declaration: true as const, only: ["static" as const], outputs: {}, run: (): Record<string, Value> => ({}) };
