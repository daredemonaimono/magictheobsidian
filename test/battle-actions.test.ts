import assert from "node:assert";
import { NO_TARGET, abilityLabels, actionsFor, slotsOf, tryAction } from "../src/battle/actions";
import { activateAbility, castSpell, playLand } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const card = (id: string, typeLine: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 0, owner: "A", ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const rules = rulesOf({
  Island: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }],
  Bear: [],
  Zap: [{ kind: "spell", body: [call("target", { zone: "battlefield", kind: "permanent", type: "creature" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 2 })] }],
});
const setup = () => {
  const g = createGame(["A", "B"]);
  g.payManaCosts = true;
  g.step = "main1";
  return g;
};
const kinds = (g: Game) => actionsFor(g, rules, "A").map((a) => (a.kind === "activate" ? `activate:${a.perm}:${a.index}` : `${a.kind}:${a.card}`));

// 土地: 出せる。1枚出したら2枚目は出せない
{
  const g = setup();
  g.hands["A"].push(card("Island", "Basic Land — Island"), card("Island2", "Basic Land — Island"));
  g.hands["A"][1] = { ...g.hands["A"][1], name: "Island" };
  assert.deepEqual(kinds(g), ["land:Island", "land:Island2"]);
  playLand(g, "A", "Island", rules);
  assert.deepEqual(kinds(g).filter((k) => k.startsWith("land")), []);
}
// マナ能力: 未タップなら出る。タップ済みなら出ない。マナが無いとクリーチャーは出ず、出した後は出る
{
  const g = setup();
  g.battlefield.push({ id: "Island", card: card("Island", "Basic Land — Island"), controller: "A" });
  g.hands["A"].push(card("Bear", "Creature — Bear", { mv: 2, manaCost: "{1}{U}" }));
  assert.deepEqual(kinds(g), ["activate:Island:0"]);
  g.battlefield.push({ id: "Island2", card: { ...card("Island2", "Basic Land — Island"), name: "Island" }, controller: "A" });
  activateAbility(g, "A", "Island", 0, {}, rules);
  activateAbility(g, "A", "Island2", 0, {}, rules);
  assert.deepEqual(kinds(g), ["cast:Bear"]);
}
// 対象を取る呪文: 対象にできるものがあれば使える。スロットが対象の候補を返す。無ければ、理由
{
  const g = setup();
  g.hands["A"].push(card("Zap", "Instant", { mv: 0 }));
  assert.equal(tryAction(g, rules, "A", { kind: "cast", card: "Zap" }), NO_TARGET, "戦場にクリーチャーがいない");
  assert.deepEqual(kinds(g), []);
  g.battlefield.push({ id: "Bear", card: card("Bear", "Creature — Bear", { power: 2, toughness: 2 }), controller: "B" });
  g.battlefield.push({ id: "Bear2", card: { ...card("Bear2", "Creature — Bear", { power: 2, toughness: 2 }), name: "Bear" }, controller: "A" });
  assert.deepEqual(kinds(g), ["cast:Zap"]);
  const slots = slotsOf(g, rules, "A", { kind: "cast", card: "Zap" });
  assert.deepEqual(slots.map((x) => [x.as, x.min, x.max, x.legal]), [["t", 1, 1, ["Bear", "Bear2"]]]);
  assert.equal(tryAction(g, rules, "A", { kind: "cast", card: "Zap" }, { t: "Bear" }), undefined);
  assert.ok(tryAction(g, rules, "A", { kind: "cast", card: "Zap" }, { t: "nothing" }), "不正な対象は、使えない");
}
// 相手のターンのメインでは、クリーチャーは出ない。試しても、元の局面は変わらない
{
  const g = setup();
  g.active = "B";
  g.priority = "A";
  g.hands["A"].push(card("Bear", "Creature — Bear"));
  const before = JSON.stringify(g);
  assert.ok(tryAction(g, rules, "A", { kind: "cast", card: "Bear" }));
  assert.equal(JSON.stringify(g), before);
  g.active = "A";
  const before2 = JSON.stringify(g);
  assert.equal(tryAction(g, rules, "A", { kind: "cast", card: "Bear" }), undefined);
  assert.equal(JSON.stringify(g), before2, "成功の試し撃ちでも、元は変わらない");
}
assert.deepEqual(abilityLabels(rules, "Island").length, 1);
assert.ok(abilityLabels(rules, "Island")[0].startsWith("1: "));
void castSpell;
console.log("actions ok");
