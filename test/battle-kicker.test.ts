import assert from "node:assert";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
// キッカー {1} (払って唱えたら、さらに 1 枚引く)
const rules: RuleBook = { get: (c) => (c === "Kick" ? { card: c, abilities: [{ kind: "spell", body: [call("additionalCost", { flag: "kicked", mana: 1 }), call("draw", { player: "you", count: 1 }), call("draw", { player: "you", count: 1 }, { if: "kicked" })] }] as Ability[] } : undefined) };
const mk = (id: string, typeLine: string, owner = "you", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const make = (mana: number) => {
  const g = createGame(["you", "opp"]);
  g.payManaCosts = true;
  g.step = "main1";
  g.hands["you"] = [mk("Kick", "Instant", "you", { manaCost: "{U}" })];
  g.libraries["you"] = Array.from({ length: 6 }, (_, i) => mk(`L${i}`, "Land"));
  g.libraries["opp"] = g.libraries["you"].map((c) => ({ ...c, id: "o" + c.id, owner: "opp" }));
  g.mana["you"] = mana;
  g.pool["you"] = mana ? { U: mana } : {};
  return { g, c: new BattleController(g, rules, "you", () => 0.5) };
};

// マナが足りない / 基本のコストぶんだけ: 追加コストは、選ばせない
assert.deepEqual(make(0).c.kickChoices("Kick"), []);
assert.deepEqual(make(1).c.kickChoices("Kick"), []);
// 追加コストぶんのマナもある: 払うか、選ばせる
{
  const { g, c } = make(2);
  assert.deepEqual(c.kickChoices("Kick"), [{ flag: "kicked", cost: "{1}" }]);
  assert.equal(c.use("Kick", undefined, { kicked: true }), undefined);
  assert.equal(g.stack[0].cast.kicked, true);
  assert.equal(g.mana["you"], 0, "2 マナ払った");
  assert.ok(g.log.some((l) => l.includes("キッカーを払って唱えた")));
}
// 払わずに唱える (マナは 1 だけ減る)
{
  const { g, c } = make(2);
  assert.equal(c.use("Kick"), undefined);
  assert.equal(g.stack[0].cast.kicked, undefined);
  assert.equal(g.mana["you"], 1);
}
// 払えないのに、払うと言ったら、失敗 (状態は変わらない)
{
  const { g, c } = make(1);
  assert.ok(c.use("Kick", undefined, { kicked: true }));
  assert.equal(g.stack.length, 0);
}
console.log("kicker ok");
