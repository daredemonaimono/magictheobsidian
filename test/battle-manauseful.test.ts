import assert from "node:assert";
import { actionsFor, manaUseful, uselessMana } from "../src/battle/actions";
import { boardModel } from "../src/battle/boardModel";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
const call = (node: string, args: NodeCall["args"]): NodeCall => ({ node, args });
const rules: RuleBook = { get: (c) => (c === "Island" ? { card: c, abilities: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }] as Ability[] } : c === "Bear" ? { card: c, abilities: [] } : undefined) };
const mk = (id: string, typeLine: string, mv: number, extra: Partial<GameCard> = {}): GameCard => ({ id, name: id.replace(/\d+$/, ""), typeLine, mv, owner: "you", ...extra });
const make = (hand: GameCard[]) => {
  const g = createGame(["you", "opp"]);
  g.payManaCosts = true;
  g.step = "main1";
  g.hands["you"] = hand;
  g.libraries["you"] = [mk("L1", "Land", 0)];
  g.libraries["opp"] = [mk("O1", "Land", 0, { owner: "opp" })];
  g.battlefield.push({ id: "Island1", card: mk("Island1", "Basic Land — Island", 0), controller: "you" });
  return g;
};
const tap = { kind: "activate", perm: "Island1", index: 0 } as const;
const bear = (mv: number) => mk("Bear1", "Creature — Bear", mv, { manaCost: mv === 1 ? "{U}" : "{1}{U}", power: 1, toughness: 1 });

// 唱えられる呪文が無い (手札が空 / マナが足りない): マナを出しても消えるだけ → タップできない・光らない
for (const hand of [[], [bear(2)]]) {
  const g = make(hand);
  assert.equal(manaUseful(g, rules, "you"), false);
  assert.equal(uselessMana(g, rules, "you", tap), true);
  const m = boardModel(g, rules, "you", () => undefined);
  assert.equal(m.self.landStacks.flatMap((s) => s.cards).some((c) => c.playable), false, "光らない");
  const c = new BattleController(g, rules);
  assert.ok(c.activate("Island1", 0), "理由が返る");
  assert.equal(g.mana["you"], 0);
  assert.equal(g.battlefield[0].tapped, undefined);
}
// 唱えられる呪文がある: タップできる
{
  const g = make([bear(1)]);
  assert.equal(manaUseful(g, rules, "you"), true);
  assert.equal(uselessMana(g, rules, "you", tap), false);
  assert.ok(boardModel(g, rules, "you", () => undefined).self.landStacks.flatMap((s) => s.cards).some((c) => c.playable));
  const c = new BattleController(g, rules);
  assert.equal(c.activate("Island1", 0), undefined);
  assert.equal(g.mana["you"], 1);
}
// 土地は、マナ能力ではないので、いつもの通り (土地を出す)
{
  const g = make([mk("Island2", "Basic Land — Island", 0)]);
  assert.ok(actionsFor(g, rules, "you").some((a) => a.kind === "land"));
}
console.log("manauseful ok");
