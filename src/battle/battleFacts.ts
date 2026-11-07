import { tryWithMana, withAllMana } from "./actions";
import { characteristics } from "./continuous";
import { isSick } from "./engine";
import { Game, PlayerId, RuleBook } from "./state";

// AI への「行動の分析」に使う「事実」。数・個数・差・使えるマナ・使える手札は、コードが先に計算する。
// 視点は p (AI): you = p、opp = 相手。純粋な関数 (g は変えない)
export interface BattleFacts {
  life: { you: number; opp: number };
  lifeDiff: number; // 自分 − 相手
  turnsToKillOpp: number | null; // いま攻撃できる (召喚酔いでない) 自分のクリーチャーのパワーの合計で、相手を倒せるまでのターン数 (倒せなければ null)
  turnsToKillMe: number | null; // 相手のクリーチャーのパワーの合計で、自分が倒されるまでのターン数
  board: { owner: "you" | "opp"; name: string; power: number | null; toughness: number | null; tapped: boolean; attacking: boolean; summoningSick: boolean; keywords: string[] }[];
  availableMana: number; // 土地・マナ能力を全部使ったときに払える数
  oppUntappedMana: number; // 相手のアンタップ状態の土地の数
  handActions: { card: string; cost: number; castable: boolean; tags: string[] }[]; // 手札の土地でないカード。castable = いま (マナを全部出せば) 唱えられるか。tags = カードの分類
  abilities: { card: string; label: string; usable: boolean }[]; // 戦場の自分のパーマネントの、マナ以外の起動型能力
}

const turns = (life: number, power: number): number | null => (power > 0 ? Math.max(1, Math.ceil(life / power)) : null);

export function battleFacts(g: Game, rules: RuleBook, p: PlayerId, tagsOf: (cardName: string) => string[] = () => []): BattleFacts {
  const foe = g.players.find((x) => x !== p) ?? p;
  const board = g.battlefield.flatMap((perm) => {
    const c = characteristics(g, perm, rules);
    if (!/\bCreature\b/.test(c.typeLine)) return [];
    return [{ owner: (perm.controller === p ? "you" : "opp") as "you" | "opp", name: perm.card.name, power: c.power, toughness: c.toughness, tapped: !!perm.tapped, attacking: !!perm.attacking, summoningSick: isSick(g, perm, rules), keywords: c.keywords }];
  });
  const sum = (owner: "you" | "opp", ready: boolean) => board.filter((b) => b.owner === owner && (!ready || !b.summoningSick)).reduce((a, b) => a + Math.max(0, b.power ?? 0), 0);
  const handActions = g.hands[p]
    .filter((c) => !/\bLand\b/.test(c.typeLine))
    .map((c) => ({ card: c.name, cost: c.mv, castable: tryWithMana(g, rules, p, { kind: "cast", card: c.id }) === undefined, tags: tagsOf(c.name) }));
  const abilities = g.battlefield
    .filter((x) => x.controller === p)
    .flatMap((perm) =>
      (rules.get(perm.card.name)?.abilities ?? [])
        .filter((a) => a.kind === "activated")
        .flatMap((ab, index) => (ab.body.some((c) => c.node === "addMana") && ab.body.every((c) => c.node === "addMana" || c.node === "cost") ? [] : [{ card: perm.card.name, label: ab.body.filter((c) => c.node !== "cost" && c.node !== "timing").map((c) => c.node).join(" → "), usable: tryWithMana(g, rules, p, { kind: "activate", perm: perm.id, index }) === undefined }])),
    );
  return {
    life: { you: g.life[p], opp: g.life[foe] },
    lifeDiff: g.life[p] - g.life[foe],
    turnsToKillOpp: turns(g.life[foe], sum("you", true)),
    turnsToKillMe: turns(g.life[p], sum("opp", false)),
    board,
    availableMana: withAllMana(g, rules, p).mana[p] ?? 0,
    oppUntappedMana: g.battlefield.filter((x) => x.controller === foe && !x.tapped && /\bLand\b/.test(x.card.typeLine)).length,
    handActions,
    abilities,
  };
}
