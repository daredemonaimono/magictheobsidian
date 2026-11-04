import assert from "node:assert";
import { activateAbility, castSpell, passPriority } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, placementProblem, resetRegistry, structureProblem } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 60; i++) passPriority(g, g.priority!, book);
  assert.equal(g.stack.length, 0, "スタックが空にならない");
};
const ward = (n: number): Ability[] => [{ kind: "static", body: [call("ward", { amount: n })] }];
const bounceSpell = (): Ability[] => [{ kind: "spell", body: [call("target", { zone: "battlefield", kind: "permanent" }, { as: "t" }), call("bounce", { target: { ref: "t" } })] }];
const book = rulesOf({ Wardy: ward(2), Plain: [], bounce: bounceSpell() });
const setup = (mana: number, owner = "B") => {
  const g = createGame(["A", "B"]);
  g.battlefield.push({ id: "Wardy", card: card("Wardy", "Creature — Wizard", "A", { power: 5, toughness: 5 }), controller: "A" }, { id: "Plain", card: card("Plain", "Creature — Bear", "A", { power: 2, toughness: 2 }), controller: "A" });
  g.hands[owner].push(card("bounce", "Instant", owner));
  g.mana[owner] = mana;
  g.priority = owner;
  return g;
};

// ---- 検査
assert.equal(checkCall(call("ward", { amount: 2 })), null);
assert.ok(checkCall(call("ward", { amount: 0 })), "1 以上");
assert.ok(placementProblem("spell", call("ward", { amount: 2 })), "常在型能力にだけ書ける");
assert.equal(placementProblem("static", call("ward", { amount: 2 })), null);
assert.ok(structureProblem({ kind: "static", body: [call("affect", { who: "self" }), call("ward", { amount: 1 })] }), "affect の後ろには書けない");

// ---- 護法: 対戦相手の呪文が対象にしたとき、{N} を払わなければ打ち消す
{
  const g = setup(1); // 払えない (2 要る)
  castSpell(g, "B", "bounce", { t: "Wardy" }, book);
  assert.equal(g.stack.length, 2, "呪文の上に、護法の誘発が積まれる");
  assert.ok(g.stack[1].ability);
  drain(g, book);
  assert.ok(g.battlefield.some((p) => p.id === "Wardy"), "護法で打ち消された");
}
{
  const g = setup(1);
  castSpell(g, "B", "bounce", { t: "Wardy" }, book);
  drain(g, book);
  assert.ok(g.graveyards["B"].some((c) => c.id === "bounce"), "打ち消された呪文は、持ち主の墓地へ");
}
{
  const g = setup(2); // 払える
  castSpell(g, "B", "bounce", { t: "Wardy" }, book);
  drain(g, book);
  assert.equal(g.mana["B"], 0, "{2} を払った");
  assert.ok(!g.battlefield.some((p) => p.id === "Wardy"), "払ったので、呪文は解決する");
}
{
  // 護法の無いパーマネントには、何も起きない
  const g = setup(0);
  castSpell(g, "B", "bounce", { t: "Plain" }, book);
  assert.equal(g.stack.length, 1);
  drain(g, book);
  assert.ok(!g.battlefield.some((p) => p.id === "Plain"));
}
{
  // 自分の呪文には、護法は働かない
  const g = setup(0, "A");
  castSpell(g, "A", "bounce", { t: "Wardy" }, book);
  assert.equal(g.stack.length, 1, "自分の呪文では誘発しない");
}
{
  // 能力 (起動型) が対象にしても、護法は働く。払えなければ、能力が打ち消される
  const g = createGame(["A", "B"]);
  g.battlefield.push({ id: "Wardy", card: card("Wardy", "Creature — Wizard", "A", { power: 5, toughness: 5 }), controller: "A" }, { id: "Pinger", card: card("Pinger", "Artifact", "B"), controller: "B" });
  const pinger = rulesOf({ Wardy: ward(2), Pinger: [{ kind: "activated", body: [call("cost", { tap: true }), call("target", { zone: "battlefield", kind: "permanent" }, { as: "t" }), call("bounce", { target: { ref: "t" } })] }] });
  g.priority = "B";
  activateAbility(g, "B", "Pinger", 0, { t: "Wardy" }, pinger);
  assert.equal(g.stack.length, 2);
  drain(g, pinger);
  assert.ok(g.battlefield.some((p) => p.id === "Wardy"), "能力が打ち消された");
  assert.equal(g.graveyards["B"].length, 0, "能力は、墓地に行かない");
  assert.equal(g.battlefield.filter((p) => p.id === "Pinger").length, 1);
}
{
  // すべての能力を失っていれば、護法は働かない
  const g = setup(0);
  g.battlefield.push({ id: "Wipe", card: card("Wipe", "Enchantment", "B"), controller: "B" });
  const wipe = rulesOf({ Wardy: ward(2), bounce: bounceSpell(), Wipe: [{ kind: "static", body: [call("affect", { who: "all" }), call("loseAbilities", {})] }] });
  castSpell(g, "B", "bounce", { t: "Wardy" }, wipe);
  assert.equal(g.stack.length, 1, "能力を失った護法は誘発しない");
}
// ---- 選ばれなかったモード・満たされない条件の対象には、護法は働かない。同じパーマネントを2つの対象にしても、1回だけ
{
  const g = setup(4);
  const modal = rulesOf({
    Wardy: ward(2),
    modal: [{ kind: "spell", body: [call("modes", { count: 2, min: 1, max: 1 }), call("target", { zone: "battlefield", kind: "permanent" }, { as: "a", }), call("draw", { player: "you", count: 0 }, { if: "mode2" })] }],
  });
  modal.get("modal")!.abilities[0].body[1].if = "mode1";
  g.hands["B"].push(card("modal", "Instant", "B"));
  castSpell(g, "B", "modal", { a: "Wardy" }, modal, { modes: [2] });
  assert.equal(g.stack.length, 1, "モード2を選んだので、モード1の対象には護法が働かない");
}
{
  const g = setup(4);
  const two = rulesOf({ Wardy: ward(2), two: [{ kind: "spell", body: [call("target", { zone: "battlefield", kind: "permanent" }, { as: "a" }), call("target", { zone: "battlefield", kind: "permanent" }, { as: "b" })] }] });
  g.hands["B"].push(card("two", "Instant", "B"));
  castSpell(g, "B", "two", { a: "Wardy", b: "Wardy" }, two);
  assert.equal(g.stack.length, 2, "同じパーマネントを2回対象にしても、護法は1回");
}
console.log("batch12 ok");
